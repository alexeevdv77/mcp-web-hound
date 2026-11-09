# Changelog

## [Unreleased]

### Added

- Exa endpoint override: `EXA_BASE_URL` (origin or proxy prefix, `/search` appended unless already in the path) — the same contract as `TAVILY_BASE_URL`, resolved by the shared helper `searchEndpoint()` in `src/utils/endpoint-url.ts`. Use it when the stock Exa origin is blocked or unreachable from your network. Note that Exa authenticates with the `x-api-key` header, so a relay must forward headers, not only the body. Manual check: `npm run test:exa`.
- Exa results carry snippets now: the provider requests `{ contents: { highlights: true } }` and maps the passages Exa picked for each page into `snippet`, collapsed to one line and cut to `EXA_SNIPPET_MAX_CHARS` = 600. Before this Exa rows reached the agent with an empty snippet — the search endpoint returns no page text unless asked, and a top-level `text: true` is not a `/search` parameter at all (the API ignores it: “Send it as contents.text”). Highlights rather than full `contents.text` because Exa prices the two the same (the base search price already covers contents for the first 10 results) while the payload grows from a couple of KB to ~100 KB, and after the 600-character cut the snippets total a few KB per search.
- Bing channel switch: `BING_FETCH_MODE=html|rss` (`html` by default) picks between the paged SERP and the RSS feed inside the one Bing provider, so both channels share a single rate-limit bucket. `rss` is one request for at most 10 items with the real destination URL instead of the tracking wrapper, and no paging — a cheaper structural channel, not a relevance fix. Manual check: `npm run test:bing`.
- Standard proxy support: `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` (lowercase spellings too) now apply to every outbound request — providers, GitHub/GitLab tools, page fetches, model downloads. `installEnvProxy()` (`src/utils/proxy.ts`) installs the undici `EnvHttpProxyAgent` dispatcher in the main process, the hot worker and the manual provider scripts, and only when a proxy variable is set; without one the global dispatcher is untouched. The proxy URL is logged with credentials masked.
- Dependency: `undici@^7` (runtime); `engines.node` raised to `>=20.18.1` (the floor for undici 7).
- Tests: `tests/utils/proxy.test.ts` — variable detection and precedence, credential redaction, dispatcher installed vs left alone (11 tests). `tests/search/providers/exa.test.ts` — `EXA_BASE_URL` resolution (proxy origin carrying a path, an endpoint that already ends with `/search`, trailing slash, stock fallback), the `x-api-key` passthrough, and `contents.highlights` snippets (join, collapse, cut at 600, `text` fallback, neither → empty): 18 tests in that file, 218 in the suite.
- Docs: "HTTP Proxy" section in `docs/configuration.md`, commented `HTTP_PROXY`/`NO_PROXY` block in `default.env`; Exa endpoint override and the relay contract (`x-api-key` must be forwarded) in `docs/providers.md`, `EXA_BASE_URL` row in `docs/configuration.md`. New page `docs/exa-proxy-edge-function.md`: the Supabase Edge Function relay for Exa — the script, the deploy steps (`verify_jwt = false` matters), what the relay does to the request and the response, security notes and Supabase limits; linked from `docs/index.md`, `docs/providers.md` and the `EXA_BASE_URL` row. Real relay addresses stay out of the repository (placeholders only). The sitemap now lists all 13 doc pages with real `lastmod` dates. `docs/deployment-opencode.md`: the MCP registration snippet corrected to the V2 shape (`mcp.servers`, no `enabled` field), and a new section "Which search tool the model actually calls (OpenCode V2)" — the recommended OpenCode configuration (`"websearch": false` together with the server entry), one line each for the other flags (`websearch: { provider }`, `codemode: false`, a `permissions` rule), why a built-in provider failure has no fallback (OpenCode switches providers only on HTTP `429`) and the budget window as the practical ceiling; two new troubleshooting entries. `README.md` carries the same short recommended snippet.
- Docs after the clean-install audit (2026-11-08): the README install block now says when `--install-links` is actually needed (check `npm config get install-links`), marks the npm 11 `allowScripts` warning as informational, and warns that the *optional* `@xenova/transformers` dependency can be dropped silently by npm (`TAR_ENTRY_ERROR`) — with the two commands that reveal it (`npm ls -g @xenova/transformers`, `status` → `models`) and what still works without it. A one-line pointer to `TAVILY_BASE_URL` / `EXA_BASE_URL` for providers that are blocked from the client's network. The tool table marks `gitlab_search` and `report_search_usage` as conditional and states that the result count is `MAX_RESULTS_AFTER_RERANK`, not a tool parameter (unknown arguments are ignored). `docs/configuration.md` states that endpoint overrides are printed verbatim by `configure --json get` and `status` and need no masking, as long as the address stays on the machine where it is set. New troubleshooting entry for the missing model stack. Superseded for the model stack by the entries below.
- Shared model cache. `@xenova/transformers` defaults `env.cacheDir` to `<package>/.cache`, which a reinstall deletes, so every upgrade re-downloaded the weights. `loadModelRuntime()` (`src/embeddings/model-runtime.ts`) now points it at one directory per user: `MODEL_CACHE_DIR` from the config, else `$HF_HOME/transformers-js`, else `$XDG_CACHE_HOME/huggingface/transformers-js`, else `~/.cache/huggingface/transformers-js`. Both loaders (embedding and NLI) go through it, and it is set once per process. Weights left in an older in-package `.cache` are copied over on the first run instead of being fetched again. The layout is transformers.js v2's `<cache>/<org>/<model>/`, not the Python HF hub `models--` layout, so the shared directory is reused by other transformers.js tools, not by HF Python tooling — stated in the docs.
- `MODEL_CACHE_DIR` config key (`FIELD_DEFS` in `src/utils/types.ts`, commented entry in `default.env`, row in `docs/configuration.md`).
- `mcp-web-hound models` CLI (`src/cli/models.ts`): `status` (stack present, package dir, cache dir, per-model state and size), `path` (cache directory only), `install` (installs `@xenova/transformers` at the version pinned in `optionalDependencies` next to the server, then re-checks that the server can resolve it), `download` (prefetches the embedding and NLI models, `--force` to re-fetch). Listed in `--help`.
- `status` gained a `model_stack` block (`available`, `cache_dir`, `embedding_model`, `nli_model`) plus `models.cache_dir`. `available` comes from `isModelStackAvailable()`, which resolves the package without loading ONNX.
- `prepare` pre-installs the model stack into the install prefix of a Git/global install (`scripts/prepare-build.mjs`), which is what makes `npm i -g github:…` keep the ONNX stack — see Fixed. Skipped for `--omit=optional` and `MCP_SKIP_MODELS=1`; a failure there is a warning, not a failed build. It now also logs what it decided: `Pre-installing the model stack (@xenova/transformers@…) into the install prefix`, or `Model stack already present in the install prefix (…)`. npm 11 runs one of its two `prepare` passes without showing output, so without that second line an install that did pre-install the stack reads like one that did not.
- Tests: `tests/embeddings/model-cache.test.ts` — cache-directory precedence (`MODEL_CACHE_DIR` over `HF_HOME` over `XDG_CACHE_HOME` over the home fallback, relative paths resolved against the working directory, blank values ignored), `inspectModelCache` (missing / incomplete / complete and sizes), the legacy in-package cache copy (copied once, skipped when the target already has it, skipped when the roots match), `normalizeModelId`, `formatBytes`. `tests/cli/models-cli.test.ts` — the `models` CLI end to end with a fake runtime: cache dir, missing-stack report, ready / incomplete / not-downloaded lines, install already present, npm failure, npm success that still does not resolve, download skipping cached models, `--force` re-fetch, unknown command. 31 new tests, 249 in the suite; package coverage went up rather than down (statements 38.9 → 41.6 %, branches 32.4 → 35.2 %, functions 46.0 → 47.8 %, lines 40.7 → 43.4 %), with `models.ts` at 94 % and `model-runtime.ts` at 78 %.
- Docs: README quick start and the Git-install section of `docs/deployment-opencode.md` cover the stack arriving with the Git install and the `--omit=optional` lean install; the troubleshooting entry is rewritten around `models status` / `models install` / `models download` instead of `npm ls -g`; `docs/configuration.md` gets the `MODEL_CACHE_DIR` row.
- Docs after a clean-config reinstall: the Git-install section says the `npm warn tar TAR_ENTRY_ERROR … protobufjs\cli` warnings can still print while npm inspects the optional tree and are harmless once `models status` reports the stack — judge the install by that command, not by the warnings. The keyless-provider paragraph now names DuckDuckGo and Bing as the engines that carry that path, because the other two scraping engines get captcha- or rate-limit-suspended often.

### Changed

- `BUDGET_MAX_SEARCHES` default raised from 15 to 30 per window — `FIELD_DEFS` in `src/utils/types.ts`, `default.env`, the tables and examples in `docs/budget.md` / `docs/configuration.md` / `docs/architecture.md`, and the default assertion in `tests/utils/types.test.ts`. An agent that searches per factual question used to exhaust 15 searches inside half a window; the per-provider caps (`*_RPM`, `*_RPD`, `*_RPMONTH`) are unchanged and still bound the upstream quotas.
- Published documentation stopped recording what was observed on one machine or network. The provider pages, both proxy pages and the fallback diagram now describe the failure class ("the stock origin may be blocked or unreachable from your network") and point at `docs/roadmap.md`, which keeps the dates, payloads and log names. `README.md` and the deployment guide show one recommended configuration instead of a tour of flags. Recorded as rules 14–16 in `AGENTS.md`.
- `sqlite-vec` moved from `optionalDependencies` to `dependencies`: `src/cache/semantic-cache.ts` imports it statically, so an install without it could neither compile (`tsc` in `prepare`) nor start. That made `--omit=optional` unusable as an "install without models" switch; now it omits only the ONNX stack, and the server keeps running with semantic dedup and the NLI signal disabled.
- The optional runtime is loaded through a non-literal specifier, so `tsc` no longer needs type declarations from a package that may not be installed.

### Fixed

- `models download` no longer marks a whole model as failed on one transient proxy/network hiccup: each model now gets three attempts with a 1 s / 2 s backoff, and `installEnvProxy()` passes a 30 s `connectTimeout` to undici's `EnvHttpProxyAgent` instead of its 10 s default. Before this, a single `UND_ERR_CONNECT_TIMEOUT` on any file (config, tokenizer or weights) surfaced as `<model>: failed — fetch failed` even though the proxy was reachable and a rerun completed the download.
- `npm i -g github:…` silently dropped the whole optional subtree (`@xenova/transformers`, `sharp`, `onnxruntime-*`): extracting `protobufjs`'s bundled CLI tree fails, and npm then rolls back every optional dependency. `prepare` now pre-installs `@xenova/transformers` at the target prefix, where npm dedupes to it instead of extracting that tree. Reproduction variants and the shape of the failure are recorded in `docs/roadmap.md`; the registry install was never affected.
- `status` reported `embedding_model` from the config even when `@xenova/transformers` was not installed, so a machine without the model stack looked healthy. It now answers `disabled` with `model_stack.available: false`.
- `docs/configuration.md` claimed `SEMANTIC_ENABLED` defaults to `false`; the default is `true`.

### Known issues

- **Semantic dedup never engages; every search logs `Failed to index embedding`.** `SemanticCache.index()` writes the vector row with the query id taken from better-sqlite3's `lastInsertRowid`, a JS number, and sqlite-vec 0.1.9 refuses it: `SQLITE_ERROR: Only integers are allows for primary key values on query_embeddings` (the wording is sqlite-vec's). The orchestrator catches the failure and the search still returns results, so the visible symptom is one error line per search; what it means is that the vector table is never written and `findSimilar()` can only ever miss. Reproduced in isolation: the same `INSERT` fails with a number and succeeds with `BigInt(1)`, `MATCH` returns the id back as a number, and `DELETE`/`SELECT` by id work with a number and match nothing with a BigInt — so the fix is one binding in `index()`, not in the read path. Row counts and the audit that surfaced this: `docs/roadmap.md`. Left unfixed deliberately: once it works, near-duplicate queries start returning cached results instead of searching, which changes what the agent sees, so it needs its own plan and measurement pass. Until then `SEMANTIC_ENABLED=true` pays for the embedding model and buys nothing beyond query-normalisation.

## [1.12.2] - 2026-10-30

### Fixed

- `status` and `configure --json get` no longer expose full API keys/tokens — values are partially masked (`abcd****wxyz`).
- `github_search` / `gitlab_search` retry on HTTP 429 and rate-limit 403 with truncated exponential backoff (honors `Retry-After`, capped at 5s).
- `brave_web` provider is actually registered now (registry key was `brave`, but `PROVIDER_ORDER` uses `brave_web`) — it was silently skipped and missing from `status`.

### Changed

- `package.json`: `homepage` + expanded `keywords`; README badges and absolute repo/npm links (SEO).
- `docs/`: landing page, `sitemap.xml`, `robots.txt` scaffold for GitHub Pages.
- Tests: router registration, secret masking, fetch retry (15 new tests).

## [1.12.0] - 2026-10-28

Cold-footprint rework: thin main + single hot worker, global install as the official path.

### Added

- Minimal MCP over stdio (`src/mcp/server.ts`, zero deps — newline + Content-Length framing, protocol negotiation, `initialize` with `instructions`, `tools/list`, `tools/call`): replaces `@modelcontextprotocol/sdk` in the cold path. Plain JSON tool schemas (`src/mcp/schemas.ts`) instead of zod-generated ones.
- Zero-dependency config (`FIELD_DEFS` + `parseConfig` in `src/utils/types.ts`, single source for parser/docs/TUI/status) and mini stderr logger (`src/utils/logger.ts`): replaces `zod`, `pino`, `dotenv`. All throw/parse semantics verified identical to zod via differential test.
- Hot worker (`src/hot/`): one private child per MCP server owns the entire heavy stack — SQLite cache (+sqlite-vec), rate limits, provider router, orchestrator, ONNX models. Spawned on first tool call, killed after `MODEL_IDLE_TIMEOUT_SEC` idle with verified `shutdown → SIGTERM → SIGKILL` escalation; suicides on parent death. Replaces `src/models/` (removed).
- `npm i -g mcp-web-hound` as the recommended distribution: single Node process (~22MB cold) instead of the npx relay chain (outer `px-cli` ~90MB + inner server). `npx -y` stays as zero-install fallback.
- CI `smoke-global` job: `npm pack` → `npm i -g tarball` → `--help` + `configure --json get` before publish.
- Tests: `tests/hot-worker.test.ts` (kill escalation, mock IPC roundtrip, orphan suicide).

### Changed

- `MODEL_IDLE_TIMEOUT_SEC` default 25 → 5 (applies to the whole hot worker; hot start ~1-2s, first semantic search loads models). In-RAM dedup/budget windows live and die with the hot worker.
- `src/index.ts` is thin: MCP + config + logging only, no `better-sqlite3`/`sqlite-vec`/providers in the cold import graph. Measured: main 71.6MB @75s idle with zero children; hot 80MB while serving, 0 after 5s idle (kill verified).
- Removed `@modelcontextprotocol/sdk`, `zod`, `pino`, `dotenv` from dependencies. Measured: main **22.5MB @75s idle** (was 71.6MB) — near bare-node level; e2e MCP stdio smoke passes (initialize/instructions/tools-list/tools-call/ping).
- Pinned all dependency versions (was `"latest"`); removed dead `linkedom` / `@mozilla/readability` / `turndown` / `turndown-plugin-gfm` (zero imports in `src`, only stale `dist/fetch/*`); `clean+build` drops stale artifacts.

## [1.11.1] - 2026-10-26

Fix `status` worker observability: `worker_pid` / `worker_last_kill_verified` were snapshotted once at startup (always null) instead of being read live. The worker lifecycle itself (spawn → serve → verified idle kill) was already correct.

## [1.11.0] - 2026-10-26

Memory usage optimization. Previously, the reranker models started together with the server and consumed ~500MB of RAM; now they start on first reranker use and die after 25 seconds idle.

### Added

- Private model worker (`src/models/`): ONNX embedding + NLI pipelines run in a dedicated child process per MCP server, killed after `MODEL_IDLE_TIMEOUT_SEC` (25s) idle with verified `shutdown → SIGTERM → SIGKILL` escalation.
- Worker suicide on parent death (IPC `disconnect` + PPID watchdog), so a crashed/killed server can never leak the worker.
- New config: `MODEL_IDLE_TIMEOUT_SEC` (25), `MODEL_PRELOAD` (false), `MODEL_WORKER` (true).
- `status` tool now reports `models` block (`embedding_loaded`, `nli_loaded`, `worker_mode`, `worker_pid`, `worker_last_kill_verified`).
- Tests: `tests/models-idle.test.ts` (idle unload) and `tests/models-worker.test.ts` (kill escalation, mock IPC roundtrip, orphan suicide).

### Changed

- Cold start by default: no eager model load at startup (`MODEL_PRELOAD=false`); first search pays ~3-6s load, idle server sits at ~65MB committed instead of ~930MB.
- In-process `dispose()` now actually releases ONNX sessions via `pipeline.dispose()` (previously only nulled JS refs, native memory stayed committed).
- Worker logs go to stderr (`MCP_WORKER=1`), stdout stays clean for the MCP protocol.
