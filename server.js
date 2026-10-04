import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const root = fileURLToPath(new URL('.', import.meta.url));
if (existsSync(root + '.env')) {
  for (const line of readFileSync(root + '.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}
const password = process.env.WHITEBOARD_PASSWORD;
if (!password || password.length < 24) throw new Error('Set WHITEBOARD_PASSWORD to at least 24 characters in .env.');
const salt = randomBytes(32);
const passwordHash = scryptSync(password, salt, 64);
const publicOrigin = process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL;
const colors = ['#e63946', '#2563eb', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#db2777', '#854d0e', '#4f46e5', '#475569'];
const sessions = new Map();
const attempts = new Map();
const peers = new Map();
const dataDirectory = process.env.DATA_DIR || root + 'data';
mkdirSync(dataDirectory, { recursive: true });
const storage = dataDirectory + '/pages.json';
const pages = new Map(existsSync(storage) ? JSON.parse(readFileSync(storage, 'utf8')) : []);
let persistTimer;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(flush, 150);
}
function flush() {
  writeFileSync(storage + '.tmp', JSON.stringify([...pages]));
  renameSync(storage + '.tmp', storage);
}
const send = (ws, message) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); };
function broadcast(message) { for (const ws of peers.keys()) send(ws, message); }
function presence() { broadcast({ type: 'presence', users: [...peers.values()] }); }
function sessionFor(req) {
  const token = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('wb_session='))?.slice(11);
  const session = sessions.get(token);
  return session && session.expires > Date.now() ? session : null;
}
function sameOrigin(req) {
  if (!req.headers.origin) return false;
  const expected = publicOrigin || `http://${req.headers.host}`;
  return req.headers.origin === expected;
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (req.method === 'GET' && req.url === '/health') return json(200, { ok: true });
  if (req.method === 'POST' && req.url === '/api/login') {
    if (!sameOrigin(req)) return json(403, { error: 'Untrusted origin.' });
    const ip = req.socket.remoteAddress;
    let entry = attempts.get(ip);
    if (!entry || entry.until < Date.now()) attempts.set(ip, entry = { count: 0, until: Date.now() + 900000 });
    if (++entry.count > 10) return json(429, { error: 'Too many attempts. Try again in 15 minutes.' });
    try {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 4096) { json(413, { error: 'Request too large.' }); return; } }
      const input = JSON.parse(body);
      if (typeof input.password !== 'string' || !timingSafeEqual(scryptSync(input.password, salt, 64), passwordHash)) return json(401, { error: 'Incorrect password.' });
      entry.count--;
      const token = randomBytes(32).toString('hex');
      const session = { id: randomUUID(), name: typeof input.name === 'string' ? input.name.trim().slice(0, 40) : '', expires: Date.now() + 12 * 3600000 };
      sessions.set(token, session);
      res.setHeader('Set-Cookie', `wb_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${publicOrigin?.startsWith('https:') ? '; Secure' : ''}`);
      return json(200, { ok: true });
    } catch { return json(400, { error: 'Invalid login request.' }); }
  }
  if (req.method === 'POST' && req.url === '/api/logout') {
    if (!sameOrigin(req)) return json(403, { error: 'Untrusted origin.' });
    const session = sessionFor(req);
    for (const [token, value] of sessions) if (value === session) sessions.delete(token);
    for (const [ws, user] of peers) if (user.id === session?.id) ws.close(4001, 'Logged out');
    res.setHeader('Set-Cookie', 'wb_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return json(200, { ok: true });
  }
  const files = { '/': 'index.html', '/index.html': 'index.html', '/collaboration.js': 'collaboration.js', '/collaboration.css': 'collaboration.css' };
  if (req.method === 'GET' && files[req.url]) {
    res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : req.url.endsWith('.css') ? 'text/css' : 'text/html');
    return res.end(readFileSync(root + files[req.url]));
  }
  json(404, { error: 'Not found.' });
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const session = sessionFor(req);
  if (req.url !== '/socket' || !session || !sameOrigin(req)) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return; }
  if (peers.size >= 10 || [...peers.values()].some(u => u.id === session.id)) { socket.end('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n'); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, session));
});
function validPath(p) {
  const tools = ['pencil', 'pen', 'highlighter', 'eraser', 'rectangle', 'rounded-rectangle', 'square', 'rounded-square', 'circle', 'ellipse', 'image'];
  if (!p || typeof p.id !== 'string' || p.id.length > 100 || !tools.includes(p.tool)) return false;
  const finite = n => Number.isFinite(Number(n)) && Math.abs(Number(n)) <= 100000;
  if (['pencil', 'pen', 'highlighter', 'eraser'].includes(p.tool)) {
    if (!Array.isArray(p.points) || !p.points.length || p.points.length > 20000 || !p.points.every(pt => pt && finite(pt.x) && finite(pt.y))) return false;
  } else if (![p.x, p.y, p.w, p.h].every(finite)) return false;
  if (p.tool === 'image') return typeof p.imageData === 'string' && /^data:image\/(png|jpeg|gif|webp|bmp);base64,/.test(p.imageData) && p.imageData.length < 6 * 1024 * 1024;
  return finite(p.size) && Number(p.size) > 0 && Number(p.size) <= 50 && typeof p.color === 'string' && p.color.length < 100;
}
wss.on('connection', (ws, session) => {
  const color = colors.find(c => ![...peers.values()].some(u => u.color === c));
  const user = { id: session.id, name: session.name || `Guest ${colors.indexOf(color) + 1}`, color, page: null };
  peers.set(ws, user);
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  send(ws, { type: 'welcome', user, pages: [...pages.keys()] });
  presence();
  let tick = Date.now(), count = 0;
  ws.on('message', raw => {
    if (session.expires <= Date.now()) { ws.close(4001, 'Session expired'); return; }
    if (Date.now() - tick > 1000) { tick = Date.now(); count = 0; }
    if (++count > 150) { ws.close(4008, 'Too many messages'); return; }
    try {
      const m = JSON.parse(raw);
      if (m.type === 'create') {
        if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 80 || pages.has(m.name) || pages.size >= 100) throw Error('Page exists or page limit reached.');
        const paths = m.paths || [];
        if (!Array.isArray(paths) || paths.length > 10000 || !paths.every(validPath)) throw Error('Invalid page contents.');
        pages.set(m.name, { paths, code: typeof m.code === 'string' ? m.code.slice(0, 1000000) : '// Start coding here...\n', language: 'javascript', revision: 0, embedUrl: null });
        persist(); broadcast({ type: 'pages', pages: [...pages.keys()] });
        send(ws, { type: 'created', name: m.name, select: m.select });
      } else if (m.type === 'join' && pages.has(m.name)) {
        user.page = m.name; send(ws, { type: 'state', name: m.name, page: pages.get(m.name) }); presence();
      } else if (m.type === 'delete' && pages.has(m.name)) {
        pages.delete(m.name); persist(); broadcast({ type: 'deleted', name: m.name }); broadcast({ type: 'pages', pages: [...pages.keys()] });
      } else if (m.type === 'patch' && m.name === user.page && pages.has(m.name)) {
        const page = pages.get(m.name);
        if (!Array.isArray(m.upsert) || !Array.isArray(m.remove) || m.upsert.length > 10000 || !m.upsert.every(validPath) || !m.remove.every(id => typeof id === 'string')) throw Error('Invalid drawing. Images must be PNG, JPEG, GIF, WebP or BMP under 6 MB.');
        const objects = new Map(page.paths.map(p => [p.id, p]));
        for (const id of m.remove) objects.delete(id);
        for (const p of m.upsert) objects.set(p.id, p);
        if (objects.size > 10000 || Buffer.byteLength(JSON.stringify([...objects.values()])) > 7 * 1024 * 1024) throw Error('Page storage limit reached.');
        page.paths = [...objects.values()]; persist();
        broadcast({ type: 'patch', name: m.name, upsert: m.upsert, remove: m.remove, sender: user.id });
      } else if (m.type === 'code' && m.name === user.page && pages.has(m.name)) {
        const page = pages.get(m.name);
        if (m.revision !== page.revision) return send(ws, { type: 'code-conflict', name: m.name, page });
        if (typeof m.code !== 'string' || m.code.length > 1000000 || !['javascript', 'c', 'cpp', 'java'].includes(m.language)) throw Error('Invalid code.');
        page.code = m.code; page.language = m.language; page.revision++; persist();
        broadcast({ type: 'code', name: m.name, code: page.code, language: page.language, revision: page.revision, sender: user.id });
      } else if (m.type === 'embed' && m.name === user.page && pages.has(m.name)) {
        let url = null;
        if (m.url !== null) {
          if (typeof m.url !== 'string' || m.url.length > 4096) throw Error('Invalid webpage URL.');
          const parsed = new URL(m.url);
          if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw Error('Use an HTTP or HTTPS link without embedded credentials.');
          if (publicOrigin?.startsWith('https:') && parsed.protocol !== 'https:') throw Error('Use an HTTPS link on the live workspace.');
          url = parsed.href;
        }
        pages.get(m.name).embedUrl = url; persist();
        broadcast({ type: 'embed', name: m.name, url });
      } else if (m.type === 'cursor') {
        if (m.visible && (!Number.isFinite(m.x) || !Number.isFinite(m.y))) return;
        broadcast({ type: 'cursor', user: user.id, page: user.page, x: m.x, y: m.y, visible: !!m.visible });
      } else if (m.type === 'preview') {
        if (m.path !== null && (!validPath(m.path) || JSON.stringify(m.path).length > 250000)) return;
        broadcast({ type: 'preview', user: user.id, page: user.page, path: m.path });
      }
    } catch (error) { send(ws, { type: 'error', message: error.message || 'Invalid request.' }); }
  });
  ws.on('error', () => {});
  ws.on('close', () => { peers.delete(ws); presence(); });
});
const heartbeat = setInterval(() => {
  for (const [ws, user] of peers) {
    if (!ws.alive || ![...sessions.values()].some(s => s.id === user.id && s.expires > Date.now())) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
  for (const [token, s] of sessions) if (s.expires <= Date.now()) sessions.delete(token);
  for (const [ip, attempt] of attempts) if (attempt.until < Date.now()) attempts.delete(ip);
}, 30000);
heartbeat.unref();
function shutdown() { clearTimeout(persistTimer); flush(); for (const ws of peers.keys()) ws.terminate(); server.close(() => process.exit(0)); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
server.listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => console.log(`Whiteboard running on port ${Number(process.env.PORT) || 3000}`));
