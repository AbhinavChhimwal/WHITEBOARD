# Vercel Hobby demo plan

This is a deployment plan, not a claim that the current standalone server already runs on Vercel. The project keeps its existing `server.js`, local page storage and `npm start` workflow. The iframe compiler runs on OneCompiler, independently of the whiteboard hosting.

## Why temporary shared state is still needed

Long-term saved-page storage can be skipped for your demo. However, live collaboration needs one agreed room state, user count and broadcast channel. Vercel may put different sockets on different Function instances. Keeping this state only in the current server's Maps could split participants into separate rooms or admit more than ten people.

Use a small external Redis database to coordinate the demo room, with short expiry times. This is temporary collaboration state, not a requirement to preserve the whiteboard after your demo. Vercel's [WebSocket documentation](https://vercel.com/docs/functions/websockets) explicitly describes this requirement. WebSockets are currently available in beta on all plans.

## 1. Prepare a Vercel backend adapter

Before redeploying, add a separate Vercel entrypoint that exports an `http.Server`, as shown in Vercel's Node framework example. Preserve the standalone entrypoint for local development. The serverless entrypoint must not create/write the local `data/pages.json` file or call `server.listen()`.

Configure `vercel.json` so `/api/login`, `/api/logout`, `/health` and `/socket` reach that Function. Keep `index.html`, `collaboration.js`, `collaboration.css`, `api-client.js` and `compiler-editor.js` available as static frontend files. Exclude `.env`, `data`, tests and `node_modules` from static publishing; use a frontend-only output directory or an explicit publishing allowlist. Do not publish the repository root indiscriminately.

The adapter must:

- Share authenticated sessions and login attempt counters between instances, or use server-verified signed cookies with a stable server-only secret.
- Use Redis atomic operations for admitting up to ten active participants, assigning unique colors and accepting page changes. A separate read-then-write user count is not sufficient.
- Relay updates between instances with Redis pub/sub or a short-lived stream, including drawing previews, cursors, code, input and embedded webpages.
- Give active participants a heartbeat lease, releasing stale slots when a browser disappears. Retain a reconnecting user's ID/color without counting them twice.
- Keep demo page state for a short period, for example two hours, so a reconnect can restore the room. Preserve the existing local persistence path for non-Vercel hosting.

These adapter changes are **not implemented in the current repository**. Deploying the existing frontend again without this adapter repeats the previous missing-login-API error.

## 2. Add a free shared-state service

Create a free Redis database through the Vercel Marketplace or the provider's dashboard. Upstash offers a [free tier](https://upstash.com/pricing/redis). Keep it on the free plan for the demo and check its current request/bandwidth limits before rehearsal. Select a region close to the Vercel Function region.

Save its TLS connection URL as `REDIS_URL` in Vercel environment variables. The adapter should use a Redis client compatible with its broadcast implementation. Never put this connection string in frontend code.

## 3. Set up the Vercel project

Import the GitHub repository into a personal Hobby project. Set the Node version to a supported version matching local development (Node 24), enable Fluid compute, and use the prepared frontend output directory and Function routes. This app does not need a frontend framework.

Add production environment variables:

| Variable | Purpose |
| --- | --- |
| `WHITEBOARD_PASSWORD` | Existing strong workspace password |
| `PUBLIC_ORIGIN` | Exact final HTTPS address, without a trailing slash |
| `REDIS_URL` | Server-only Redis TLS connection string |
| `SESSION_SECRET` | A separate random secret of at least 32 bytes if the adapter uses signed cookies |

Use the final production address for the demo. Preview URLs need matching origin configuration. Do not upload your local `.env` file.

## 4. Handle the free Function lifetime

Vercel's [Hobby plan](https://vercel.com/docs/plans/hobby) currently allows a maximum Function duration of 300 seconds. A socket can close when its Function reaches that duration. The present app requires manual sign-in after a lost socket; the Vercel adapter needs an automatic reconnect flow for a smooth demo.

Add reconnect with a short exponential backoff, reuse a valid authenticated session, rejoin the selected page and reload authoritative state. Keep a pending local edit/drawing recoverable until the server acknowledges it. Do not buffer a large number of cursor/preview messages during disconnects. Show a small reconnecting indicator and disable new edits while the room state is being restored.

Skipping automatic reconnect because the demo is short is risky: a connection could already be several minutes old before you begin presenting.

## 5. Rehearse the actual hosted deployment

1. Open `/health` on the deployed domain; expect JSON `{"ok":true}`.
2. Sign in from two separate browsers, select the same page and confirm strokes, erasers, image movement, cursors and embeds sync.
3. Edit code in one embedded editor. Verify it reaches the other editor, then run it there.
4. Test all supported languages: C, C++, Java and JavaScript. Confirm that one participant runs the code and everyone on the page receives identical output and compilation errors in the shared results panel.
5. Leave both clients connected for over six minutes. Confirm the free-tier socket renewal restores the same page and users.
6. Test ten simultaneous users and verify that an eleventh is rejected. Close one browser and verify its slot eventually becomes available.
7. Refresh one browser during active drawing and code editing. Verify that it restores the room without overwriting another user's work.

Use small images and moderate drawing activity during the demo to stay within free-tier limits. Cursor/preview updates must be throttled and should not be written individually to durable storage.

## What this plan does and does not promise

The free-tier architecture can support a small personal demonstration, but external compiler availability, network interruptions and hosting quotas still apply. The current local tests verify the standalone server and editor bridge; they do not verify the future Vercel adapter. Do not announce the deployment as demo-ready until the hosted rehearsal above passes.

No existing runtime or storage feature is removed by this plan. The local server remains the working reference implementation.
