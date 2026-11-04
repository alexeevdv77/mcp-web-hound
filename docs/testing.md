# Testing

## Quick Start

```bash
# Run all unit tests
npm test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage

# Integration tests (live API — requires .env keys)
npm run test:providers

# All tests (unit + integration)
npm run test:all
```

## Ad-hoc Bing SERP check (live)

Pushes one real query through `BingProvider` and prints everything needed to debug a bad SERP:

- config in effect (cookies / market / `Accept-Language`)
- every HTTP request (URL, `Accept-Language`, cookie names, SERP markers: `b_algo` count, `b_no`, captcha hint)
- the **fetch log** — one row per page: `[http] p1 usable results=10 HTTP 200 197ms`, plus the reason when the page was empty
- the results exactly as Bing returned them — the script does not score relevance, it shows what is there

It runs on `src/` via `tsx`, so edits to `src/search/providers/*.ts` take effect without a build.

```bash
npm run test:bing                                  # default query
npm run test:bing -- Сколько стоит солярка         # any query, any language

# experiment without touching code
BING_USE_COOKIES=false npm run test:bing           # cookie-less vs warmed session
BING_MARKET=de-DE npm run test:bing                # force a market param
BING_ACCEPT_LANGUAGE=ru-RU npm run test:bing       # override the derived header
BING_RESULTS_PER_PAGE=30 BING_TEST_MAX=30 npm run test:bing
LOG_LEVEL=info npm run test:bing                   # quieter than the default debug
```

PowerShell equivalent (and the safe way to pass non-ASCII text if your console mangles it):

```powershell
$env:BING_TEST_QUERY='Сколько стоит солярка'; npm run test:bing
```

Reading the fetch log:

| Column | Meaning |
|--------|---------|
| `[http]` | fetch channel — scraping of `/search?q=` |
| `p1`, `p2`, … | page within this search (the channel walks pagination) |
| `usable` | the page carried organic `b_algo` blocks — results were returned |
| `empty` | contentless page (`degraded SERP (no organic blocks)`) or Bing reported no results |
| `error` | the fetch itself failed (HTTP status, captcha) — shown as a provider error |

## Test Structure

```
tests/
├── search/
│   ├── providers/
│   │   ├── duckduckgo.test.ts   — DDG HTML scrape parsing
│   │   ├── bing.test.ts         — Bing parse + response verdicts, mocked
│   │   ├── brave.test.ts        — Brave Search API (mocked)
│   │   ├── tavily.test.ts       — Tavily API (mocked)
│   │   ├── exa.test.ts          — Exa API (mocked)
│   │   └── firecrawl.test.ts    — Firecrawl v2 API (mocked)
│   ├── orchestrator.test.ts     — Full search pipeline
│   ├── provider-router.test.ts  — Parallel fallback logic
│   ├── provider-registry.test.ts
│   ├── query-locale.test.ts     — Accept-Language derived from the query script
│   ├── reranker.test.ts         — Domain/freshness/position scoring
│   ├── query-normalizer.test.ts — Cache key generation
│   ├── intent-classifier.test.ts
│   └── search.test.ts           — Tool layer validation
├── embeddings/
│   └── embedding-service.test.ts
├── limits/
│   ├── budget-manager.test.ts
│   ├── rate-limit-store.test.ts
│   └── session-store.test.ts
├── providers/
│   └── base-provider.test.ts
├── tools/
│   └── fetch-retry.test.ts
├── utils/
│   ├── types.test.ts            — parseConfig / FIELD_DEFS validation
│   └── config-help.test.ts
└── integration/
    └── providers.integration.test.ts — Live API smoke tests
```

## Coverage

Current coverage targets (enforced by vitest):

| Metric | Target |
|--------|--------|
| Statements | 50% |
| Branches | 35% |
| Functions | 55% |
| Lines | 55% |

Coverage report: `./coverage/index.html`

## Writing Tests

### Provider Unit Tests

Mock the `search()` method on each provider. Use vitest `vi.mock()` for config and HTTP:

```ts
import { BraveProvider } from '../../src/search/providers/brave.js';

vi.mock('../../src/utils/config.js', () => ({
  config: { BRAVE_API_KEY: 'test-key' },
}));
```

### Integration Tests

Set the corresponding env var in `.env` to enable live testing for a provider. Tests skip automatically if the key is missing:

```ts
const config = { BRAVE_API_KEY: process.env.BRAVE_API_KEY };
const isConfigured = !!config.BRAVE_API_KEY;

(isConfigured ? describe : describe.skip)('Brave (live)', () => { ... });
```

## CI

The CI workflow (`.github/workflows/ci.yml`) runs unit tests on Node 20 and 22, lint, and build on every push and pull request.
