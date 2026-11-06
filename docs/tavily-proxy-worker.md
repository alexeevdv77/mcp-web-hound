# Tavily through a Cloudflare Worker

An optional, self-hosted pass-through in front of `api.tavily.com`. It exists for one
reason: the Tavily provider talks to a fixed origin, and from some networks that origin
answers `403 Forbidden`. Measured on 2026-11-03 — `api.tavily.com/search` → `403` from
this network, the same key through a Worker we run ourselves → `200` with results.

The Worker is stateless: no keys, no storage, no environment variables. It forwards the
path and query to Tavily, carries the client's headers and JSON body through, and adds
CORS to the answer. The provider keeps sending `api_key` inside the JSON body, so the
Worker holds no credential of its own to configure or protect.

## Deploy

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Worker**.
2. Replace the starter code with the script below (module syntax, `export default { fetch }`), then **Deploy**.
3. Note the URL Cloudflare gives you — `https://<worker>.<account>.workers.dev` — or attach a custom domain. Keep it out of this repository; the placeholder is deliberate, same rule as the Bing Worker note in [roadmap.md](roadmap.md).

## Script

```js
export default {
  async fetch(request, env, ctx) {
    // CORS preflight. Answer it locally — a browser will not send the real
    // request until this succeeds, and Tavily has no reason to see it.
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // Keep the path and the query, swap only the origin.
    const originUrl = new URL(request.url);
    const targetUrl = "https://api.tavily.com" + originUrl.pathname + originUrl.search;

    const newHeaders = new Headers(request.headers);
    // Cloudflare sets the upstream host itself.
    newHeaders.delete("host");

    let requestBody = null;
    if (request.method !== "GET" && request.method !== "HEAD") {
      requestBody = await request.text();
      // The body is re-read below; let the runtime compute the length.
      newHeaders.delete("content-length");
    }

    const modifiedRequest = new Request(targetUrl, {
      method: request.method,
      headers: newHeaders,
      body: requestBody,
      redirect: "follow",
    });

    try {
      const response = await fetch(modifiedRequest);

      // Buffer the whole answer instead of streaming it. Workers' fetch has
      // already decoded the body, so the upstream encoding headers are stale.
      const fullResponseBody = await response.arrayBuffer();

      // Copy the upstream headers, then add CORS for browser callers.
      const resHeaders = new Headers(response.headers);
      resHeaders.set("Access-Control-Allow-Origin", "*");
      resHeaders.set("Access-Control-Allow-Headers", "*");
      resHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

      // Drop the encoding, otherwise clients wait for gzip bytes that were
      // already decoded — that is the curl hang this proxy is written around.
      resHeaders.delete("content-encoding");

      return new Response(fullResponseBody, {
        status: response.status,
        statusText: response.statusText,
        headers: resHeaders,
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: "Proxy error", details: error.message }), {
        status: 502,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  },
};
```

`env` and `ctx` are unused on purpose: nothing is configured on the Worker side.

## Point the server at it

```env
TAVILY_BASE_URL=https://<worker>.<account>.workers.dev
```

`/search` is appended automatically, so the base is the origin only. A value that
already ends with `/search` is accepted too, a trailing slash is ignored, and an empty
value falls back to `https://api.tavily.com` — see
`tavilySearchUrl()` in [src/search/providers/tavily.ts](../src/search/providers/tavily.ts).

The resulting call is `POST https://<worker>.<account>.workers.dev/search`, which the
Worker forwards to `POST https://api.tavily.com/search`. `npm run test:tavily` prints
the resolved endpoint, the status and the first results, so the whole chain is visible
in one command.

## What it does to the request and the response

| Step | Behaviour |
|---|---|
| `OPTIONS` | answered locally with `204` + CORS, never reaches Tavily |
| Method, path, query | forwarded unchanged (`GET`, `POST`, everything else) |
| Request headers | copied minus `host`; `content-length` is dropped when a body is re-read |
| Request body | read as text and re-sent, so JSON body auth keeps working |
| Upstream redirects | followed inside the Worker |
| Response body | buffered with `arrayBuffer()` — no streaming |
| Response headers | copied minus `content-encoding`, plus `Access-Control-Allow-*` |
| Worker/network failure | `502` with `{ "error": "Proxy error", "details": … }` |

Buffering is the point of this variant: passing a decoded body through together with
`content-encoding: gzip` makes clients sit and wait for bytes that will never come
(the original hang under `curl`). Tavily answers are a few kilobytes, so holding one in
memory costs nothing.

## Security notes

- **The Worker holds no key.** The provider authenticates with `api_key` in the JSON
  body, so the proxy only relays what the caller sent. `Access-Control-Allow-Origin: *`
  is therefore not a credential leak — a random web page cannot borrow your Tavily key.
- **The URL is an open relay.** Anyone who learns it can push *their own* Tavily calls
  through your Cloudflare account and burn your request quota. Treat the URL as
  semi-public: do not commit it, do not post it, rotate (delete and recreate the Worker)
  if it starts drawing traffic you did not send.
- **If you ever put the key on the Worker side** (`env.TAVILY_API_KEY`, injected into the
  forwarded body), the `*` CORS above becomes dangerous: replace it with an origin
  allowlist and add a shared-secret header. Not done here on purpose.

## Limits and caveats

- Cloudflare's free plan caps requests per day and CPU time per invocation; the exact
  numbers change, check the dashboard. Tavily's own free quota (1000 requests/month)
  still applies — this proxy changes the network path, not the billing.
- The response is buffered, so a huge payload would be held in memory; normal search
  answers are small, but do not reuse this Worker for file downloads.
- The upstream `content-length` is copied while the body is now decoded. The runtime
  normally recomputes it; if a client ever reports a truncated body, add
  `resHeaders.delete("content-length")` next to the `content-encoding` line.
- CORS is only needed for browser callers. The MCP server is server-side, so for it the
  CORS work is harmless overhead.
