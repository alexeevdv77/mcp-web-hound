# Search Providers

## Overview

Providers work with the router, which selects the first 2 healthy providers and calls them in parallel. Results are aggregated, deduplicated, and reranked. If a provider is unavailable — fallback to the next ones.

## Tier 1 — Core (free, scraping)

### Startpage (Google Mirror)

| Parameter | Value |
|-----------|-------|
| Type | HTML scraping (Google results via proxy) |
| API | POST `startpage.com/sp/search` |
| Limits | Implicit (IP-based) |
| Key | Not required |
| Intents | web, docs, news |

**Features:**
- Free Google results without API key
- Uses `sc` code + preferences cookie for session
- Extracts date from snippet prefix: `Jan 27, 2026` or `27 Jan 2026`
- 1s delay between requests, incremental backoff on 429

> **⚠️ Undocumented limits.** Startpage does not publish scraping limits. May return captcha or empty results without clear reason.

**Configuration:**
```env
STARTPAGE_ENABLED=true
```

---

### DuckDuckGo

| Parameter | Value |
|-----------|-------|
| Type | HTML scraping |
| API | POST `html.duckduckgo.com/html/` |
| Limits | 10 req/min (IP-based) |
| Key | Not required |
| Intents | web, docs |

**Features:**
- Free, no registration
- 10 results per page, up to 1 page
- 1s delay between requests
- Rate limit with delay between requests

> **⚠️ Undocumented limits.** DDG frequently returns captcha when scraping. No official search API — HTML parsing only.

**Configuration:**
```env
DDG_ENABLED=true
DDG_DELAY_MS=1000
DDG_MAX_PER_MINUTE=10
```

---

### Brave Web

| Parameter | Value |
|-----------|-------|
| Type | HTML scraping |
| API | GET `search.brave.com/search` |
| Limits | Implicit (IP-based, 429 on burst) |
| Key | Not required |
| Intents | web, docs, news |

**Features:**
- Free, no registration
- 1s delay between requests
- 429/403 detection → incremental backoff suspension
- Cookies set: safesearch=off, useLocation=0, summarizer=0, country=us, ui_lang=en-us
- Retry-After header support if Brave starts sending it

> **⚠️ Undocumented limits.** Brave Search is not designed for scraping. Limits are not documented — may return 429 at any time. Brave API (official) is more stable but requires a key.

**Configuration:**
```env
BRAVE_WEB_ENABLED=true
```

---

### Bing

| Parameter | Value |
|-----------|-------|
| Type | HTML scraping / RSS feed |
| API | GET `bing.com/search` |
| Limits | Implicit (IP-based) |
| Key | Not required |
| Intents | web |

**Channel:** paged scraping of `/search?q=` — the request carries `q`, `count` and `first` and nothing else, so there is no session state and no warm-up request. Fast (~0.2 s), no dependencies.

**RSS channel (`BING_FETCH_MODE=rss`):** the same endpoint with `format=rss` returns an RSS 2.0 feed — one request, at most 10 items, no paging — with the real destination URL in `<link>` instead of a `bing.com/ck/a` tracking wrapper, plus `title`, `description` and `pubDate`. Measured 2026-11-06: 4.9–5.9 KB in 136–275 ms, `count=10|20|50` and `first=11|21` are ignored (always 10 items), and an empty query answers `200` with zero `<item>`s. Relevance is the same as the HTML channel — the feed does not fix the junk (it does serve Bing's warm block for a string that a real browser primed, see `docs/roadmap.md`) — so it is a cheaper structural channel, not a better one.

> **Parked: the headless-Chrome channel.** A second channel that typed the query into Bing's search box over CDP lives on the `bing-browser-mode` branch and is not shipped. Measured on 2026-11-04: overriding the user-agent to hide the `HeadlessChrome` token also switches off Chrome's Client Hints, and the request then carries no `Sec-CH-UA*` at all — Bing answers that client with a page that has **no results container** (`b_results`, `b_algo`, `b_content` all absent) and sets the Akamai bot cookie `ak_bmsc`. Honest headless UA gets a normal SERP; any UA lie (CDP override or `--user-agent` flag) gets nothing. **Re-measured 2026-11-06:** headless — however it is driven — returns the degraded head-token SERP for cold strings and cannot prime them; only a non-headless Chrome's search-box submit does (see `docs/roadmap.md`). The channel stays on the branch until that is solved.

**Features:**
- Free, no registration
- Query sent verbatim (UTF-8 percent-encoded) — works for any language, no transliteration
- Headers are constant and browser-like (`Chrome/131` UA, `Accept-Language: en-US,en;q=0.9`). Measured 2026-11-05: deriving the header from the query languages, pinning `en-US` or omitting it entirely made no difference to the SERP
- No market params (`mkt`/`setlang`/`cc`). Re-measured 2026-11-04 against the fix upstream SearXNG shipped for this engine ([PR #6671](https://github.com/searxng/searxng/pull/6671): `mkt` → `setlang=` + `cc=`, `us|cn|ru` skipped, `Accept-Language` override dropped): from this IP no combination changes the result set, and `cc=by|de` / `mkt=de-DE|kk-KZ` return zero results — see the Bing bullets in `docs/roadmap.md`
- No cookie session. Measured 2026-11-05 on 16 never-asked cold queries: cookie-less scraping returned a full SERP with 10 `b_algo` blocks every time, so the former homepage warm-up was dropped (it cost one extra request and changed nothing)
- Two channels behind `BING_FETCH_MODE`: `html` (paged SERP, default) and `rss` (single request, ≤10 items, real destination URLs; `BING_RESULTS_PER_PAGE`/`BING_MAX_PAGES` do not apply)
- Parses `b_algo` blocks from HTML results page
- Different index from DDG — expands coverage
- 1s between requests via slot reservation, so parallel tool calls don't fire simultaneously (that burst is what triggers contentless SERPs)

**Response checks — structural only:**

| Situation | Handling |
|-----------|----------|
| HTTP status ≠ 200 | provider error → the router moves to the next provider |
| captcha / blocking page | provider error → Bing gets suspended per the rate-limit policy |
| no organic blocks (`b_no` notice, or a "degraded" page without `b_algo`) | empty result set → Bing steps aside, Startpage/DDG/Brave answer |
| a page carries fewer results than requested | pagination stops, earlier pages are kept |
| HTML layout changed (no `b_results`/`b_algo`/`b_no` at all) | provider error, so the change is visible instead of silent |
| RSS response is not XML (captcha/block page) | provider error → same suspension policy as any other block |
| RSS feed carries no `<item>` | empty result set → same handling as a `b_no` page |

**What is deliberately *not* done:** the SERP is not scored for relevance. Text-overlap heuristics misjudge too many legitimate result sets (they reject good pages and accept plausible junk). If Bing answers a query badly, the other providers in the same merge compensate — the merged answer is reranked anyway.

> **⚠️ Undocumented limits.** Bing does not publish scraping limits. May return captcha under high request frequency. Quality is IP-, query- **and client**-dependent: for a multi-word string the plain-HTTP channel returns what the *first word* alone would return (measured 4/4 pairs, top-5 overlap 5/5), while the same string submitted from a non-headless Chrome's search box comes back relevant and stays warm for tens of minutes — for every later client on the same IP. A headless browser gets that content only if something else primed it. There is no header, cookie or parameter that changes this, so the provider cannot fix it on its own: Startpage/DDG stay in the chain and the merge is reranked. See the 2026-11-06 bullets in `docs/roadmap.md`.

**Configuration:**
```env
BING_ENABLED=true
BING_FETCH_MODE=html   # html | rss
```

Diagnostics: `npm run test:bing` prints every request and every fetched page with its verdict and latency; run `BING_FETCH_MODE=rss npm run test:bing` to check the feed channel — see [testing.md](testing.md).

---

## Tier 2 — Official APIs (free tier)

### Brave Search API

| Parameter | Value |
|-----------|-------|
| Type | Official REST API |
| Limits | 2000 requests/month (free) |
| Key | Required (free registration) |
| Intents | web, docs, news |

**Configuration:**
```env
BRAVE_API_KEY=BSA...
BRAVE_DAILY_LIMIT=60
```

---

### Tavily API

| Parameter | Value |
|-----------|-------|
| Type | AI-oriented search |
| Limits | 1000 requests/month (free) |
| Key | Required (free registration) |
| Intents | web, docs |

**Features:**
- Built specifically for AI agents
- Returns `content` (extracted text) out of the box
- Works well for docs intent
- Endpoint is configurable: `TAVILY_BASE_URL` routes the call through a proxy when the stock host is blocked

**Configuration:**
```env
TAVILY_API_KEY=tvly-...
TAVILY_DAILY_LIMIT=30
TAVILY_BASE_URL=https://api.tavily.com
```

**Endpoint override:** `TAVILY_BASE_URL` is the origin of the API or of a proxy in front of it. `/search` is appended automatically, so `https://proxy.example.com` and `https://proxy.example.com/search` both work; a trailing slash is ignored and an empty value falls back to `https://api.tavily.com`. The provider authenticates with `api_key` inside the JSON body (as before), so the proxy only has to forward the POST body — `npm run test:tavily` prints which endpoint was used and what came back. This matters in practice: on 2026-11-03 `api.tavily.com/search` returned `403 Forbidden` from our own network while the same key, sent through a proxy we run ourselves, returned `200` with results. A ready-to-deploy proxy is documented in [Tavily through a Cloudflare Worker](tavily-proxy-worker.md): a ~60-line Worker that forwards path, body and headers to `api.tavily.com`, keeps no credential on the Worker side and strips the upstream `content-encoding` that otherwise makes clients hang.

---

## Tier 3 — Optional

### Exa

| Parameter | Value |
|-----------|-------|
| Type | Semantic search |
| Limits | 1000 requests/month (free) |
| Key | Required |
| Intents | web, docs |
| Endpoint | `api.exa.ai/search`, overridable with `EXA_BASE_URL` |

```env
EXA_API_KEY=...
EXA_BASE_URL=https://api.exa.ai
```

**Endpoint override:** `EXA_BASE_URL` is the origin of the API or of a proxy in front of it. `/search` is appended automatically, so a proxy mounted under a path works too — `https://proxy.example.com/functions/v1/exa-api` and `https://proxy.example.com/functions/v1/exa-api/search` both resolve to the same call; a trailing slash is ignored and an empty value falls back to `https://api.exa.ai`. Unlike Tavily, Exa authenticates with the **`x-api-key` header**, so a relay has to forward headers as well as the JSON body. This matters in practice here: on 2026-11-06 `api.exa.ai/search` answered `403 Forbidden` from our own network, while the same key through a relay we run ourselves answered `200` with results. `npm run test:exa` prints the resolved endpoint, the HTTP status and the results.

**What a relay must do:** accept `POST {base}/search` with `content-type: application/json`, pass the body (`query`, `type`, `num_results`, `contents`, …) and the `x-api-key` header through unchanged, and return Exa's own JSON — `results[]` with `title`, `url`, `highlights`/`text`, `publishedDate`. The relay we run rejects a call without the header: `401 {"error":"x-api-key header is missing."}`. Keep the relay address out of this repository — placeholders only, same rule as in [Tavily through a Cloudflare Worker](tavily-proxy-worker.md). The relay script itself is not published yet.

**Snippets come from `contents.highlights`.** The provider asks for `{ contents: { highlights: true } }` and joins the passages Exa selected for each page, cutting the result to `EXA_SNIPPET_MAX_CHARS` = 600 characters (whitespace collapsed). Measured through our own relay on one ~10-result query: no contents → 2.3 KB answer and empty snippets, `contents.highlights` → 25.8 KB, `contents.text` (full page text) → 105.5 KB with pages up to 31 KB. After our cut the snippets total ~3.6 KB per search, so the provider no longer returns snippet-free rows. Costs: `costDollars` was the same `$0.007` in all three shapes — Exa's base `/search` price covers the first 10 results **with** contents (their changelog: “Search with contents: $7 per 1k requests (10 results, text + highlights included)”); only results above 10 add $1 per 1k, and the separate `/contents` endpoint is $1 per 1k pages per content type. Quirk to remember: top-level `text: true` is **not** a `/search` parameter — the API ignores it with the warning `text is not a top-level /search parameter … Send it as contents.text`.

### Firecrawl

| Parameter | Value |
|-----------|-------|
| Type | Web scraping + search |
| Limits | 500 credits/month (free) |
| Key | Required |
| API | `api.firecrawl.dev/v2/search` |
| Intents | docs |

```env
FIRECRAWL_API_KEY=...
```

---

## Provider Router: selection algorithm

```mermaid
flowchart TD
    START["Incoming Query"] --> HEALTH["Check health for first N providers (default 2)"]
    HEALTH --> PARALLEL["Call N healthy providers in parallel (up to MAX_PARALLEL_PROVIDERS)"]
    PARALLEL --> MERGE["Merge + deduplicate results"]
    MERGE --> RERANK["Rerank by relevance score"]
    RERANK --> RETURN["Return top-N to orchestrator"]
    
    HEALTH -->|"Fewer than N healthy"| FALLBACK["Use what's available"]
    FALLBACK --> PARALLEL
    
    PARALLEL -->|"All failed"| FAIL["Return error: all providers failed"]
```

## Routing Strategy

**Parallel request to 2 providers:**
1. Find the first 2 healthy providers in order
2. Call them in parallel via `Promise.allSettled`
3. Aggregate results
4. Reranker deduplicates by normalized URL and sorts

**Default provider order:** Startpage → DDG → Brave Web → Bing → Brave API → Tavily → Exa → Firecrawl  
Custom order via `PROVIDER_ORDER` in `.env` (comma-separated names).

If one provider fails — results from the other are still returned (parallel mode). Sequential mode stops on first success.

## Health Tracking

Each provider tracks:

```typescript
interface ProviderHealth {
  consecutive_errors: number;
  last_success: Date | null;
  last_error: Date | null;
  avg_latency_ms: number;
  requests_today: number;
  is_healthy: boolean;
}
```

**Provider is unhealthy if:**
- `consecutive_errors >= 3`

**Recovery:** an unhealthy provider gets a trial attempt on the next cycle. If successful — it recovers.
