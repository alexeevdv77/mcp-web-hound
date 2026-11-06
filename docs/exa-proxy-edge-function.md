# Exa through a Supabase Edge Function

An optional pass-through in front of `api.exa.ai`, the same idea as
[Tavily through a Cloudflare Worker](tavily-proxy-worker.md) but on Supabase Edge
Functions. It exists for the same reason: the stock Exa origin can be blocked or
unreachable from the network the server runs on (a `403` on a request that carries a
valid key is the typical symptom), and a relay you control answers instead.

The function stores nothing: no keys, no secrets, no environment variables. It reads
the caller's `x-api-key` header and forwards it, replays the JSON body unchanged and
returns Exa's answer with Exa's own HTTP status. Note the difference from Tavily:
Tavily authenticates with `api_key` inside the JSON body, **Exa authenticates with
the `x-api-key` header** — a relay that only copies the body will not work.

## Deploy

1. Supabase CLI: `supabase functions new exa-api`, then replace
   `supabase/functions/exa-api/index.ts` with the script below.
2. Turn the platform's JWT check off for this function — it is **on by default**, and
   MCP Web Hound sends only `x-api-key`, never an `Authorization` header, so the
   gateway would reject the call before the function ever runs. In
   `supabase/config.toml`:

   ```toml
   [functions.exa-api]
   verify_jwt = false
   ```

   (Older CLIs accept `supabase functions deploy exa-api --no-verify-jwt` instead; the
   Dashboard has the same switch in the function's settings.)
3. `supabase functions deploy exa-api`. The endpoint is
   `https://<project-ref>.supabase.co/functions/v1/exa-api`. Keep that address out of
   this repository — the placeholder here is deliberate.

A useful check that step 2 was applied: a call without `x-api-key` returns this
function's own `401 {"error":"x-api-key header is missing."}`, not Supabase's built-in
`401` — the request reached the handler.

## Script

```ts
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

Deno.serve(async (req) => {
  // 1. CORS preflight for browser callers.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // 2. Routing: this function answers only on /search, everything else is a typo.
  const url = new URL(req.url)
  if (url.pathname.endsWith('/search') === false) {
    return new Response(
      JSON.stringify({ error: 'Not Found. Use the .../<function-name>/search endpoint' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    // 3. The Exa key arrives in the header, exactly as with the original API.
    const exaApiKey = req.headers.get('x-api-key')
    if (!exaApiKey) {
      return new Response(
        JSON.stringify({ error: 'x-api-key header is missing.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 4. Read the caller's JSON as-is — query, numResults, contents, anything.
    const originalBody = await req.json()

    // 5. Replay the request against the real Exa API, payload unchanged.
    const exaResponse = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': exaApiKey,
      },
      body: JSON.stringify(originalBody),
    })

    // 6. Read Exa's answer (a result block or an error block).
    const exaData = await exaResponse.json()

    // 7. Hand it back to the client in Exa's own format, with Exa's own status code.
    return new Response(JSON.stringify(exaData), {
      status: exaResponse.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
    })
  }
})
```

## Point the server at it

```env
EXA_BASE_URL=https://<project-ref>.supabase.co/functions/v1/exa-api
```

`/search` is appended automatically when it is not already in the path, so
`https://<project-ref>.supabase.co/functions/v1/exa-api` and
`https://<project-ref>.supabase.co/functions/v1/exa-api/search` configure to exactly the
same call; a trailing slash is ignored, and an empty value falls back to
`https://api.exa.ai` — see `exaSearchUrl()` in
[src/search/providers/exa.ts](../src/search/providers/exa.ts). What matters is the path
of the request that finally leaves the client: step 2 above answers **only** on a path
ending with `/search`, so a base that drops or renames that segment (`.../exa-v1`) gets
the relay's own `404` instead of results.

The effective call is `POST https://<project-ref>.supabase.co/functions/v1/exa-api/search`
with `x-api-key` and a JSON body. The same thing by hand:

```bash
curl -sS -L -X POST "https://<project-ref>.supabase.co/functions/v1/exa-api/search" \
  -H "x-api-key: <exa-key>" \
  -H "Content-Type: application/json" \
  -d '{"query": "Погода в Москве", "numResults": 3}'
```

A working relay answers `200` with Exa's own JSON and a `results` array.
`npm run test:exa` prints the resolved endpoint, whether the channel is stock or proxy,
the HTTP status and the results, so the whole chain is visible in one command.

## What the function does to the request and the response

| Case | Behaviour |
|---|---|
| `OPTIONS` | answered locally with `ok` + CORS, never reaches Exa |
| path not ending in `/search` | `404` with `{ "error": "Not Found. …" }` |
| no `x-api-key` header | `401` with `{ "error": "x-api-key header is missing." }` |
| request body | parsed and re-serialized, field for field unchanged |
| `x-api-key` | forwarded to Exa as a header; not logged, not stored |
| Exa's answer | re-serialized and returned with Exa's own status code |
| handler failure (bad JSON from Exa, network error) | `500` with `{ "error": <message> }` |

## Security notes

- **The function holds no key.** The provider authenticates with `x-api-key` in the
  header, and the function forwards whatever it is given. So `Access-Control-Allow-Origin: *`
  and `verify_jwt = false` together do **not** hand out your Exa quota: a stranger
  needs their own key to get results.
- **The URL is still a public relay.** Anyone who knows it can push other people's
  Exa calls through your Supabase project and burn your invocation quota (500 000 per
  month on the free plan). Treat the address as semi-public: do not commit it, do not
  post it, redeploy under a new name if it starts drawing traffic you did not send.
- **If you ever move the key to the function side** (a Supabase secret read from
  `Deno.env`, injected into the forwarded request), then put the JWT check back on or
  add your own shared-secret check — otherwise the URL alone is enough to spend your
  Exa quota.
- `Access-Control-Allow-Headers` mentions `authorization`, `x-client-info` and
  `apikey`; the script itself uses only `x-api-key`. Harmless, it just widens what a
  browser is allowed to send.

## Limits and caveats

- Supabase Edge Functions: 256 MB memory, 2 s CPU per request, 150 s wall-clock/idle
  timeout on the free plan (400 s on paid) — a slow upstream turns into `504 Gateway
  Timeout`, which the provider reports as `Exa returned 504`; at most 100 functions per
  project. Invocations: 500 000 per month on the free plan (nothing bills over it, the
  quota simply runs out), paid plans include 2 million and then cost $2 per million.
  Quotas move, check the dashboard.
- The handler does `await exaResponse.json()` and re-serializes, so it buffers the
  whole answer and assumes it is JSON. Exa search answers are small (a plain search is
  ~2.3 KB, with `contents.highlights` ~26 KB, with full page text ~100 KB), which is
  fine. If you ever proxy something bigger, return `exaResponse.body` instead and let
  it stream — but then keep the status passthrough.
- Re-serializing also means a non-JSON upstream failure (an HTML error page from an
  intermediate) makes `.json()` throw and the client gets the function's own `500`
  rather than the upstream status. Acceptable for search; worth knowing when a `500`
  with `{"error": ...}` appears instead of a real Exa error.
- CORS matters only to browser callers. The MCP server is server-side, so for it the
  preflight work is harmless overhead.
