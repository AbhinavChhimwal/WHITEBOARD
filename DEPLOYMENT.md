# Deploy the whiteboard on Render

This app needs a running Node.js server, WebSockets, HTTPS, and persistent storage. Deploy the entire project as a **Web Service**. The browser and socket server run on the same public URL. Render supports [WebSockets](https://render.com/docs/websocket) and provides [managed HTTPS](https://render.com/docs/tls).

## 1. Put the project on GitHub

Create a private GitHub repository and upload the project files: `index.html`, `collaboration.js`, `collaboration.css`, `server.js`, `package.json`, `package-lock.json`, `.gitignore`, `.env.example`, documentation and tests. You can use GitHub's upload-files interface or Git. Do not upload `.env`, `node_modules`, `.vercel` or `data`. The included `.gitignore` excludes them when using Git; manual uploads must omit them too.

## 2. Create a web service

In the [Render dashboard](https://dashboard.render.com), choose **New → Web Service**, connect GitHub and select your repository. Use these settings:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Root Directory | Leave blank if `package.json` is at the repository root |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/health` |
| Instances | 1 |

Choose a paid service plan that supports a persistent disk. Render's filesystem is otherwise ephemeral: pages can disappear after restarts and redeploys. [Disk documentation](https://render.com/docs/disks). A free service is useful for a temporary demo, but does not meet this app's saved-page persistence requirement.

## 3. Add persistent storage and environment variables

Attach a disk to the web service with mount path `/var/data` (1 GB is sufficient for a small workspace). Then set these environment variables in the service settings:

| Variable | Value |
| --- | --- |
| `WHITEBOARD_PASSWORD` | The generated password from your local `.env`, or a new securely generated password at least 24 characters long |
| `DATA_DIR` | `/var/data/whiteboard` |
| `NODE_VERSION` | `24` |

Do not set `PORT`: Render supplies it. Do not enter the password into the build/start command or source files.

For the default Render address, no `PUBLIC_ORIGIN` setting is needed: the app uses Render's automatically supplied `RENDER_EXTERNAL_URL` for origin checks and Secure cookies. [Render environment variables](https://render.com/docs/environment-variables).

If using a custom domain, set `PUBLIC_ORIGIN` to the exact address users will visit, for example `https://board.example.com`, with **no trailing slash**. Use that address consistently; this app accepts one public origin. Configure the domain in Render and follow its [DNS instructions](https://render.com/docs/custom-domains).

## 4. Deploy and verify

Create/deploy the service. Wait until the logs show `Whiteboard running on port ...`, then open the HTTPS address displayed by Render. Enter your name, then your workspace password. Create a page and draw something.

Open an incognito window or a second browser, sign in and select the same page. Verify drawing updates, different cursor colors, and opening/closing a shared webpage. A second tab sharing the same login cookie is intentionally rejected; use a separate browser session for testing another participant.

Restart the service once and sign in again: the saved page, code and embed URL should still exist. Sessions are held in memory, so a restart or deployment requires everyone to sign in again. Users also need to sign in again after a lost socket connection.

Share the HTTPS URL and the workspace password privately with your trusted participants. Keep one server instance: this version stores active users and sessions in memory and enforces the ten-user cap within that instance.

## 5. Maintain the deployment

Push future code changes to the connected branch; Render can automatically redeploy them. Back up `/var/data/whiteboard/pages.json`. Existing local pages are not automatically copied to hosting: if needed, transfer your local `data/pages.json` to that path while the hosted service is stopped, before creating remote pages. Replacing the file replaces the hosted page collection; back it up first.

To change access, update `WHITEBOARD_PASSWORD` and redeploy/restart. All existing login sessions are revoked. Anyone with the shared password can join; typed names are display names, not verified identities.

## Troubleshooting

- **Untrusted origin / cannot sign in:** Check that `PUBLIC_ORIGIN`, if set, exactly matches the HTTPS address in the browser, without a trailing slash. Remove it when using only the default Render URL.
- **Pages lost after deploy:** Check that the persistent disk is attached and `DATA_DIR=/var/data/whiteboard` is set.
- **Workspace full:** Ten live connections are already present, or that browser session is open in another tab. Leave one session or use a separate browser profile for another person.
- **Embedded site refuses to load:** The target may prohibit iframe embedding. Use a site that permits it. On the live HTTPS workspace, embed HTTPS links. Shared links do not synchronize browsing or scrolling inside third-party sites.
- **Socket disconnects during a deployment:** Sign in again after deployment finishes. Render closes connections when an instance is replaced. [WebSocket lifecycle](https://render.com/docs/websocket).

Official setup reference: [Deploy a Node app](https://render.com/docs/deploy-node-express-app).
