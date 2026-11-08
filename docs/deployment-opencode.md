# Deployment Guide — OpenCode

## Prerequisites

- **Node.js** >= 20
- **npm** (comes with Node.js)

## Quick Install (global, recommended)

One Node process per server (~70MB cold) instead of the npx relay chain
(outer `px-cli` ~90MB + inner server). Distribution is still via npm.

```bash
npm i -g mcp-web-hound

# Verify it works
mcp-web-hound --help
```

## Quick Install (from Git)

Installs from the GitHub repository, compiles `dist/` during `prepare` and pre-installs
the optional ONNX stack into the install prefix:

```bash
npm i -g github:alexeevdv77/mcp-web-hound
mcp-web-hound models status

# Lean install: no ONNX stack (no semantic dedup, no NLI signal)
npm i -g github:alexeevdv77/mcp-web-hound --omit=optional
```

The pre-install is what keeps the model stack in place: while extracting the optional
subtree, npm can fail on `protobufjs`'s bundled CLI tree and then roll back every optional
dependency. With a copy already present at the prefix, npm dedupes to it and never
extracts that tree. Skip it with `--omit=optional` or `MCP_SKIP_MODELS=1`.

`npm warn tar TAR_ENTRY_ERROR … protobufjs\cli` lines may still print while npm inspects
that tree during resolution. They are harmless now: the install keeps the stack, which
`mcp-web-hound models status` confirms. Judge the install by that command, not by the
warnings.

If you hit `EPERM`/`ENOTEMPTY` while npm prepares the temporary clone, use
`--install-links=true` or persist it once:

```bash
npm config set install-links true
```

## Quick Install (npx, zero-install fallback)

No install needed — npx fetches and runs the latest version automatically
(costs an extra ~90MB outer relay process while running).

```bash
# Verify it works
npx mcp-web-hound --help
```

## Configuration

Config lives in two places:

| Tier | File | Purpose |
|------|------|---------|
| **Server** | `~/.config/mcp-web-hound/.env` | Main config — written by `configure` tool |
| **Project** | `<project>/.env` | Optional per-folder overrides (individual keys only) |

The server config is auto-created from defaults on first `npx mcp-web-hound` run.

### Set API keys

```bash
# Interactive (TUI) — writes to server .env
npx mcp-web-hound configure

# Machine-readable (for agents) — writes to server .env
npx mcp-web-hound configure --json set BRAVE_API_KEY=your_key_here
npx mcp-web-hound configure --json set TAVILY_API_KEY=your_key_here
npx mcp-web-hound configure --json set GITHUB_TOKEN=ghp_xxx
```

To see all available settings:

```bash
npx mcp-web-hound configure --json get
```

Startpage, DuckDuckGo, Brave Web, and Bing work without keys (HTML scraping). In practice
DuckDuckGo and Bing carry that path: the other two scrape engines get captcha- or
rate-limit-suspended often, and the server keeps them suspended for a while when that
happens. `status` shows which engines are currently healthy.

## Register in OpenCode

Recommended (global install — single process):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "web_search": {
        "type": "local",
        "command": ["mcp-web-hound"]
      }
    }
  }
}
```

Fallback (npx — no install, extra relay process):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "web_search": {
        "type": "local",
        "command": ["npx.cmd", "-y", "mcp-web-hound"]
      }
    }
  }
}
```

V2 has no `enabled` field for a server — a configured server connects on its own, and
`"disabled": true` keeps it configured but disconnected. (Older configs written against
V1 may still carry `enabled`; it is not the V2 field.)

Or via CLI:

```bash
opencode mcp add web_search -- npx.cmd -y mcp-web-hound
```

## Alternative: Local Install

```bash
git clone https://github.com/alexeevdv77/mcp-web-hound.git
cd mcp-web-hound
npm install
npm run build
```

## Search Protocol Setup

The search protocol (Zero Guessing, Pre-Call Plan, Tool Selection, Query Formatting, Source Quality) is embedded in the server itself and delivered via MCP's `InitializeResult.instructions`.

### OpenCode v1.17.10+

**No additional config needed.** The protocol is automatically injected into the agent's system prompt when the MCP server connects. The agent will see it as:

```
Instructions from: MCP server mcp-web-hound
...
```

If you have search-related instructions in other system prompt files (`free-mode-prompt.md`, `AGENTS.md`, etc.), remove them to avoid conflicts.

### OpenCode v1.17.7 and older

These versions do not support MCP server instructions. Add the protocol manually via `opencode.json`:

```json
"instructions": [
  "free-mode-prompt.md",
  "AGENTS.md",
  ".ai-workspace.md",
  "./search-protocol.md"
]
```

The path is relative to the project root (`D:\Projects\mcp_search`). You can also use an absolute path.

> ⚠️ If your agent has search instructions in other prompts, remove them and keep only this one reference to avoid conflicting instructions.

## Which search tool the model actually calls (OpenCode V2)

OpenCode has its own built-in web search, so an agent can have two ways to search at the
same time: the built-in `websearch` tool and this server's `web_search`. Which one wins is
configuration, not luck.

By default our tools sit behind **Code Mode** (`codemode` defaults to `true`), so the model
reaches them through `execute` as `tools["web_search"]["web_search"]`, while OpenCode's own
`websearch` tool stays available. Which of the two is used is a matter of the flags below.

Recommended — one search path, this server:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "websearch": false,
  "mcp": {
    "servers": {
      "web_search": {
        "type": "local",
        "command": ["mcp-web-hound"]
      }
    }
  }
}
```

`"websearch": false` removes the built-in tool from model requests. Reach for it when the
built-in search cannot work in your environment: its providers always talk to their stock
origins and there is no endpoint override for them, so a blocked or unreachable origin fails
the search — OpenCode switches to another provider only on HTTP `429`, and a session keeps
its chosen provider until it is rate limited. This server still works in such an
environment, because its API providers accept a proxy endpoint (`TAVILY_BASE_URL`,
`EXA_BASE_URL`) and it honours a transport proxy (`HTTP_PROXY`).

Other flags, and what each one changes:

| Flag | Effect |
|---|---|
| `"websearch": { "provider": "tavily" }` | keeps the built-in tool but pins a provider (`exa`, `firecrawl`, `parallel`, `tavily`, `tinyfish`, or `"random"`) instead of letting OpenCode choose one |
| `"codemode": false` on this server | our tools move onto the model's native tool list instead of behind `execute`: more direct calls, more tool definitions in every request |
| `{"action": "websearch", "resource": "*", "effect": "deny"}` in `permissions` | blocks the built-in tool but keeps it visible; denying our tools (`"web_search_*"`) also drops the injected search-protocol instructions |

How many tools this server advertises depends on its own configuration: `web_search`,
`status` and `github_search` are always there, `report_search_usage` appears with
`SEARCH_LOG_ENABLED=true` and `gitlab_search` with `GITLAB_TOKEN` set.

For an agent that searches per factual question the practical ceiling is not the tool choice
but the budget: `BUDGET_MAX_SEARCHES` per `BUDGET_WINDOW_MINUTES` (30 searches per 30
minutes by default). `status` shows the counters, and a tight limit is raised with
`npx mcp-web-hound configure --json set BUDGET_MAX_SEARCHES=60`.

## Verify

Restart OpenCode, then check the tool is available:

```
web_search("hello world")
```

Expected response — list of search results.

## Troubleshooting

**"No search providers configured"**  
Check the server `.env` via `mcp-web-hound configure --json get` — at least one provider must be enabled. DDG and Bing need no key, just set:
```
DDG_ENABLED=true
BING_ENABLED=true
```

**Built-in web search fails with `Web search request failed (HTTP 403)`**  
OpenCode's own search tool always uses the provider's stock origin (`api.tavily.com`,
`api.exa.ai`, …) and has no endpoint override, so when that origin is blocked or
unreachable from your network the search fails whichever provider is chosen — rotation to
another provider happens only on `429`, not on `403`. Either pin a provider your network can
actually reach (`"websearch": { "provider": "…" }`) or set `"websearch": false` and search
through this server, whose API providers accept a proxy endpoint. See
[Which search tool the model actually calls](#which-search-tool-the-model-actually-calls-opencode-v2).

**The agent uses the built-in search instead of the MCP tool**  
Both tools are usually offered at once and the model picks. Our tools sit behind Code Mode
by default (`execute` → `tools["web_search"]["web_search"]`); `"codemode": false` puts them
on the native tool list. `"websearch": false` or a `websearch` `deny` permission rule
removes the competing tool — and with every tool of this server denied, OpenCode also stops
injecting our search-protocol instructions.

**Semantic dedup and NLI intent classification are off after a fresh install**  
`@xenova/transformers` is an optional dependency: `--omit=optional` leaves it out on
purpose, a Git install pre-installs it into the prefix, and a registry install brings it as
a normal optional dependency. Without it the server still starts and searches: provider
routing, caching, merging and heuristic reranking work; embedding-based dedup and the NLI
intent classifier stay off (`nli_score` stays at its neutral `0.5`). `mcp-web-hound models
status` shows whether the stack is available; `models install` installs it next to the
server, `models download` prefetches the weights.

Model weights live in a shared cache, `~/.cache/huggingface/transformers-js`
(`$HF_HOME/transformers-js` when `HF_HOME` is set, `MODEL_CACHE_DIR` overrides). The layout
is transformers.js v2's `<cache>/<org>/<model>/`, not the Python HF hub `models--` layout —
other transformers.js tools pointed at the same directory share the files, Python HF
tooling does not. On the first run weights left in an older in-package `.cache` are copied
over automatically, so a reinstall does not download them again. With `MODEL_PRELOAD=false`
they are not held in RAM until a search, and they are freed after `MODEL_IDLE_TIMEOUT_SEC`
(5 s by default).

## Search Log Export

If `SEARCH_LOG_ENABLED=true` is set, every `web_search` call is logged to the SQLite database.

Export training data:

```bash
# All entries
npx mcp-web-hound export-logs

# Training subset (only entries where agent reported usage)
npx mcp-web-hound export-logs --export --jsonl > training-data.jsonl

# See full options
npx mcp-web-hound export-logs --help
```

**Build errors**  
Ensure Node.js >= 20:
```bash
node --version
```

**Semantic cache disabled**  
Semantic search (`SEMANTIC_ENABLED=true`) needs `@xenova/transformers` and the model
weights. Check `mcp-web-hound models status`; `models install` adds the stack and `models
download` fetches the weights into the shared cache.

**Instructions not appearing in agent context**  
Check your OpenCode version: `opencode --version`. If < 1.17.10, use the manual `search-protocol.md` method above.
