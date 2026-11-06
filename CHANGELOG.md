# Changelog

## [Unreleased]

### Added

- Exa endpoint override: `EXA_BASE_URL` (origin or proxy prefix, `/search` appended unless already in the path) — the same contract as `TAVILY_BASE_URL`, resolved by the shared helper `searchEndpoint()` in `src/utils/endpoint-url.ts`. Needed because `api.exa.ai/search` answers `403 Forbidden` from our network while a relay we run answers `200`. Note that Exa authenticates with the `x-api-key` header, so a relay must forward headers, not only the body. Manual check: `npm run test:exa`.
- Exa results carry snippets now: the provider requests `{ contents: { highlights: true } }` and maps the passages Exa picked for each page into `snippet`, collapsed to one line and cut to `EXA_SNIPPET_MAX_CHARS` = 600. Before this Exa rows reached the agent with an empty snippet — the search endpoint returns no page text unless asked, and a top-level `text: true` is not a `/search` parameter at all (the API ignores it: “Send it as contents.text”). Measured through our own relay on one ~10-result query: no contents 2.3 KB, highlights 25.8 KB, full `contents.text` 105.5 KB (a single page up to 31 KB), `costDollars` identical `$0.007` in all three — Exa's base search price already covers contents for the first 10 results. After the cut the snippets total ~3.6 KB per search.
- Standard proxy support: `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` (lowercase spellings too) now apply to every outbound request — providers, GitHub/GitLab tools, page fetches, model downloads. `installEnvProxy()` (`src/utils/proxy.ts`) installs the undici `EnvHttpProxyAgent` dispatcher in the main process, the hot worker and the manual provider scripts, and only when a proxy variable is set; without one the global dispatcher is untouched. The proxy URL is logged with credentials masked.
- Dependency: `undici@^7` (runtime); `engines.node` raised to `>=20.18.1` (the floor for undici 7).
- Tests: `tests/utils/proxy.test.ts` — variable detection and precedence, credential redaction, dispatcher installed vs left alone (11 tests). `tests/search/providers/exa.test.ts` — `EXA_BASE_URL` resolution (proxy origin carrying a path, an endpoint that already ends with `/search`, trailing slash, stock fallback), the `x-api-key` passthrough, and `contents.highlights` snippets (join, collapse, cut at 600, `text` fallback, neither → empty): 18 tests in that file, 218 in the suite.
- Docs: "HTTP Proxy" section in `docs/configuration.md`, commented `HTTP_PROXY`/`NO_PROXY` block in `default.env`; Exa endpoint override and the relay contract (`x-api-key` must be forwarded) in `docs/providers.md`, `EXA_BASE_URL` row in `docs/configuration.md`. The Exa relay script itself is still to be documented — the example is provided by the operator, real addresses stay out of the repository.

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
