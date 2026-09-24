# Tusk AI proxy

A tiny, zero-dependency proxy that lets the Cerberus AI web page use the same
models as the Tusk AI Companion desktop app. It ships in two interchangeable
flavors, both with the same routes and behavior:

- **`worker.mjs`** — a Cloudflare Worker. Deploy once, always on, free. This is
  the one to use so the AI is automatic for every visitor.
- **`server.mjs`** — a plain Node server. Use it locally, in tests, or on any
  Node host (Docker/Procfile/render.yaml are included).

## Why it exists

The Tusk model API (`https://new.tusksearch.com`) is keyless, but it only
answers requests that carry an `Origin` / `Referer` of its own site, and it
sends no CORS headers. A browser page cannot set those headers, so it cannot
call the API directly. The proxy adds the headers and relays the stream back. It
is a transparent forwarder: no API key, no storage, no accounts.

## Connect it (Cloudflare Worker — recommended)

**This project is already deployed.** The live proxy is:

```
https://cerberus-tusk-proxy.cerberus-tusk-proxy.workers.dev
```

That URL is set as `aiProxyUrl` in `src/js/config.js`, so the page connects to it automatically and
nobody has to run anything. To redeploy after a change:

```bash
cd tools/tusk-proxy
npx wrangler deploy
```

### Deploying from scratch (one-time setup)

1. Create a free Cloudflare account: https://dash.cloudflare.com/sign-up
   (no credit card).
2. From `tools/tusk-proxy`, log in Wrangler (this opens a browser; click Allow):

   ```bash
   cd tools/tusk-proxy
   npx wrangler login
   ```

3. Deploy:

   ```bash
   npx wrangler deploy
   ```

   It prints a URL like `https://cerberus-tusk-proxy.<you>.workers.dev`.

4. Put that URL in `src/js/config.js` as `aiProxyUrl`. Reload the site: live AI
   turns on by itself, everywhere, with no clicks.

To use the Worker locally first, run `npx wrangler dev` — it serves the same
routes on `http://127.0.0.1:8787`.

Lock it down: in the Cloudflare dashboard, add a variable
`ALLOW_ORIGIN = https://your-site.example` so only your page can use it.

## Run the Node flavor

```bash
node tools/tusk-proxy/server.mjs
```

It prints the port (default 8787). Open the Cerberus page, then in the "Live
AI" panel enter the proxy URL (for example `http://127.0.0.1:8787`) and click
Reconnect. Once a hosted proxy URL is set in `src/js/config.js` (`aiProxyUrl`),
the page connects to it automatically and no one has to run anything.

## Host the Node flavor

The static site cannot reach the Tusk API on its own, because Tusk requires an
`Origin` header the browser cannot set. That is why this proxy exists. Host the
proxy once, then point the page at it:

1. Deploy this folder as a small Node web service. Ready-made options are in
   this repo: `tools/tusk-proxy/Dockerfile`, `Procfile`, and `render.yaml`.
   - Docker: `docker build -t tusk-proxy tools/tusk-proxy && docker run -p 8787:8787 tusk-proxy`
   - Render/Railway/Fly/Heroku: point at `tools/tusk-proxy/server.mjs` (the
     `Procfile` and `render.yaml` already do this).
2. Set the environment (see below). At minimum set `ALLOW_ORIGIN` to your live
   site origin so only your page can use it.
3. Copy the service URL into `src/js/config.js` as `aiProxyUrl`. Reload the
   site: live AI turns on by itself.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Port to listen on (0 picks a free port). Node flavor only. |
| `HOST` | `0.0.0.0` | Interface to bind. Use `127.0.0.1` to keep it loopback-only. Node flavor only. |
| `ALLOW_ORIGIN` | `*` | Comma-separated CORS allow-list of site origins. Set to your live site in production. Both flavors. |
| `QUIET` | unset | Set to `1` to silence request logging. Node flavor only. |
| `UPSTREAM_ORIGIN` | `https://new.tusksearch.com` | Upstream base URL. Tests point this at a stub. Both flavors. |

On the Worker, `ALLOW_ORIGIN` and `UPSTREAM_ORIGIN` are set as Worker variables
(dashboard or `wrangler secret`/`[vars]`), not shell environment variables.

## Routes

Both flavors expose the same routes:

| Method | Path | Bodies / notes |
| --- | --- | --- |
| GET | `/` and `/health` | Identity/health, for host checks. |
| GET | `/api/health` | `{ ok, upstream, service }`. Used for the connection test. |
| GET | `/api/models` | The 23-model catalog from `models.json`. |
| POST | `/api/session` | `{ aiModelId, content? }` to open a conversation. |
| POST | `/api/chat` | `{ sessionId, chatId, aiModelId, content, ... }`, streamed. |

## Tests

```bash
cd tools/tusk-proxy
node --test
```

Two suites run offline. `server.test.mjs` and `relay.test.mjs` boot the real
Node proxy on an ephemeral port against a local stub upstream. `worker.test.mjs`
imports `worker.mjs` and calls its `fetch` handler directly in Node with a
stubbed upstream, so the Worker logic is verified without the Cloudflare
runtime. Together they assert routing, validation, CORS, the injected Tusk
`Origin` header, and that stream bytes pass through unchanged.

## Limits

- The upstream is a third-party, undocumented service. It can change, throttle
  (`X-Rate-Limit-*` headers), or go down. Cerberus falls back to its on-device
  engine when the proxy is unreachable.
- A public proxy spends the keyless upstream for anyone who can reach it. Always
  set `ALLOW_ORIGIN` to your site origin before exposing it.
- Cloudflare Workers free plan allows 100,000 requests/day and has no cold
  starts, which is far more than this app needs.
