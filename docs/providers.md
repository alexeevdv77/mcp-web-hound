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
| Type | HTML scraping |
| API | GET `bing.com/search` |
| Limits | Implicit (IP-based) |
| Key | Not required |
| Intents | web |

**Channel:** paged scraping of `/search?q=` with a warmed cookie session. Fast (~0.2 s), no dependencies.

> **Parked: the headless-Chrome channel.** A second channel that typed the query into Bing's search box over CDP lives on the `bing-browser-mode` branch and is not shipped. Measured on 2026-11-04: overriding the user-agent to hide the `HeadlessChrome` token also switches off Chrome's Client Hints, and the request then carries no `Sec-CH-UA*` at all — Bing answers that client with a page that has **no results container** (`b_results`, `b_algo`, `b_content` all absent) and sets the Akamai bot cookie `ak_bmsc`. Honest headless UA gets a normal SERP; any UA lie (CDP override or `--user-agent` flag) gets nothing. The channel stays on the branch until that is solved.

**Features:**
- Free, no registration
- Query sent verbatim (UTF-8 percent-encoded) — works for any language, no transliteration
- `Accept-Language` derived from the languages actually present in the query, with an English fallback (`последняя версия npm` → `ru-RU,ru;q=0.9,en-US,en;q=0.6`)
- No forced market params: `mkt`/`setlang`/`cc` are mutually exclusive per Bing docs and forcing them produced junk or "no results" SERPs for non-English queries
- Bootstraps a browser-like cookie session once per worker (cookie-less Bing answers with a contentless "degraded" SERP)
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

**What is deliberately *not* done:** the SERP is not scored for relevance. Text-overlap heuristics misjudge too many legitimate result sets (they reject good pages and accept plausible junk). If Bing answers a query badly, the other providers in the same merge compensate — the merged answer is reranked anyway.

> **⚠️ Undocumented limits.** Bing does not publish scraping limits. May return captcha under high request frequency. Quality is IP- and query-dependent: some query strings get a "fallback" SERP from any client. Startpage/DDG stay in the chain and the merge is reranked.

**Configuration:**
```env
BING_ENABLED=true
BING_USE_COOKIES=true          # bootstrap a cookie session (recommended)
# BING_ACCEPT_LANGUAGE=...     # override the query-derived header
# BING_MARKET=ru-RU            # force a single market code (never combined with setlang/cc)
```

Diagnostics: `npm run test:bing` prints every request and every fetched page with its verdict and latency — see [testing.md](testing.md).

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

**Endpoint override:** `TAVILY_BASE_URL` is the origin of the API or of a proxy in front of it. `/search` is appended automatically, so `https://proxy.example.com` and `https://proxy.example.com/search` both work; a trailing slash is ignored and an empty value falls back to `https://api.tavily.com`. The provider authenticates with `api_key` inside the JSON body (as before), so the proxy only has to forward the POST body — `npm run test:tavily` prints which endpoint was used and what came back. This matters in practice: on 2026-11-03 `api.tavily.com/search` returned `403 Forbidden` from our own network while the same key, sent through a proxy we run ourselves, returned `200` with results.

---

## Tier 3 — Optional

### Exa

| Parameter | Value |
|-----------|-------|
| Type | Semantic search |
| Limits | 1000 requests/month (free) |
| Key | Required |
| Intents | web, docs |

```env
EXA_API_KEY=...
```

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
