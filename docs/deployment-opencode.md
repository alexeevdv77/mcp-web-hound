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

Installs from the GitHub repository and compiles `dist/` during `prepare`:

```bash
npm i -g github:alexeevdv77/mcp-web-hound

# Windows + npm 11 workaround for npm's global git-dependency bug
npm i -g github:alexeevdv77/mcp-web-hound --install-links=true
```

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

Startpage, DuckDuckGo, Brave Web, and Bing work without keys (HTML scraping).

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

**Discovery differs.** OpenCode V2 puts MCP servers behind Code Mode by default
(`codemode` defaults to `true`): our tools are not on the model's native tool list, they
are reachable only through the `execute` tool as
`tools["web_search"]["web_search"]`. Set `"codemode": false` on the server to declare them
directly:

```json
{
  "mcp": {
    "servers": {
      "web_search": { "type": "local", "command": ["mcp-web-hound"], "codemode": false }
    }
  }
}
```

**The tool list is config-dependent.** The server always advertises `web_search`, `status`
and `github_search`; `report_search_usage` appears only with `SEARCH_LOG_ENABLED=true` and
`gitlab_search` only with `GITLAB_TOKEN` set. Measured on 2026-11-06 with the default
config: three tools, which is correct, not a broken registration.

**Our instructions arrive automatically** as an `<mcp_instructions>` block (the search
protocol, 1 331 characters in 1.12.2). OpenCode drops that block when the agent's
permissions deny all of the server's tools, or deny `execute` for a Code Mode server —
so denying the server also reclaims the context it occupied.

### Making the choice deterministic

| Goal | Setting (verified against the V2 docs, 2026-11-06) |
|---|---|
| Remove the built-in search entirely | `"websearch": false` — the tool disappears from model requests |
| Make the built-in search work | `"websearch": { "provider": "firecrawl" }` — pins one of the five built-in providers (`exa`, `firecrawl`, `parallel`, `tavily`, `tinyfish`). `"random"` lets OpenCode pick among the ones whose environment variable is set |
| Block it hard, keeping the tool visible | `{"action": "websearch", "resource": "*", "effect": "deny"}` in `permissions` (the resource is the search query; the last matching rule wins) |
| Hide our tools instead | `{"action": "web_search_*", "resource": "*", "effect": "deny"}` — the action name is `<server>_<tool>` |

### Why a built-in 403 does not fall back

The built-in providers always talk to the stock origins — there is no endpoint override for
them, unlike `TAVILY_BASE_URL` / `EXA_BASE_URL` here. OpenCode rotates to another provider
only on **HTTP 429** (that provider enters a cooldown of `Retry-After`, or 60 s), and a
session keeps using its selected provider until it is rate limited. A `403` from a blocked
origin is not a rate limit, so the search simply fails and the agent moves on to whatever
tool still answers.

Measured on 2026-11-06 from this network:

| Endpoint | Result |
|---|---|
| `api.tavily.com/search` | `403 Forbidden` — works only through the Worker relay in `TAVILY_BASE_URL` |
| `api.exa.ai/search` | `403 Forbidden` in 157 ms — works only through the relay in `EXA_BASE_URL` |
| `api.firecrawl.dev/v2/search` | reachable: `400` to an empty body, and a real query returned 5 results with snippets (146–1 785 characters) with **no relay at all** |

So on a network that blocks Exa and Tavily, the built-in tool works only if it is pinned to
`firecrawl`; everything else in that network needs a relay, which only this server can use.
Note the trade-off before pinning Firecrawl in both places: the key is a 500-credit trial,
and this server additionally caps Firecrawl at `FIRECRAWL_RPM=5`, `FIRECRAWL_RPD=15`,
`FIRECRAWL_RPMONTH=500`.

### The real ceiling is the budget, not the tool choice

`BUDGET_MAX_SEARCHES=15` per `BUDGET_WINDOW_MINUTES=30` protects the API quotas, and an
agent that searches per factual question hits it. `status` shows the counters (per provider
per day, cache hits, budget window). Raising it is a one-line change in the server `.env`:

```bash
npx mcp-web-hound configure --json set BUDGET_MAX_SEARCHES=30
```

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
`api.exa.ai`, …) and has no endpoint override, so on a network that blocks those hosts it
fails no matter which provider is chosen — and rotation to another provider happens only
on `429`, not on `403`. Either pin a provider that is reachable here
(`"websearch": { "provider": "firecrawl" }`, measured reachable on 2026-11-06) or remove
the built-in tool and search through this server, which can point Tavily and Exa at
relays. See [Which search tool the model actually calls](#which-search-tool-the-model-actually-calls-opencode-v2).

**The agent uses the built-in search instead of the MCP tool**  
Both tools are usually offered at once and the model picks. Our tools sit behind Code Mode
by default (`execute` → `tools["web_search"]["web_search"]`); `"codemode": false` puts them
on the native tool list. `"websearch": false` or a `websearch` `deny` permission rule
removes the competing tool — and with every tool of this server denied, OpenCode also stops
injecting our search-protocol instructions.

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
Semantic search (`SEMANTIC_ENABLED=true`) requires `@xenova/transformers` (~120MB download on first use). Installed as optional dependency.

**Instructions not appearing in agent context**  
Check your OpenCode version: `opencode --version`. If < 1.17.10, use the manual `search-protocol.md` method above.
