HEAD
# Collaborative whiteboard

Run `npm install`, then `npm start`, and open http://localhost:3000. Share the server URL with trusted people; all clients must reach the same server. Node.js 22 or later is required.

The private `.env` file contains the generated `WHITEBOARD_PASSWORD`. Share that password privately. Names are requested before the password; a blank name receives a Guest alias. Ten authenticated connections can participate at once, each with a distinct cursor color. A session is limited to one open tab and expires after 12 hours. Use Leave to revoke it.

The JavaScript backend uses WebSockets, checks the password on the server using scrypt and constant-time comparison, limits login attempts, and issues an HttpOnly, SameSite cookie. The password is never included in frontend assets. Names are display labels, not verified identities; anyone holding the shared password can join. Change the password in `.env` and restart to revoke all sessions.

Pages, strokes, erasers, shapes, image movement/resizing, deletions, code, language changes and webpage embeds synchronize. Opening or closing an embed affects everyone viewing that shared page. The URL persists and is restored for later arrivals. Switching pages restores that page's embed. Browsing, scrolling and sign-in inside a third-party iframe remain independent for each user, and sites that block embedding cannot be displayed. Theme, drawing preferences, exports and webcam remain personal. Drawing uses a common 1600 × 900 coordinate system across screen sizes. Independent drawings merge by object ID; simultaneous changes to the same image use the last received update. Image uploads support PNG, JPEG, GIF, WebP and BMP, with a 6 MB encoded-image limit and a 7 MB total page limit. Up to 100 shared pages are supported.

Code updates synchronize with revision checks. If simultaneous code edits conflict, the rejected local text downloads as `whiteboard-code-recovery.txt`, and the editor receives the server version. This is not character-level collaborative code editing.

The coding view uses OneCompiler's embedded editor, with its documented code-change and populate-code messages connected to our sockets. C, C++, Java and JavaScript can be compiled/run through **Run code**. Code and standard input sync with the selected page. One participant runs the code once; output, errors, runner name and code revision appear in a shared results panel for everyone on that page. The latest result is available to later arrivals during this server session. Only messages from the actual OneCompiler iframe and its exact origin are accepted. New pages start with a runnable C++ example; existing pages retain their code and language. Compilation requires internet access and OneCompiler availability; it does not run untrusted code on our Node server. [Provider documentation](https://onecompiler.com/apis/embed-editor).

Shared pages persist in `data/pages.json`; back up this directory. Existing browser-local pages can be imported through **Import saved pages** in the page picker. They are not uploaded automatically. A disconnected client must sign in again; the server restores its saved state.

For internet hosting, deploy this server on a host supporting long-running Node.js processes and WebSocket upgrades, with persistent storage and HTTPS. Set `PUBLIC_ORIGIN=https://your-domain.example` in the environment so origin checks match and session cookies use Secure. Static-only hosting of `index.html` cannot run the socket server. Use a single server instance to enforce the global ten-person limit. Never publish `.env` or `data/`.

Run `npm test` for integration checks covering authentication, authorization, shared drawings, code conflicts, cursor messages and capacity.

For step-by-step live hosting instructions, see [DEPLOYMENT.md](DEPLOYMENT.md).

For the requested free Vercel demonstration, see [VERCEL-DEMO.md](VERCEL-DEMO.md). It describes the necessary backend adapter, temporary shared state and reconnect behavior; those serverless changes are not implemented yet. Existing local runtime and storage remain intact.


