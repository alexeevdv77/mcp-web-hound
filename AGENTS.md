# MCP Web Hound — Agent Rules

## Project-specific rules

1. **No code changes without plan approval.** This project follows the planning mode protocol.

2. **TypeScript only.** All source code in `src/` must be TypeScript with strict mode enabled.

3. **Provider interface.** All search providers MUST implement the `SearchProvider` interface defined in `src/search/providers/base-provider.ts`. No ad-hoc provider implementations.

4. **Web search via orchestrator only.** The `src/tools/search.ts` layer must only call the orchestrator. All web-search provider logic stays in `src/search/`. GitHub/GitLab tools (`github-search.ts`, `gitlab-search.ts`) are separate API tools, not part of the web-search pipeline.

5. **Cache invariant.** Every successful provider response MUST be cached before returning to the agent. No uncached responses.

6. **Budget enforcement.** Budget check MUST happen before any provider call. No exceptions.

7. **Env-based config.** All configurable values come from environment variables (`.env`). Use `npx mcp-web-hound configure --json get/set` for machine-readable access. Two-tier model: `~/.config/mcp-web-hound/.env` (main) + project `.env` (per-folder overrides). Agents must only write to server `.env`.

8. **Logging.** Use `pino` structured logger. No `console.log` in production code.

9. **Error handling.** Provider errors must never crash the server. Log, mark unhealthy, fallback to next provider.

10. **Documentation.** After any architectural change, update the corresponding doc in `docs/` and the flow diagram in `docs/diagrams/`.

11. **Tests before merge.** Every feature or fix MUST include tests. Run `npm test` before committing. For live provider testing, set API keys in `.env` and run `npm run test:providers`.

12. **Coverage check.** After adding tests, verify coverage doesn't regress: `npm run test:coverage`. Current thresholds: statements 50%, branches 35%, functions 55%, lines 55%.

13. **Search log versioning.** Every entry in the training dataset carries `system_version` for provenance. The `ranker` and `signals` versions are defined as constants in `src/search/reranker.ts` (`RERANKER_VERSION`, `SIGNALS_VERSION`). The `mcp` version comes from `package.json`.

14. **Docs are machine-agnostic.** `README.md` and everything in `docs/` **except `docs/roadmap.md`** must not record what was observed on this machine or network — no "measured from this network", no probe dates, timings, payload sizes of our own calls, or the status codes a provider returned here. Describe the failure class instead: "the stock origin may be blocked or unreachable from your network", "a proxy you run restores the call". Concrete measurements, dates, log-file names and per-provider verdicts belong in `docs/roadmap.md`, which is the internal record. Public docs may point to it ("measurements: `docs/roadmap.md`") but must not repeat its numbers.

15. **Recommended configuration, not a flag tour.** Config sections show one recommended example block and keep the same short version in `README.md`; a flag that is not in the recommendation gets one sentence — why it exists and what it changes overall. No exhaustive matrices of modes and flags.

16. **No private endpoints in the repository.** Real proxy/relay addresses, tokens and keys never go into any committed file (docs, code, tests, commit messages) — placeholders only (`https://proxy.example.com`, `<project-ref>`). Agents write only to the server `.env`. They do **not** need to be masked in local tool output (`configure`, `status`): the invariant is that they never leave the machine where they are set — no commits, no issues, no published logs or transcripts.
