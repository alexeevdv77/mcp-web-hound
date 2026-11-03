/**
 * Manual Bing provider check — one query, everything visible.
 *
 *   npm run test:bing
 *   npm run test:bing -- Сколько стоит солярка
 *   $env:BING_TEST_QUERY='Сколько стоит солярка'; npm run test:bing   # if the shell mangles Cyrillic
 *
 * Experiment knobs (env, no code edits needed):
 *   BING_FETCH_MODE=http|browser    which channel to use (browser = headless Chrome, typed query)
 *   BING_BROWSER_HEADLESS=false     watch Chrome work (visible window)
 *   BING_BROWSER_PATH=...           explicit Chrome/Edge binary
 *   BING_BROWSER_PROFILE_DIR=...    isolated profile (default: <config dir>/bing-chrome-profile)
 *   BING_BROWSER_TIMEOUT_MS=20000   per-search browser timeout
 *   BING_BROWSER_IDLE_MS=300000     close Chrome after this much idle time
 *   BING_USE_COOKIES=false          compare cookie-less vs warmed session (http channel)
 *   BING_MARKET=ru-RU               force a market param
 *   BING_ACCEPT_LANGUAGE=...        override the query-derived header
 *   BING_RESULTS_PER_PAGE=30        page size
 *   BING_MAX_PAGES=3                pages to scrape (http channel)
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
const { browserUnavailableReason, closeBrowser, isBrowserAvailable, resolveChromePath } = await import(
  '../src/search/providers/bing-browser.js'
);
const { config } = await import('../src/utils/config.js');

const provider = new BingProvider();

console.log('\n=== Bing provider check ===');
console.log(`query            : ${query}`);
console.log(`channel          : ${provider.fetchMode}`);
console.log(`maxResults       : ${maxResults} | perPage=${config.BING_RESULTS_PER_PAGE} | maxPages=${config.BING_MAX_PAGES}`);

if (provider.fetchMode === 'browser') {
  console.log(
    `browser          : ${isBrowserAvailable() ? `ready (${resolveChromePath()})` : `unavailable (${browserUnavailableReason()})`}` +
      ` | headless=${config.BING_BROWSER_HEADLESS} | timeout=${config.BING_BROWSER_TIMEOUT_MS}ms`,
  );
} else {
  console.log(`cookies          : ${config.BING_USE_COOKIES ? 'on' : 'off'} | market=${config.BING_MARKET || '(none)'}`);
  console.log(`Accept-Language  : ${config.BING_ACCEPT_LANGUAGE || '(derived from query)'}`);
}

const started = Date.now();
let error: string | null = null;
let results: Awaited<ReturnType<BingProvider['doSearch']>> = [];

try {
  results = await provider.doSearch(query, { intent: 'web', freshness: 'any', max_results: maxResults });
} catch (err) {
  error = err instanceof Error ? err.message : String(err);
} finally {
  // The shared Chrome process keeps the event loop alive — always shut it down.
  await closeBrowser();
}

if (captured.length > 0) {
  console.log(`\nHTTP requests (${captured.length}):`);
  captured.forEach((c, i) => {
    const algoCount = (c.body.match(/class="b_algo/g) || []).length;
    const markerFlags = [
      `b_algo=${algoCount}`,
      c.body.includes('class="b_no"') ? 'b_no=yes' : null,
      // same rule the provider uses: a captcha marker only matters when nothing was parsed
      algoCount === 0 && /g-captcha|captcha-invoker|b_capt/i.test(c.body) ? 'captchaHint=yes' : null,
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
