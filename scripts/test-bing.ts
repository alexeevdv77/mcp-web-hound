/**
 * Manual Bing provider check — one query, everything visible.
 *
 *   npm run test:bing
 *   npm run test:bing -- Сколько стоит солярка
 *   $env:BING_TEST_QUERY='Сколько стоит солярка'; npm run test:bing   # if the shell mangles Cyrillic
 *
 * Experiment knobs (env, no code edits needed):
 *   BING_FETCH_MODE=rss             switch channel (html | rss)
 *   BING_RESULTS_PER_PAGE=30        page size (html channel only)
 *   BING_MAX_PAGES=3                pages to scrape (html channel only)
 *   BING_TEST_MAX=20                max_results for this run
 *   LOG_LEVEL=debug|info            (default debug here)
 *
 * The response is only checked structurally (status / captcha / empty page) —
 * this script prints what Bing actually returned, no relevance scoring.
 *
 * Runs against src/ (tsx), so edits to src/search/providers/*.ts apply immediately.
 */

const query = process.argv.slice(2).join(' ').trim() || process.env.BING_TEST_QUERY || 'последняя версия npm';
const maxResults = Number(process.env.BING_TEST_MAX || 10);

process.env.LOG_LEVEL ??= 'debug';

interface Captured {
  url: string;
  requestHeaders: Record<string, string>;
  status: number;
  body: string;
}

const captured: Captured[] = [];
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const response = await realFetch(input as RequestInfo, init);
  const clone = response.clone();
  captured.push({
    url: String(input),
    requestHeaders: (init?.headers ?? {}) as Record<string, string>,
    status: response.status,
    body: await clone.text().catch(() => ''),
  });
  return response;
}) as typeof fetch;

const { BingProvider } = await import('../src/search/providers/bing.js');
const { config } = await import('../src/utils/config.js');

const provider = new BingProvider();

const channel = config.BING_FETCH_MODE;

console.log('\n=== Bing provider check ===');
console.log(`query            : ${query}`);
console.log(`channel          : ${channel === 'rss' ? 'rss (feed)' : 'html (scraping)'}`);
console.log(
  channel === 'rss'
    ? `maxResults       : ${maxResults} | RSS feed caps at 10 items; count/first are ignored by Bing`
    : `maxResults       : ${maxResults} | perPage=${config.BING_RESULTS_PER_PAGE} | maxPages=${config.BING_MAX_PAGES}`,
);

const started = Date.now();
let error: string | null = null;
let results: Awaited<ReturnType<BingProvider['doSearch']>> = [];

try {
  results = await provider.doSearch(query, { intent: 'web', freshness: 'any', max_results: maxResults });
} catch (err) {
  error = err instanceof Error ? err.message : String(err);
}

if (captured.length > 0) {
  console.log(`\nHTTP requests (${captured.length}):`);
  captured.forEach((c, i) => {
    const algoCount = (c.body.match(/class="b_algo/g) || []).length;
    const isXml = c.body.trimStart().startsWith('<?xml');
    const itemCount = (c.body.match(/<item>/gi) || []).length;
    const markerFlags = [
      isXml ? `xml items=${itemCount}` : `b_algo=${algoCount}`,
      !isXml && c.body.includes('class="b_no"') ? 'b_no=yes' : null,
      // same rule the provider uses: a captcha marker only matters when nothing was parsed
      !isXml && algoCount === 0 && /g-captcha|captcha-invoker|b_capt/i.test(c.body) ? 'captchaHint=yes' : null,
    ].filter(Boolean).join(' ');
    console.log(`  ${i + 1}. ${c.status} ${c.url.slice(0, 110)}`);
    const al = c.requestHeaders['Accept-Language'];
    const cookie = c.requestHeaders['Cookie'];
    if (al) console.log(`       Accept-Language: ${al}`);
    if (cookie) console.log(`       Cookie: ${cookie.split(';').map((p) => p.trim().split('=')[0]).join(' ')}`);
    if (c.url.includes('/search')) console.log(`       markers: ${markerFlags}`);
  });
}

console.log(`\nfetches (${provider.attempts.length}):`);
provider.attempts.forEach((attempt, i) => {
  const status = attempt.status ? ` HTTP ${attempt.status}` : '';
  console.log(
    `  ${String(i + 1).padStart(2)}. [${attempt.mode.padEnd(7)}] p${attempt.page} ${attempt.verdict.padEnd(6)}` +
      ` results=${String(attempt.results).padStart(2)}${status} ${String(attempt.ms).padStart(5)}ms` +
      `${attempt.reason ? ` — ${attempt.reason}` : ''}`,
  );
});

if (error) {
  console.log(`\nprovider error   : ${error}`);
  process.exitCode = 1;
} else {
  console.log(`\nresults          : ${results.length}`);
  results.forEach((r, i) => {
    const date = r.published_date ? ` (${r.published_date.slice(0, 10)})` : '';
    console.log(`  ${String(i + 1).padStart(2)}. ${r.title.slice(0, 70)}`);
    console.log(`      ${r.url.slice(0, 100)}${date}`);
    if (r.snippet) console.log(`      ${r.snippet.slice(0, 110)}`);
  });
}

console.log(`\nelapsed          : ${Date.now() - started} ms\n`);
