/**
 * Manual Exa provider check — one query, including where the request actually went.
 *
 *   npm run test:exa
 *   npm run test:exa -- погода в москве
 *   $env:EXA_TEST_QUERY='погода в москве'; npm run test:exa   # if the shell mangles Cyrillic
 *
 * Experiment knobs (env, no code edits needed):
 *   EXA_BASE_URL=https://api.exa.ai    stock endpoint, or a proxy in front of Exa
 *                                      (/search is appended if it is not already in the path)
 *   EXA_API_KEY=...                    required; sent as the `x-api-key` header, which a proxy must forward
 *   EXA_TEST_MAX=10                    max_results for this run
 *   LOG_LEVEL=debug|info               (default debug here)
 *
 * Only the response contract is checked (HTTP status, result count) — no relevance scoring.
 *
 * Runs against src/ (tsx), so edits to src/search/providers/*.ts apply immediately.
 */

const query = process.argv.slice(2).join(' ').trim() || process.env.EXA_TEST_QUERY || 'sqlite vacuum';
const maxResults = Number(process.env.EXA_TEST_MAX || 10);

process.env.LOG_LEVEL ??= 'debug';

interface Captured {
  url: string;
  status: number;
  body: string;
}

const captured: Captured[] = [];
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const response = await realFetch(input as RequestInfo, init);
  const clone = response.clone();
  captured.push({ url: String(input), status: response.status, body: await clone.text().catch(() => '') });
  return response;
}) as typeof fetch;

const { ExaProvider, EXA_DEFAULT_BASE_URL } = await import('../src/search/providers/exa.js');
const { config } = await import('../src/utils/config.js');
const { installEnvProxy } = await import('../src/utils/proxy.js');
installEnvProxy();

const provider = new ExaProvider();

console.log('\n=== Exa provider check ===');
console.log(`query            : ${query}`);
console.log(`endpoint         : ${provider.searchUrl}`);
console.log(
  `channel          : ${provider.searchUrl.startsWith(EXA_DEFAULT_BASE_URL) ? 'stock api.exa.ai' : 'proxy (EXA_BASE_URL)'} ` +
    `| EXA_BASE_URL=${config.EXA_BASE_URL ?? '(unset)'} | x-api-key=${config.EXA_API_KEY ? 'set' : 'MISSING'}`,
);
console.log(`maxResults       : ${maxResults}`);

const started = Date.now();
let error: string | null = null;
let results: Awaited<ReturnType<ExaProvider['doSearch']>> = [];

try {
  results = await provider.doSearch(query, { intent: 'web', freshness: 'any', max_results: maxResults });
} catch (err) {
  error = err instanceof Error ? err.message : String(err);
}

if (captured.length > 0) {
  console.log(`\nHTTP requests (${captured.length}):`);
  captured.forEach((c, i) => {
    let shape = `non-json len=${c.body.length}`;
    try {
      const data = JSON.parse(c.body) as { results?: unknown[]; error?: unknown; detail?: unknown };
      const problem = data.error ?? data.detail;
      shape = `results=${data.results?.length ?? 0}${problem ? ` error=${JSON.stringify(problem).slice(0, 90)}` : ''}`;
    } catch {
      // keep the non-json note
    }
    console.log(`  ${i + 1}. ${c.status} ${c.url} | ${shape}`);
  });
}

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
