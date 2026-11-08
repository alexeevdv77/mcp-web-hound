# Roadmap

## V1 — MVP (1–2 days)

Minimally working version with one provider and basic cache.

### Tasks

- [x] Project init (TypeScript, `@modelcontextprotocol/sdk`)
- [x] MCP transport (stdio, JSON-RPC)
- [x] Tool: `search` with zod validation
- [x] Tool: `status` with basic diagnostics
- [x] Query Normalizer (lowercase, trim, cache key)
- [x] SQLite cache (queries, results, pages)
- [x] TTL-based eviction
- [x] DuckDuckGo adapter (HTML scraping)
- [x] Sequential fallback (DDG → Bing)
- [x] Content Fetcher (HTTP GET → readability → markdown)
- [x] Budget Manager (search limit, fetch limit)
- [x] Rate limiting (per-provider)
- [x] Structured logging
- [x] `.env` configuration
- [x] Tests: unit for each module
- [x] Tests: integration smoke test

### V1 Result

Agent calls `web_search()` → first healthy provider responds → results cached.

---

## V2 — Semantic Layer + Tier 2 (3–5 days)

Semantic cache and official API providers.

### Tasks

- [x] Embedding service (multilingual-e5-small)
- [x] sqlite-vec integration
- [x] Semantic query cache (find similar, threshold 0.92)
- [x] Query deduplication (buffer last 50 queries)
- [x] Provider: Brave Search API adapter
- [x] Provider: Tavily API adapter
- [x] Reranker: semantic similarity scoring
- [x] Reranker: domain quality scoring
- [x] Reranker: freshness scoring
- [x] Reranker: position blending
- [x] Weighted final score
- [x] Intent-independent reranking weights
- [x] Deduplication by URL
- [x] Provider health tracking
- [x] Provider health recovery (5-min retry)
- [x] Extended `status()` (provider health, cache stats)
- [x] Tests: semantic cache
- [x] Tests: reranker scoring

### V2 Result

Agent gets deduplicated, ranked results. Similar queries don't waste budget. 4 providers with fallback.

---

## V3 — Specialization + Production (1–2 weeks)

Specialized search modes and production-ready hardening.

### Tasks

- [x] GitHub-specific search (GitHub API, repos/code/issues/users)
- [x] GitLab-specific search (GitLab API, projects/issues/MRs/blobs)
- [x] Docs-specific search — covered by `intent: "docs"` + reranker, separate tool not needed
- [x] Intent routing via NLI zero-shot (DeBERTa-v3-xsmall, 4 labels, softmax)
- [x] NLI-based reranking (intent-independent: 0.9 NLI + 0.04 domain + 0.03 freshness + 0.03 position)
- [ ] Advanced ranking: learning-to-rank based on agent feedback
- [ ] Provider health scoring (composite: latency + error rate + quality)
- [x] Provider: Exa adapter
- [x] Provider: Firecrawl adapter
- [x] Parallel multi-provider queries
- [x] Result aggregation across multiple providers
- [x] Config-driven provider order, execution mode (parallel/sequential), pagination
- [x] Search timeout, cached TTL, max results after rerank
- [x] Browser User-Agent for fetch layer
- [x] robots.txt — not needed: not a crawler, budget limits already protect sites
- [x] Cache analytics — not needed: agent doesn't use cache internals, status tool covers basics
- [x] DB migration system
- [x] Graceful shutdown (finish in-flight, close DB)
- [ ] Optional vector index (for large cached query volumes)
- [x] Comprehensive test suite
- [ ] Performance benchmarks
- [ ] Docker image
- [x] Documentation: deployment guide (OpenCode)
- [x] CI workflow (Node 20/22, npm ci, build, test)
- [x] GitLab tool hidden when token absent

### V3 Result

Production-ready MCP Search Server with 6 providers, GitHub/GitLab search, config-driven provider order, parallel/sequential execution, per-provider pagination limits, and full test suite.

---

## V4 — Stability & Local Search (In Progress)

### Status snapshot — 2026-11-04 (Bing bullets extended 2026-11-06)

- **Branches.** `master` ships the scraping channels only (Startpage, DDG, Brave Web, Bing). `bing-browser-mode` is 3 commits ahead with the unshipped headless-Chrome Bing channel (see the parked entry below). `master` is pushed and level with `origin/master` (2026-11-05); `bing-browser-mode` stays local. The published npm package is `1.12.3` while the fork is `1.12.2`, so `npm update -g` silently replaces a local build — bump to `2.0.0` before any publish.
- **Upstream.** Upstream is at `8a3a9a7` (1.12.3) and not merged; the fork's provider set and config surface differ from it.
- **Bing.** The structural channel works, the content does not for cold query strings (S2) — unless the string has been primed by a real browser (2026-11-06 bullets below). Upstream SearXNG has the same bug and closed it on 2026-09-11: [issue #4964](https://github.com/searxng/searxng/issues/4964) "bing: results are often unrelevant to the search query", fixed by [PR #6671](https://github.com/searxng/searxng/pull/6671) "[fix] engines: bing first word results" — `mkt=` replaced by `setlang=` + `cc=` (skipping `us`, `cn`, `ru`: "bing just sends junk for these") and the `Accept-Language` override dropped. **Measured here 2026-11-04 (`logs/bing-locale-q1.txt`, `bing-market.txt`), none of it moves us:** one cold Cyrillic string × ten parameter sets — `setlang=ru`, `setlang=ru cc=ru` (byte-identical junk, confirming the `cc=ru` claim), `mkt=en-US` / `en-GB` / `ru-RU`, `ensearch=1`, browser-style `form=QBLH&cvid=<guid>&qs=BT` — all return the same filler, while `cc=by`, `cc=de`, `mkt=de-DE`, `mkt=kk-KZ` return *zero* results. This IP is auto-associated with the RU market (the SERP localizes to Одинцово), the very market upstream calls garbage, and return42's note in that PR — once Bing ties an IP to a market it keeps answering from it — is what we observe. No provider-level fix planned.
- **Bing *is* client-side after all (open question 1 revisited, 2026-11-06).** The 2026-11-04 "not client-side" answer above was measured the wrong way: those strings were **navigated to** (`/search?q=…` in the address bar or over CDP), and a navigation never primes. What primes is a submit **from Bing's search box in a non-headless Chrome**: put the string into `#sb_form_q`, press Enter — a string that was cold a second earlier comes back relevant, and for at least the next 45 min the same string answers with the same relevant block to a cookie-less `fetch`, to headless Chrome, and to the RSS channel. Headless `--headless=new` typed the same way returns the degraded SERP and primes nothing (only *reads* warm state); visible, offscreen (`--window-position=-32000,-32000`) and minimized windows all prime, so the gate is headless-vs-not — not window visibility, not CDP, not cookies or headers. Chrome is killed right after each measurement and the state survives it, so it lives on Bing's side. Logs: `bing-chrome-prime-headless2.txt`, `bing-chrome-prime-visible.txt`, `bing-chrome-prime-offscreen.txt`, `bing-chrome-prime-minimized.txt`.
- **The junk has a shape — Bing answers one word of the query** (the "first word" of the upstream PR title): «замена подшипника стиральной машины indesit цена» → the 1996 film «Замена» on rutube; «сколько стоит бензин» / «…солярка» → online calculators and the Wiktionary entry for «сколько»; «купить чехол на телефон самсунг а15 в орле» → Ozon / Avito / Яндекс.Маркет homepages; «how to reset an iphone to factory settings» → a Belarus forum; «how to install docker on debian» → "Download Chrome / Windows 11 Assistant / Python / Roblox".
- **Two structural detectors, both measured, neither implemented (decision 2026-11-04: record only, no code).** (a) the S2 cross-engine domain gate; (b) **query-token coverage of the organic block**, which needs no other engine — stem the informative query tokens (≥3 chars, either script, no bare digits) and count how many appear in the parsed `b_algo` titles+URLs: junk covers 0 or 1 of 3–7 tokens, a healthy SERP covers ≥2. Clean split with no overlap on 8 saved dumps + 15 live queries (`tools/analyze-junk-coverage.cjs`): 0.00–0.17 junk vs 0.67 good.
- **Bing RSS channel (found in the upstream thread).** `GET /search?q=…&format=rss` answers 200 `text/xml`, 4–6 KB in 140–275 ms, with plain destination URLs — no `/ck/a` wrapper to unwrap — and no JS challenge. Relevance is the same filler, and per that thread `safesearch`, pagination and language do not work on it. Recorded 2026-11-04; adopted as a switchable mode on 2026-11-06 (next bullet).
- **Bing request simplified (2026-11-05).** The provider now sends `q`/`count`/`first` with constant browser-like headers and nothing else; the cookie session, the query-derived `Accept-Language` and the `mkt` override are gone, together with `BING_USE_COOKIES`/`BING_ACCEPT_LANGUAGE`/`BING_MARKET` and `src/search/query-locale.ts` (which only Bing used). Measured before removing, on 16 never-asked cold queries: warmed session / cookie-less / query-derived AL / fixed `en-US` AL / no AL at all — **16/16 full SERPs with 10 `b_algo` blocks**, not one degraded page, same filler class everywhere. The warm-up was one extra request per worker and changed nothing. A follow-up A/B the same day — 6 never-asked strings, each asked cookie-less and cookied, order alternated per string — gave `b_no` ("no results") pages 1/6 in **both** modes, so those are query- and IP-state-dependent, not a cookie artefact. `ws` + `@types/ws` left `package.json` in the same pass: only the parked Chrome channel ever imported them.
- **The Cloudflare Worker redirects, it does not proxy (2026-11-05).** A personal Worker in front of Bing answers `GET /search?q=…` with `301` to `https://www.bing.com:443/search?q=…&toWww=1&redig=<guid>` and sets a fresh random `MUID`/`MUIDB` per request. The client follows the redirect and still egresses from its own IP, so the Worker cannot change the market or the junk tier — it is a cookie dispenser, and those cookies did not help either. Not wired in; the address is private and deliberately not recorded here.
- **Bing RSS channel shipped as a switchable mode (2026-11-06).** `BING_FETCH_MODE=html|rss` (`html` by default) picks the channel inside the single Bing provider — one rate-limit bucket, since both channels hit the same service from the same IP. Feed shape re-measured before wiring it (`logs/bing-rss-shape.txt`): `count=10|20|50` and `first=11|21` are ignored (always 10 items), an empty query answers `200` with zero `<item>`s, payload is 4.9–5.9 KB in 136–275 ms, and `<link>` carries the real destination URL — no `/ck/a` wrapper to unwrap. Relevance is unchanged (same one-word junk: «замена подшипника стиральной машины indesit цена» → the 1996 film on rutube), so the mode is a cheaper structural channel, not a relevance fix. A second call to the Worker with the redirect params (`toWww=1&redig=…`) was also measured the same day and changed nothing: the Worker echoes the params it is given and never egresses to Bing, so the variant is byte-equivalent to a direct request (`logs/worker-second-call2.txt`).
- **The degraded SERP is the head-token SERP — for common head tokens (2026-11-06).** Four fresh cold pairs, each full query against its first word alone, **top-5 overlap 5/5 in all four** — «купить стиральную машину в москве дешево» ≡ «купить» (Ozon/Avito/Wildberries/DNS homepages), «postgresql partitioning strategy large tables» ≡ «postgresql» (postgresql.org, metanit, downloads), «best hiking trails in georgia country» ≡ «best» (Cambridge Dictionary, wooordhunt), «аренда генератора qqzzx цена wwyyv москва» ≡ «аренда» (Izhevsk apartments). So for the "first word" family the mechanism is plain truncation: when the client looks automated, the pipeline keeps only the **first token** of the query, which is also why a single-word common query looks fine (`замена` → the 1996 film, correct for that token). Scope limit measured the same day (`bing-headterm2.txt`): the unrelated-filler family from 2026-11-03 does **not** follow the rule — «pt100 sensor probe 6mm…» and «tantalum capacitor 470uF…» now return no organic block at all, while the head tokens give a different junk set or nothing («pt100» → «no healthy upstream» error articles, «tantalum» → zero items, «вакуумный» → Wikipedia). Truncation therefore explains the common-token junk, not the rare-token filler; that family stays unexplained. Log: `bing-headterm.txt`.
- **Priming works in bulk, and it works for ordinary queries (2026-11-06).** One offscreen Chrome session, throw-away profile, 6 strings typed one after another: 5/6 came back relevant in the browser **and** as a cookie-less HTTP SERP a second later, at **~1.3–1.4 s per typed search** (homepage load 0.6–0.7 s included; 27.8 s wall for the whole run including the before/after HTTP checks). Real queries behave the same way: «купить холодильник в москве недорого» cold → Ozon/Avito/Wildberries homepages, primed → vashholodilnik.ru / market.yandex.ru / an Ozon refrigerator category; «postgresql jsonb index performance» cold → the postgresql.org homepage, primed → sitepoint/neverblink/Sling Academy JSONB-indexing guides; «best time to visit japan cherry blossom» cold → Cambridge Dictionary, primed → travel guides. The one string that did not change (`замена`) is a single common word, where the head-token SERP already is the answer. Priming does **not** generalise: after these runs, fresh cold strings still returned their head-token SERP (`bing-headterm.txt` was measured after the batch). Driving the box is also best-effort, not mechanical: one of ~8 runs dispatched Enter before Bing's JS had armed the form, stayed on the homepage and warmed nothing (`bing-prime-w3.txt`), so any implementation has to verify the resulting SERP instead of trusting that the key events went out. Log: `bing-prime-batch2.txt`.
- **Bing warm state is readable by the RSS channel too (2026-11-06).** On a primed string the feed returns the same relevant 10 items in 5.4 KB with real destination URLs; on a cold string it returns the head-token block. The "EMPTY 0 items" in the first TTL log entries was a monitor bug (an HTML `b_algo` parser applied to XML), not Bing. Log: `bing-rss-warm.txt`.
- **How long a primed string stays warm (2026-11-06).** Two strings primed by box submits, Chrome closed a minute later, then polled cookie-less for 45 min. W1, every 60 s: `ok 10/10` on **all 46 samples** (+0.0 → +43.6 min). W2, every 5 min: 9 of 10 samples ok, with `JUNK` once at +9.7 min and ok again at +14.6 and +43.6. No expiry inside the window — W2 (primed before the run) is still warm after roughly an hour, and W1 never dropped once. The single degraded read is the shape of probabilistic routing, not of a TTL, so nothing suggests reads refresh the state. Practical reading: warm for an hour or more, but an occasional read can still come back degraded, so a consumer has to handle that. All clients in these runs share one exit IP, so "per IP" vs "global per string" is not separated — the only other egress available (the Worker) redirects instead of proxying. Log: `bing-ttl.txt`.
- **Outbound egress is now controllable two ways (2026-11-06).** (a) *Transport:* the standard proxy variables are honoured — `installEnvProxy()` (`src/utils/proxy.ts`) installs undici's `EnvHttpProxyAgent` as the global dispatcher in the main process, the hot worker and the provider scripts when `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` (any case) are set; nothing is touched when they are not. Measured against a local stub proxy that logs every `CONNECT` and answers `502`: before the change `HTTPS_PROXY` was ignored (Bing answered 10 results in 280 ms with an empty proxy log); after it the same run logs `CONNECT www.bing.com:443` and fails in 20 ms, and adding `bing.com` to `NO_PROXY` restores direct egress (10 results, 270 ms, no new log entry). Through the real MCP path the `CONNECT` list covers startpage, ddg, brave, bing, exa, firecrawl **and** `huggingface.co` — model downloads follow the same route. Node's own `NODE_USE_ENV_PROXY=1` reproduces the behaviour but exists only on Node 24, while `engines` is Node 20+, hence the dependency on `undici@^7` (floor `20.18.1`). (b) *Per provider:* the endpoint origin is configurable — `TAVILY_BASE_URL`, and now `EXA_BASE_URL` too, both resolved by `searchEndpoint()` (`src/utils/endpoint-url.ts`): origin or proxy prefix, `/search` appended unless already in the path, trailing slash ignored, empty falls back to the stock origin. Exa needed it for the same reason Tavily did: `api.exa.ai/search` answers `403 Forbidden` from this network (157 ms, measured 2026-11-06), while the same `x-api-key` through a relay we run answers `200` with 3 results in ~0.5 s. Unlike Tavily (credential in the JSON body), Exa sends the key as the **`x-api-key` header**, so an Exa relay has to forward headers, not only the body; the relay rejects keyless calls with `401 {"error":"x-api-key header is missing."}`. The relay script is documented as of 2026-11-06 in `docs/exa-proxy-edge-function.md` (Supabase Edge Function: deploy with `verify_jwt = false`, behaviour table, security, limits) — real addresses stay out of the repository (placeholders in `default.env`, `docs/providers.md` and that doc). Manual checks: `npm run test:exa`, `npm run test:tavily`. (c) *Payload shape:* the Exa provider now asks for `{contents:{highlights:true}}` and cuts the passages to 600 chars, because a plain Exa answer carries no text at all — measured through the relay on one ~10-result query: 2.3 KB (no contents) / 25.8 KB (highlights) / 105.5 KB (`contents.text`, one page up to 31 KB), all at the same `costDollars` `$0.007`: Exa's base search price already covers contents for the first 10 results, only results above 10 bill extra ($1 per 1k). Full page text would have put ~100 KB per search into the SQLite cache and into the agent's context for no money, so highlights + a 600-char cut (≈3.6 KB per search) is what shipped.
- **Coexistence with OpenCode's built-in web search (measured 2026-11-06).** An agent here has two search paths: OpenCode's built-in `websearch` and this server. The built-in one **fails with `HTTP 403`** from this network, because it always uses stock origins and has no endpoint override — `api.tavily.com` and `api.exa.ai` are blocked here, and OpenCode rotates providers only on `429` (a `403` is not a rate limit, and a session keeps its selected provider until it is rate limited), so the call just fails. `api.firecrawl.dev` is the one API provider reachable without a relay: `v2/search` answered `400` to an empty body and, through our own provider, 5 results with snippets (146–1 785 characters) on a real query — worth remembering because Firecrawl sits last in `PROVIDER_ORDER` and is capped by `FIRECRAWL_RPM=5`/`RPD=15`/`RPMONTH=500`. Our side: with the default config the server advertises **three** tools (`web_search`, `status`, `github_search`) — `report_search_usage` needs `SEARCH_LOG_ENABLED` and `gitlab_search` needs `GITLAB_TOKEN`, so a client reporting `tools=3` is not broken. V2 puts our tools behind Code Mode (`codemode` defaults to `true`), which is why calls arrive as `execute` → `tools["web_search"]["web_search"]`; `"codemode": false` declares them directly, `"websearch": false` or a `websearch` deny rule removes the broken built-in tool, and denying all of our tools also removes our 1 331-character protocol block from the prompt. All of this is written up in `docs/deployment-opencode.md`. Correction to an earlier note in this file: the Exa/Tavily/Firecrawl keys are **user-level environment variables** on this machine (`configure --json get` shows them masked with `isSet: true`), so Exa and Firecrawl are active, not skipped — only `BRAVE_API_KEY` is absent. The practical ceiling for an agent that searches per factual question was `BUDGET_MAX_SEARCHES=15` per 30 minutes, not the choice of tool — raised to 30 the same day, see the bullet below.
- **Budget default raised 15 → 30 searches per window (2026-11-06).** Trigger: the neighbouring session reported the budget window as the only real bottleneck of an agent session ("бюджет 15 поиска / 30 мин"), and one exchange moved the DDG/Bing daily counters and `cache.total_queries` (31 → 32) — 15 searches is one short session for an agent that searches per factual question. Changed in: `FIELD_DEFS` (`src/utils/types.ts`), `default.env`, `docs/budget.md` (limits table, the env block, the exhausted-budget response and the example trace), `docs/configuration.md`, `docs/architecture.md` (sequence diagram), the default assertion in `tests/utils/types.test.ts`. Provider test fixtures still pass an explicit `BUDGET_MAX_SEARCHES: 15` — deliberate, they test fixtures, not the default. The server `.env` also pins `BUDGET_MAX_SEARCHES=30` explicitly, so the already-installed 1.12.2 build (default 15) behaves the same as the working tree. Per-provider caps untouched: `FIRECRAWL_RPM=5`/`RPD=15`/`RPMONTH=500`, `TAVILY_RPD=30`, `EXA_RPD=30`, `BRAVE_RPD=60`.
- **Documentation policy: published docs are machine-agnostic (2026-11-06, `AGENTS.md` rules 14–16).** Scrubbed from `docs/` (roadmap excepted) and `CHANGELOG.md`: "measured on <date> from this network", provider status codes seen here (Tavily/Exa `403`, Firecrawl `400`/results, 157 ms, 927 bytes, 3 results), Bing header/cookie/market measurements, the Chrome-client comparison table, and the tool-count probe. What replaced them is the failure class — "the stock origin may be blocked or unreachable from your network", "a proxy you run restores the call" — plus pointers here ("measurements: `docs/roadmap.md`"). Numbers that describe the *vendor* rather than this host were kept (Exa payload/pricing shape, Supabase quotas). Rule 15: config docs give one recommended example (mirrored in `README.md`) and one sentence per optional flag, no flag matrices. Rule 16 records the standing ban on real relay addresses and keys in committed files.
- **Conditionally clean install from GitHub, audited by an independent agent (2026-11-08).** Method: parked the server `.env` (60 tuned keys → `~/.config/mcp-web-hound/.env.clean-test-bak`), removed the global npm install, installed `github:alexeevdv77/mcp-web-hound`, then supplied **only** the two settings the repo does not ship (`TAVILY_BASE_URL`, `EXA_BASE_URL` — the relays), leaving keys to the Windows user environment variables. Result: install exit 0 in **22.7 s** with `prepare` building `dist/` (gitignored) and **42 packages**; binary runs; handshake **126 ms**, instructions **1 331 chars**, **3 tools**; one real `web_search` → **10 results in 4.07 s**, snippets 173–1 464 chars, sources `duckduckgo` + `tavily` (Tavily through the Worker relay — relay-1 proven end-to-end; the Exa relay was never exercised because Exa handled 0 requests); `status` → budget 29/30, cache 33 queries, Startpage suspended (`captcha?`), Brave Web suspended (429), Bing empty, DDG/Tavily healthy. Machine: node v24.22.1, npm 11.19.1. **The documented Windows workaround did not reproduce**: `--install-links=false` also succeeded, because `install-links=true` was already set globally — the README now says to check `npm config get install-links` first instead of implying the plain command fails. **The real find is a silent downgrade of the AI stack:** the Git install dropped the *optional* `@xenova/transformers` dependency (`TAR_ENTRY_ERROR` on `protobufjs/cli` in the npm log, `@xenova` left empty, `onnxruntime-node` absent, 42 packages vs 87 from the registry tarball), so the server started with "Failed to load embedding model, semantic features disabled" and "Failed to load NLI model" while the shipped defaults still say `SEMANTIC_ENABLED=true`, `RERANK_ENABLED=true`, `MODEL_WORKER=true` — embedding dedup and NLI intent were off, heuristic reranking still worked and `nli_score` stayed 0.5. Not a clean room otherwise: `data/search.db` (303 KB, pre-test) and `rate-limits.json` pre-existed, and three servers from 15:35 kept running the old code image; the test added one query (DB 315 392 B + 82 432 B WAL). Fixed in published docs the same day: README install block (conditional workaround, npm 11 `allowScripts` is informational, `npm ls -g @xenova/transformers` check, endpoint-override pointer), README tool table (conditional `gitlab_search`/`report_search_usage`, "result count is `MAX_RESULTS_AFTER_RERANK`, unknown args ignored"), `docs/configuration.md` (endpoint URLs are printed verbatim by `configure`/`status`), and a troubleshooting entry for the missing model stack. Parked for approval (code): `status` should report *why* the models are off; `InitializeResult.instructions` always advertises `gitlab_search` even when it is not registered (and never mentions `report_search_usage`); `web_search` silently ignores unknown arguments; `healthy: true` survives an active suspension; `--help` creates `.env`; and a Git install of `master` still reports `1.12.2` (the 2.0.0 bump is still open). Decided 2026-11-08: endpoint overrides stay **unmasked** in `configure`/`status` output — masking is not required, the invariant is that a relay address never leaves the machine where it is set (no commits, issues, pasted transcripts or published logs); written into `docs/configuration.md` and `AGENTS.md` rule 16.
- **Reranker.** The NLI model has never been downloaded in the local install, so `nli` is a constant `0.5` and the final order is merge order (S3, details there).
- **Open questions** (nothing below is decided yet):
  1. Which relevance defence to build: the S2 cross-engine domain gate, the coverage gate above, actually loading the NLI model, or some combination. Deferred by decision 2026-11-04 (measure, do not code) — but today a junk block still reaches the answer.
  2. Fork housekeeping: merge upstream 1.12.3, bump to 2.0.0, publish when the user asks (`master` pushed on 2026-11-06 through `9a28906`; parked branches stay local).
  3. `bing-browser-mode`: ship or keep parked — the 2026-11-06 measurements change the picture twice. The parked channel is headless, and headless Chrome gets (and primes) nothing, so shipping it as-is would still return the head-token SERP for cold strings; only a **non-headless** Chrome works, and that needs a desktop session. A "primer" (type the agent's query in a real Chrome, then read the same string over plain HTTP) costs ~1.5 s per query, is per-string, and buys nothing over just taking the browser's SERP. Recorded, not planned.
  4. **Soften our own search protocol** (deferred by the user on 2026-11-06, needs plan approval because it is a code change). `search-protocol.md` + the copy embedded in `src/index.ts` ship as `InitializeResult.instructions` and land in the agent prompt as `<mcp_instructions>` (1 331 characters, 24 lines in 1.12.2). "**Zero Guessing [CRITICAL]** — search web_search before answering any factual question" is precisely what makes an agent spend the budget window on every factual claim, which is why the budget looked like the only bottleneck in the client session; the protocol also has no per-task ceiling. Candidates: limit the rule to time-sensitive/verifiable/external facts, add "at most N searches per task, then answer with what you have", and let the same text mention that the budget exists. Worth knowing before deciding: OpenCode V2 drops the instructions block entirely when the agent's permissions deny all of the server's tools (or `execute` for a Code Mode server), so a client that wants no search pays no context for it either.

### Priority Tasks

- [ ] **More web providers** — increase the number of scraped/API providers for better stability and fallback coverage. Current scraping providers (Startpage, DDG, Brave Web, Bing) are all undocumented and fragile.
  - [ ] **Candidate: Marginalia** (`https://search.marginalia.nu/search?query=`) — independent index, no key, no captcha. Probed 2026-11-03: HTTP 200 with a parseable SERP in ~300 ms *while Startpage, DDG and Brave Web were all blocked/captcha'd from the same IP*. Scope it to **English (Latin-script) queries only** — its index is small-web/English and Cyrillic coverage is negligible, so the provider must opt out for non-Latin queries (reuse the script detection from `query-locale.ts`). Its official API returns 401 (gated), so HTML scraping is the only channel. Tier 2, after Brave Web.
  - [ ] **Verified not viable** (same probe, residential IP): Mojeek `403` (and no public API endpoint), Qwant API `403`, Ecosia `403` captcha, public SearXNG instances (`priv.au` 429, `search.inetol.net` "Security check", `searx.be`/`searxng.online` unreachable — `format=json` is disabled on public instances by design), Reddit JSON `403`, OpenAlex `429` even with `mailto`, GDELT `429`/timeout, Common Crawl index `504`, PyPI Cloudflare challenge, Google and Startpage HTML (JS shell, no server-rendered results). A self-hosted SearXNG keeps the same exit IP, so it does not remove the captcha problem — only a clean IP would.
  - [ ] **Candidate: Stack Exchange** (`https://api.stackexchange.com/2.3/search/advanced`) — documented, versioned public API, no key required for read access. Probed 2026-11-03: HTTP 200 with 30 items for a `code`-flavoured query, and unlike the scraped engines it never returns a captcha page. Integration notes:
    - Quota (measured live 2026-11-03): without a key the wrapper reports **`quota_max: 300`, `quota_remaining` 298 → 297** — an anonymous **shared per-IP daily quota of 300**, shared with every other app on this IP. A registered app `key` lifts the documented daily limit to 10,000. The wrapper also carries `quota_max` / `quota_remaining` and a per-method `backoff` field, so the provider can back off from its own counters instead of waiting for a 40x — cleaner than the heuristic rate limiting the scraped engines need.
    - Params: `site=` (stackoverflow, plus superuser / askubuntu / serverfault / stackexchange for non-code questions), `order=desc&sort=relevance`, `q=`, and `filter=withbody` to get text usable as `ProviderResult.snippet`. Without `filter` the body is stripped and the results are useless for reranking.
    - Scope it to the `code` intent (the classifier already labels such queries) and treat it as a *complement*, not a general-web fallback: it only answers questions asked on Stack Exchange sites. English-only, same as Marginalia.
    - Needs its own limits (`STACKEXCHANGE_RPD` ≈ 280 to stay under the anonymous 300/day ceiling, or ≈ 9,000 with a key) and an optional `STACKEXCHANGE_KEY`; a key is an env-only change, no code.
    - Their first-party MCP server (`mcp.stackoverflow.com` via `mcp-remote`, tools `so_search` + `get_content`) is **not** a shortcut for us: it requires an interactive Stack Exchange login and is capped at 100 calls/day per user, which does not fit a headless server. Use the REST endpoint above instead.
  - [ ] **Candidate: other key-free vertical APIs** (all answered 200 with real data on the same probe, and the intent classifier already knows which queries they fit): Wikipedia `action=query&list=search` (note: `rest.php/v1/search` returned 500 — use the action API), Wikidata `wbsearchentities`, HN Algolia, Crossref, arXiv Atom, npm registry `/v1/search`. Cheaper and far more stable than scraping, but they answer verticals, not the open web.
- [ ] **Re-check provider pricing and limits** — Brave dropped its free Search API tier in Feb 2026: prepaid credits, **$5 per 1,000 requests**, with **$5 of free credits every month** (≈1,000 requests) and 50 QPS. Our docs and the `BRAVE_API_KEY` help text still say "2000 queries/month free", and `BRAVE_RPMONTH=2000` now exceeds the free allowance — it should match the credit budget. Context: Bing Search API is retired and Google Custom Search JSON API closes Jan 1, 2027, so scraped Bing stays the only Bing path.
- [ ] **Parked: Bing headless-Chrome channel** (branch `bing-browser-mode`, not shipped). Root cause measured 2026-11-04 on one machine/profile, A/B in the same minute: `Emulation.setUserAgentOverride` (hiding the `HeadlessChrome` token) also **switches off Chrome's Client Hints** — the `/search` request then carries no `Sec-CH-UA`/`Sec-CH-UA-Mobile`/`Sec-CH-UA-Platform` at all, Bing answers with a page that has no results container (`b_results`/`b_algo`/`b_content` = 0 occurrences) and sets the Akamai bot cookie `ak_bmsc`. A consistent-looking client does not help: `--user-agent=<Chrome UA>` keeps the hints and still gets nothing, and UA-CH metadata cannot be faked into `navigator.userAgentData` in headless 131 (stays `null`). What did work: honest headless UA plus `--disable-blink-features=AutomationControlled` (10/10 organic, `navigator.webdriver=false`), and `Network.setExtraHTTPHeaders` for a per-query `Accept-Language` without touching the fingerprint. Before it can ship it also needs a fail-fast verdict: a `complete` `/search` page with no `#b_results` must end the attempt in ~1 s with a typed "degraded SERP" reason instead of spending the full `20 s` wait, so other providers carry the query (see S1/S2).
  Two follow-ups measured on the same branch 2026-11-04. Repairing the fetch gate did **not** repair the content: on cold strings the channel now passes every structural check (query intact in the box and in `<title>`, `b_algo=10`) while the organic block is unrelated ad filler — see S2, the channel needs that verdict as well. And the profile is effectively stateless: after several searches `Default/Network/Cookies` holds 20 480 bytes with **zero** `bing.com` entries, because Chrome is killed ~2 s after the answer; `MUID`/`_SS` exist in memory during a search (read back with `Network.getCookies`) but never reach disk, so every search starts as a brand-new anonymous client with no Bing history. That cookie lever was tested and is closed: on 2026-11-04 a real desktop Chrome that already carries a warm Bing profile (`MUID`, `SRCHHPGUSR`, `SRCHD`, `SRCHUSR`, `_SS`) returned the same filler for a never-searched string. **Corrected 2026-11-06:** that check *navigated* to the string instead of submitting it through the search box, and a navigation never primes — a box submit in a non-headless Chrome does (see the 2026-11-06 bullets in the status snapshot). So this channel, being headless, would still get degraded content; what works needs a desktop session.
- [ ] **Stability backlog (measured 2026-11-03, deferred by decision — revisit before the next release).** Evidence came from a per-provider run of `startpage,ddg,brave_web,bing,brave_api,tavily,exa,firecrawl` on one query plus a parallel-load check of four searches.
  - [ ] **S1 — stop benching providers for the wrong reasons.** `classifyError()` (`src/limits/rate-limit-store.ts:119`) routes *every* unrecognized message into `access_denied` — including `Brave API key not configured`, timeouts, DNS failures and parse errors — and `access_denied_ms` is `86_400_000` for Startpage and Bing, with `SUSPENSION_BACKOFF = [60s, 5m, 15m, 1h, 4h, 24h]`. One failing query suspended Startpage + DDG + Brave Web at the same time (measured 5–15 min in `data/rate-limits.json`), which is how the free tier collapses. Add distinct classes (`timeout`, `network_error`, `parse_error`, `config_error`) that do not suspend (or suspend for ~30 s), keep suspensions for captcha/429/403. (Empty-but-successful responses do **not** suspend today — `provider-router.ts:171` only logs a warning; that part is already right.)
  - [ ] **S2 — Bing serves a degraded SERP that passes every structural check; cold query strings are the trigger.** Two measurements, same conclusion. 2026-11-03: an English technical query came back over `http` with `q=` correct, HTTP 200 and `b_algo=10`, but the results were Chinese-language off-topic pages, and the Chrome channel returned Russian off-topic results for the same query. 2026-11-04: four strings that had never been searched from this IP, each asked **exactly once** through the (parked) Chrome path, against DuckDuckGo on the same string:

    | cold query, asked once | Bing | DuckDuckGo |
    |---|---|---|
    | `pt100 sensor probe 6mm stem 100mm immersion length class A supplier` | "Best Forex SEO Companies 2026" listicles | RS Components, RS Online, World Industrial Store |
    | `tantalum capacitor 470uF 35V case E tolerance 10% in stock` | "Best Antidetect Browsers 2026" listicles | RS Online, DigiKey, LCSC, eBay |
    | `вакуумный формообразователь для термоформовочной машины 400x400 цена` | Yandex Games ("play online free") | vacuumac.com, Vegasystems, vacforming.ru, Alibaba |
    | `корундовый круг 250х25х76 5A360-K7V купить со склада` | no `b_algo` block at all | ВсеИнструменты, koround.ru, Ozon |

    Bing caches per query string and the cache decides the quality: a well-known string comes back relevant (the same run produced a textbook SERP for `последняя версия npm`), a cold string comes back as unrelated ad/affiliate filler, and re-asking over HTTP does not warm it — re-asking `pt100…` returned the same Forex listicles, re-asking `tantalum…` returned no organic block. **Correction 2026-11-06:** a submit from the search box of a *non-headless* Chrome does warm the exact string, and the warmed block is then served to cookie-less HTTP (see the 2026-11-06 bullets in the status snapshot); plain re-fetching never does. Two filler shapes were ever seen, and they are still not one mechanism: the listicle/game/forum filler above shares **no** token with the query (and its head tokens, «pt100»/«tantalum», return a different junk set or nothing — `bing-headterm2.txt`), while a second family answers **exactly one** word of it («замена подшипника…» → the 1996 film «Замена», «сколько стоит бензин» → calculators + the Wiktionary entry for «сколько», «how to install docker on debian» → Download Chrome/Python/Roblox) — and that second family *is* literally the first-token SERP, 5/5 overlap on 4/4 cold pairs (`bing-headterm.txt`). Upstream names it in [PR #6671](https://github.com/searxng/searxng/pull/6671) ("bing first word results"); the first family is what keeps "first word" from being a *complete* theory. The observable that covers both is token coverage, not the mechanism.
    Detection consequences: emptiness/captcha checks cannot see this, and the reranker is the only filter today — and it is currently not scoring at all (see S3: `nli_score` defaults to 0.5 for every result), so junk rides into the final answer in merge order. The structural signal that does work is **cross-engine domain agreement**: mark an attempt `offscript` when none of its `li.b_algo` hosts appear in another engine's top results for the same string. Checked 2026-11-04 on saved dumps — it first requires unwrapping Bing's organic redirect `/ck/a?!…&u=a1<base64url>`, otherwise every host reads as `bing.com` and the metric is silently always zero; after unwrapping, the junk SERP gives `geetest.ru, vk.com, krasotaimedicina.ru, medofrita.ru…` while the good one gives `npmjs.com, docs.npmjs.com, nodejs.org, github.com, ru.wikipedia.org, habr.com`. No relevance scoring and no language heuristic needed. The cheaper sibling of that signal — query-token coverage of the organic block, no second engine needed — is measured in the status snapshot above (0.00–0.17 junk vs 0.67 good); neither signal is implemented, by the decision of 2026-11-04.
    Methodology trap this produced, worth keeping: once a string has been *primed*, every later client on the same IP sees the warm block. So A/B-ing two client variants on the *same* string compares a warmed cache against a cold one and proves nothing (an apparent "fix" of exactly this kind was measured and later retracted on 2026-11-04). Experiment strings must be single-use. **Refined 2026-11-06:** a plain navigation — address bar, `Page.navigate`, headless typing — does *not* prime, so "fetched" is not the trigger; only a submit from the search box of a non-headless Chrome is.
  - [ ] **S3 — timeout semantics and latency.** `SEARCH_TIMEOUT_MS` is the deadline of the *whole* fan-out (`src/search/orchestrator.ts:185-196`), but `FIELD_DEFS` and the docs describe it as a per-provider timeout. Observed end-to-end 18.7 s for one search: fan-out under 15 s plus NLI scoring *after* the race, on cold models, because `MODEL_IDLE_TIMEOUT_SEC=5` unloads the models between searches. Separate the fan-out deadline from the scoring budget, fix the wording, and reconsider the 5 s idle unload.
    Worse than slow, found 2026-11-04: in this install the NLI model has **never been downloaded** — `INTENT_CLASSIFIER_MODEL=Xenova/nli-deberta-v3-xsmall` is absent from `~/.cache/huggingface/hub` (which holds 77 GB of unrelated models) and `node_modules/@xenova/transformers/.cache` does not exist. So `orchestrator.ts:201` (`if (this.classifier)`) never scores, and `reranker.ts:172` falls back to `nli = 0.5` for every result. `NLI_WEIGHT = 0.9` then multiplies a constant and does nothing, leaving the order to `DOMAIN_WEIGHT`/`FRESHNESS_WEIGHT`/`POSITION_WEIGHT` (0.04/0.03/0.03) — effectively merge order, which is how a junk block survives reranking (see S2). Fixing this is config (`MODEL_PRELOAD=true`, a sane idle timeout, and actually fetching the model) plus a decision about paying for the download inside a search.
  - [ ] **S4 — the failure message lies.** `provider-router.ts:190` throws `No providers configured` when providers are configured but every one returned an empty result set; the sequential path throws `All sequential providers failed` when nothing actually failed. Report `All providers returned empty results` with the per-provider reasons.
  - [ ] **S5 — hot worker respawn.** Under four concurrent searches one request died with `Hot worker exited (code=0 signal=null)` instead of the worker being respawned and the request retried; with `MODEL_WORKER=true` and `MODEL_IDLE_TIMEOUT_SEC=5` an idle exit is normal and must not surface as a search error.
  - [ ] **S6 — re-probe suspended engines faster.** Startpage, DDG and Brave Web were all suspended simultaneously, leaving Bing (scraping) plus the API providers to carry everything.
- [ ] **Local document search** — search over local document databases (vector-indexed docs, wikis, internal knowledge bases). User-provided content, no network required.
- [ ] **System prompt expansion** — extend `search-protocol.md` with site-specific search patterns.
- [ ] **Agent testing on specific sites** — validate that the agent correctly searches and extracts information from targeted domains (Stackoverflow, Reddit, etc).

### Tasks

- [ ] Provider: additional search engines — candidates are tracked under "More web providers" above (Google Custom Search JSON API is not one of them: it closes Jan 1, 2027 and is closed to new customers)
- [ ] Generalize the endpoint override: Tavily already honors `TAVILY_BASE_URL` (a proxy in front of the API, `/search` appended when absent). Exa, Firecrawl and the Brave API client sit behind the same kind of CDN edge and 403 the same way, so give each of them the same `*_BASE_URL` treatment instead of hard-coding the origin.
- [ ] Local document indexing (embedding → sqlite-vec)
- [ ] Local document search tool (`search_docs`)
- [ ] Scraped provider health monitoring dashboard

---

## Dependencies by Phase

```mermaid
gantt
    title MCP Web Hound Roadmap
    dateFormat  YYYY-MM-DD
    
    section V1 - MVP
    Project init + MCP transport     :v1_1, 2024-01-01, 1d
    SQLite cache + TTL               :v1_2, after v1_1, 1d
    DDG + Bing providers             :v1_3, after v1_1, 1d
    Fetcher + Readability            :v1_4, after v1_2, 1d
    Budget + Rate limits             :v1_5, after v1_3, 1d
    Integration tests                :v1_6, after v1_5, 1d
    
    section V2 - Semantic
    Embedding service                :v2_1, after v1_6, 2d
    Semantic cache + dedup           :v2_2, after v2_1, 2d
    Brave + Tavily providers         :v2_3, after v1_6, 2d
    Reranker                         :v2_4, after v2_2, 2d
    Health tracking                  :v2_5, after v2_3, 1d
    
    section V3 - Specialization
    GitHub search                    :v3_1, after v2_4, 3d
    Tier 3 providers                 :v3_3, after v2_5, 3d
    Advanced ranking                 :v3_4, after v3_1, 3d
    Production hardening             :v3_5, after v3_4, 3d
```

## Tech Stack

| Category | Technology | Version |
|----------|-----------|---------|
| Runtime | Node.js | >= 20 |
| Language | TypeScript | >= 5.3 |
| MCP transport | hand-rolled minimal MCP over stdio (`src/mcp/`, zero deps) | — |
| Database | better-sqlite3 | 12.11.1 |
| Vector | sqlite-vec | 0.1.9 |
| Validation | manual (no zod) | — |
| HTML parsing | removed (no fetch layer since c83183f) | — |
| DOM | removed | — |
| Markdown | removed | — |
| Embeddings | @xenova/transformers | 2.17.2 |
| HTTP | undici (built-in fetch) | built-in |
| Config | dotenv | latest |
| Logging | pino | latest |
| Testing | vitest | latest |
