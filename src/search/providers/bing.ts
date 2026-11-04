import { BaseProvider } from './base-provider.js';
import { ProviderOptions, ProviderResult } from '../../utils/types.js';
import { config } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';
import { buildAcceptLanguage } from '../query-locale.js';

const BING_SEARCH_URL = 'https://www.bing.com/search';
const BING_HOME_URL = 'https://www.bing.com/';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MIN_REQUEST_INTERVAL_MS = 1000;
const FETCH_TIMEOUT_MS = 10000;

/** Next free request slot — reserved up front, see throttle(). */
let nextRequestSlotAt = 0;

/**
 * Slot reservation, not a sleep-after-timestamp check. Concurrent searches
 * (parallel provider mode, several tool calls in one agent turn) each claim
 * the next slot before awaiting, so requests stay 1s apart instead of all
 * firing together — simultaneous hits are what makes Bing answer with a
 * degraded, contentless SERP.
 */
async function throttle(): Promise<void> {
  const now = Date.now();
  const slotAt = Math.max(now, nextRequestSlotAt);
  nextRequestSlotAt = slotAt + MIN_REQUEST_INTERVAL_MS;
  if (slotAt > now) {
    await new Promise(r => setTimeout(r, slotAt - now));
  }
}

/**
 * Cookie jar shared by all Bing searches in this worker (HTTP channel only).
 *
 * Bing answers cookie-less scraping with a rotating "degraded" SERP: HTTP 200,
 * a normal-looking page frame, but an empty result list. A browser-like session
 * (MUID / _EDGE_* from the homepage) is what makes the SERP carry organic
 * results at all, and it is the only way to get stable multilingual results.
 */
const cookieJar = new Map<string, string>();
let cookieBootstrap: Promise<void> | null = null;

function collectCookies(response: Response): void {
  const getSetCookie = (response.headers as { getSetCookie?: () => string[] }).getSetCookie;
  const single = response.headers.get('set-cookie');
  const raw: string[] = typeof getSetCookie === 'function' ? getSetCookie.call(response.headers) : single ? [single] : [];

  for (const line of raw) {
    const pair = line.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name && value) {
      cookieJar.set(name, value);
    }
  }
}

export type BingAttemptVerdict = 'usable' | 'empty' | 'error';

/** One fetch performed by the last `doSearch`, kept for diagnostics (`npm run test:bing`). */
export interface BingAttempt {
  mode: 'http';
  page: number;
  status?: number;
  results: number;
  verdict: BingAttemptVerdict;
  reason?: string;
  ms: number;
}

/**
 * Bing provider — plain scraping of `/search?q=` with a warmed cookie session.
 *
 * A second channel (query typed into Bing in headless Chrome over CDP) lives on
 * the `bing-browser-mode` branch: as measured on 2026-11-04, any UA override
 * that hides the `HeadlessChrome` token also switches off Chrome's Client Hints,
 * and Bing then answers with a page that has no results container at all. That
 * channel is parked there until it is fixed; the HTTP channel stays here.
 *
 * The response is only checked structurally: HTTP status, captcha/blocking
 * page, and whether the page carries any organic result blocks at all. Whether
 * the results are actually about the queried subject is deliberately NOT
 * guessed — a text-overlap heuristic misjudges too many legitimate SERPs. If
 * Bing answers a query badly, Startpage/DDG/Brave in the same merge compensate.
 */
export class BingProvider extends BaseProvider {
  readonly name = 'Bing';
  readonly tier = 1 as const;

  /** Every fetch performed by the last `doSearch` call (diagnostics only). */
  readonly attempts: BingAttempt[] = [];

  private resultsPerPage: number;
  private maxPages: number;

  constructor() {
    super();
    this.resultsPerPage = config.BING_RESULTS_PER_PAGE;
    this.maxPages = config.BING_MAX_PAGES;
  }

  async doSearch(query: string, options: ProviderOptions): Promise<ProviderResult[]> {
    this.attempts.length = 0;

    await throttle();

    return this.searchViaHttp(query, options);
  }

  /** Paged scraping. Stops at the first page that carries no organic results. */
  private async searchViaHttp(query: string, options: ProviderOptions): Promise<ProviderResult[]> {
    await this.ensureCookies();

    const allResults: ProviderResult[] = [];
    const needPages = Math.min(Math.ceil(options.max_results / this.resultsPerPage), this.maxPages);

    for (let page = 0; page < needPages; page++) {
      const started = Date.now();
      const url = this.buildSearchUrl(query, page);

      logger.debug({ url: url.toString(), page }, 'Bing request');

      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: this.buildRequestHeaders(query),
      });

      if (!response.ok) {
        throw new Error(`Bing returned ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      const results = this.parseResults(html, Math.max(1, options.max_results));
      const verdict: BingAttemptVerdict = results.length > 0 ? 'usable' : 'empty';

      this.attempts.push({
        mode: 'http',
        page: page + 1,
        status: response.status,
        results: results.length,
        verdict,
        reason: verdict === 'empty' ? this.describeEmpty(html) : undefined,
        ms: Date.now() - started,
      });

      allResults.push(...results);

      if (verdict === 'empty' || results.length < this.resultsPerPage) {
        break;
      }
    }

    if (this.attempts[0]?.verdict === 'empty') {
      logger.debug(
        { query, reason: this.attempts[0].reason },
        'Bing returned no organic results — other providers cover this query',
      );
    }

    return allResults;
  }

  /**
   * Query is sent verbatim (URLSearchParams does the UTF-8 percent-encoding) —
   * Bing reads the query fine in any script, transliterating it only hurts.
   *
   * Market params are deliberately NOT guessed from the query language: in
   * live tests `mkt=de-DE` / `mkt=ja-JP` / `mkt=zh-CN` returned literal
   * "no results" pages, and `mkt` + `setlang` + `cc` combined (invalid per
   * Bing docs, they are mutually exclusive) returned junk for every language.
   * Only an explicit operator override is honoured.
   */
  private buildSearchUrl(query: string, page: number): URL {
    const url = new URL(BING_SEARCH_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(this.resultsPerPage));
    if (page > 0) {
      url.searchParams.set('first', String(page * this.resultsPerPage + 1));
    }

    const market = config.BING_MARKET?.trim();
    if (market) {
      url.searchParams.set('mkt', market);
    }

    return url;
  }

  /** Accept-Language follows the languages actually present in the query. */
  private buildRequestHeaders(query: string): Record<string, string> {
    const acceptLanguage = config.BING_ACCEPT_LANGUAGE?.trim() || buildAcceptLanguage(query);
    const headers: Record<string, string> = {
      'User-Agent': DESKTOP_UA,
      'Accept-Language': acceptLanguage,
      Accept: 'text/html,application/xhtml+xml',
    };

    const cookie = this.cookieHeader();
    if (cookie) {
      headers.Cookie = cookie;
    }

    return headers;
  }

  private cookieHeader(): string {
    return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  private async ensureCookies(): Promise<void> {
    if (config.BING_USE_COOKIES === false) {
      return;
    }
    if (!cookieBootstrap) {
      cookieBootstrap = this.bootstrapCookies().catch((err: unknown) => {
        logger.debug({ err: String(err) }, 'Bing cookie bootstrap failed — continuing cookie-less');
      });
    }
    await cookieBootstrap;
  }

  private async bootstrapCookies(): Promise<void> {
    const response = await fetch(BING_HOME_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
      headers: {
        'User-Agent': DESKTOP_UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    collectCookies(response);
    await response.text();

    logger.debug({ cookies: cookieJar.size }, 'Bing cookie session bootstrapped');
  }

  /**
   * 200 + a result list container but no organic items and no "no results"
   * notice — the classic cookie-less degraded SERP.
   */
  private looksDegraded(html: string): boolean {
    return /id="b_results"/i.test(html) && !/class="b_algo/i.test(html) && !/class="b_no/i.test(html);
  }

  private describeEmpty(html: string): string {
    return this.looksDegraded(html) ? 'degraded SERP (no organic blocks)' : 'no results reported by Bing';
  }

  private parseResults(html: string, maxResults: number): ProviderResult[] {
    const results: ProviderResult[] = [];

    const algoRegex = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
    let position = 0;
    let match: RegExpExecArray | null;

    while ((match = algoRegex.exec(html)) !== null && results.length < maxResults) {
      const block = match[1];

      const titleH2 = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      const url = titleH2 ? this.decodeEntities(titleH2[1]) : '';
      const title = titleH2 ? this.decodeEntities(titleH2[2].replace(/<[^>]*>/g, '').trim()) : '';

      const cite = block.match(/<cite[^>]*>([\s\S]*?)<\/cite>/i);
      const displayUrl = cite ? this.decodeEntities(cite[1].replace(/<[^>]*>/g, '').trim()) : '';

      const capMatch = block.match(/<div class="b_caption"[^>]*>([\s\S]*?)<\/div>/i);
      const rawSnippet = capMatch
        ? this.decodeEntities(capMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim())
        : '';

      let publishedDate: string | undefined;
      let snippet = rawSnippet;

      const dateSpan = block.match(/<span[^>]*>([A-Z][a-z]+ \d{1,2}, \d{4})<\/span>/);
      if (dateSpan) {
        try {
          const parsed = new Date(dateSpan[1]);
          if (!isNaN(parsed.getTime())) {
            publishedDate = parsed.toISOString();
            snippet = rawSnippet
              .replace(dateSpan[1], '')
              .replace(/^[\s·\u00b7\u2022]+/, '')
              .trim();
          }
        } catch {
          // ignore parse error
        }
      }

      const finalUrl = displayUrl || url;
      if (title && finalUrl) {
        position++;
        results.push({
          title,
          url: finalUrl,
          snippet,
          published_date: publishedDate,
          raw_position: position,
          provider: 'bing',
        });
      }
    }

    if (results.length === 0) {
      if (/class="b_no"/i.test(html)) {
        logger.debug('Bing reports no results for this query');
        return results;
      }
      const hasCaptcha = /captcha|verify|blocked|challenge/i.test(html);
      if (hasCaptcha) {
        throw new Error('Bing returned a captcha/blocking page');
      }
      const hasSearchResults = /id="b_results"|class="b_algo"/i.test(html);
      if (!hasSearchResults) {
        throw new Error('Bing HTML structure may have changed — no result blocks found in response');
      }
    }

    return results;
  }

  private decodeEntities(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, '/')
      .replace(/&#(\d+);/g, (_m: string, n: string) => String.fromCharCode(parseInt(n, 10)));
  }
}
