// Shared pages and embed URLs are authoritative on the server. Theme and webcam remain personal.
let socket, me, sharedPages = [], applyingRemote = false, connected = false;
let attemptedLogin = false;
let baseline = new Map(), codeRevision = 0, codeInFlight = false, codeDirty = false;
let sharedCode = '// Start coding here...\n', sharedLanguage = 'javascript', boardTimer, codeTimer;
const cursors = new Map();
const remotePreviews = new Map();
const drawSharedBoard = redraw;
redraw = function() {
  drawSharedBoard();
  for (const p of remotePreviews.values()) {
    if (p.points) { ctx.save(); if (p.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out'; drawPath(p); ctx.restore(); }
    else drawShape(p);
  }
};
const authOverlay = document.createElement('div');
authOverlay.id = 'auth-overlay';
authOverlay.innerHTML = `<form id="auth-card"><h1>Join the whiteboard</h1><p>A private workspace for up to 10 people.</p><section id="name-step"><label for="join-name">Your name</label><input id="join-name" maxlength="40" autocomplete="name" placeholder="Enter your name (optional)"><small>Leave this blank to receive a Guest alias.</small><button type="button" id="name-next">Continue</button></section><section id="password-step" hidden><label for="join-password">Workspace password</label><input id="join-password" type="password" autocomplete="current-password" required disabled><button id="join-submit">Join workspace</button><button type="button" id="name-back">Change name</button></section><p id="auth-error" role="alert"></p></form>`;
document.body.append(authOverlay);
const status = document.createElement('span'); status.id = 'collaboration-status'; status.setAttribute('role', 'status');
const participants = document.createElement('div'); participants.id = 'participants';
const logout = document.createElement('button'); logout.textContent = 'Leave'; logout.hidden = true;
document.querySelector('.top-bar .right').prepend(status, participants, logout);
const cursorLayer = document.createElement('div'); cursorLayer.id = 'cursor-layer'; whiteboardDiv.append(cursorLayer);
const authError = document.getElementById('auth-error');
const embedNotice = document.createElement('span');
embedNotice.textContent = 'Shared webpage · browsing inside it is personal';
embedNotice.style.cssText = 'float:left;font-size:12px;padding:5px;color:#334155';
cfEmbedContainer.firstElementChild.prepend(embedNotice);
cfIframe.referrerPolicy = 'no-referrer';
function applyEmbed(url) {
  const visible = typeof url === 'string' && url.length > 0;
  cfLink.value = visible ? url : '';
  cfEmbedContainer.style.display = visible ? 'block' : 'none';
  if (visible && cfIframe.getAttribute('src') !== url) cfIframe.src = url;
  if (!visible) cfIframe.removeAttribute('src');
}
embedCFBtn.addEventListener('click', event => {
  event.stopImmediatePropagation();
  if (!currentPage || !connected) { status.textContent = 'Join a shared page before embedding a webpage.'; return; }
  const url = cfLink.value.trim();
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw Error('Use an HTTP or HTTPS link without embedded credentials.');
    emit({type:'embed',name:currentPage,url:parsed.href});
  } catch (error) { status.textContent = error.message; }
}, true);
closeCFEmbed.title = 'Close shared webpage for everyone on this page';
closeCFEmbed.addEventListener('click', event => {
  event.stopImmediatePropagation();
  if (currentPage && connected) emit({type:'embed',name:currentPage,url:null});
}, true);
function passwordStep(show) {
  document.getElementById('name-step').hidden = show;
  document.getElementById('password-step').hidden = !show;
  document.getElementById('join-password').disabled = !show;
  document.getElementById(show ? 'join-password' : 'join-name').focus();
}
document.getElementById('name-next').onclick = () => passwordStep(true);
document.getElementById('name-back').onclick = () => passwordStep(false);
document.getElementById('join-name').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); passwordStep(true); } };
document.getElementById('auth-card').onsubmit = async e => {
  e.preventDefault();
  const submit = document.getElementById('join-submit'); submit.disabled = true; authError.textContent = '';
  try {
    const response = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:document.getElementById('join-name').value,password:document.getElementById('join-password').value}) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    document.getElementById('join-password').value = '';
    attemptedLogin = true;
    connect();
  } catch (error) { authError.textContent = error.message; }
  finally { submit.disabled = false; }
};
logout.onclick = async () => { await fetch('/api/logout', {method:'POST'}); socket?.close(); };
function emit(message) { if (connected && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
function serialize(object) {
  object.id ||= crypto.randomUUID();
  const { image, ...plain } = object;
  if (object.tool === 'image') plain.imageData = image?.src || object.imageData;
  return plain;
}
function hydrate(object) {
  const result = {...object};
  if (result.tool === 'image') { const image = new Image(); image.onload = () => { applyingRemote = true; redraw(); applyingRemote = false; }; image.src = result.imageData; result.image = image; }
  return result;
}
function resetBaseline() { baseline = new Map(paths.map(p => { const plain = serialize(p); return [plain.id, JSON.stringify(plain)]; })); }
function syncBoard() {
  if (!connected || applyingRemote || !currentPage) return;
  const next = new Map(), upsert = [];
  for (const object of paths) { const plain = serialize(object), value = JSON.stringify(plain); next.set(plain.id, value); if (baseline.get(plain.id) !== value) upsert.push(plain); }
  const remove = [...baseline.keys()].filter(id => !next.has(id));
  if (upsert.length || remove.length) emit({type:'patch',name:currentPage,upsert,remove});
  baseline = next;
}
savePage = function () { if (!applyingRemote) { clearTimeout(boardTimer); boardTimer = setTimeout(syncBoard, 40); } };
savePageAs = function(name, objects, sizes, code) { emit({type:'create',name:name.trim(),paths:objects.map(serialize),code,select:false}); };
listPages = function() {
  pageListDiv.replaceChildren();
  if (!sharedPages.length) { const empty = document.createElement('p'); empty.textContent = 'No shared pages yet. Create one to start.'; pageListDiv.append(empty); }
  for (const name of sharedPages) {
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;margin:6px 0';
    const button = document.createElement('button'); button.textContent = name; button.style.cssText = 'flex:1;padding:8px;text-align:left'; button.onclick = () => selectPage(name);
    const remove = document.createElement('button'); remove.textContent = '✖'; remove.title = 'Delete shared page'; remove.onclick = () => { if (confirm(`Delete shared page "${name}" for everyone?`)) emit({type:'delete',name}); };
    row.append(button, remove); pageListDiv.append(row);
  }
};
selectPage = function(name) { syncBoard(); sendCode(); if (codeInFlight) { status.textContent = 'Wait for code to finish syncing, then switch pages.'; return; } emit({type:'join',name}); };
const importButton = document.createElement('button');
importButton.textContent = 'Import saved pages';
importButton.style.cssText = 'display:block;margin-top:16px';
pageListDiv.parentElement.append(importButton);
importButton.onclick = () => {
  let imported = 0;
  try {
    for (const key of Object.keys(localStorage).filter(key => key.startsWith(PAGE_PREFIX))) {
      const name = key.slice(PAGE_PREFIX.length);
      if (sharedPages.includes(name)) continue;
      const saved = JSON.parse(localStorage.getItem(key));
      emit({type:'create',name,paths:(saved.paths || []).filter(p => p.tool !== 'stroke-eraser').map(serialize),code:localStorage.getItem(CODE_PREFIX + name) || '// Start coding here...\n',select:false});
      imported++;
    }
    status.textContent = imported ? `Importing ${imported} saved pages…` : 'No new saved pages to import.';
  } catch { status.textContent = 'A saved page could not be imported.'; }
};
createPageBtn.onclick = () => { const name = newPageName.value.trim(); if (name) emit({type:'create',name,paths:[],select:true}); };
addToListBtn.onclick = () => { const name = prompt('Enter a name for the new shared page:'); if (name?.trim()) savePageAs(name, paths, toolSizes, window.editor?.getValue() || sharedCode); };
loadPage = function() { if (currentPage) emit({type:'join',name:currentPage}); };
afterCodeChange = function() { if (!applyingRemote && currentPage) { codeDirty = true; clearTimeout(codeTimer); codeTimer = setTimeout(sendCode, 200); } };
// The existing listener holds the old function reference; add a collaborative listener when Monaco is ready.
require(['vs/editor/editor.main'], () => {
  if (!window.editor) return;
  applyingRemote = true; window.editor.setValue(sharedCode); monaco.editor.setModelLanguage(window.editor.getModel(), sharedLanguage); applyingRemote = false;
  window.editor.onDidChangeModelContent(afterCodeChange);
});
function sendCode() {
  if (!connected || !currentPage || applyingRemote || codeInFlight || !codeDirty) return;
  codeDirty = false; codeInFlight = true;
  emit({type:'code',name:currentPage,code:window.editor?.getValue() || sharedCode,language:langSelect.value,revision:codeRevision});
}
langSelect.addEventListener('change', afterCodeChange);
function applyCode(page) {
  sharedCode = page.code; sharedLanguage = page.language; codeRevision = page.revision;
  langSelect.value = page.language;
  if (window.editor) { const position = window.editor.getPosition(); if (window.editor.getValue() !== page.code) window.editor.setValue(page.code); monaco.editor.setModelLanguage(window.editor.getModel(), page.language); if (position) window.editor.setPosition(position); }
}
function connect() {
  socket?.close();
  status.textContent = 'Connecting…';
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/socket`); socket = ws;
  ws.onmessage = event => {
    if (socket !== ws) return;
    const message = JSON.parse(event.data);
    applyingRemote = true;
    try {
      if (message.type === 'welcome') {
        connected = true; me = message.user; sharedPages = message.pages; authOverlay.style.display = 'none'; logout.hidden = false;
        listPages(); pageModal.style.display = 'flex'; status.textContent = 'Connected';
        if (currentPage && sharedPages.includes(currentPage)) emit({type:'join',name:currentPage});
      } else if (message.type === 'pages') { sharedPages = message.pages; listPages(); }
      else if (message.type === 'created') { newPageName.value = ''; if (message.select) selectPage(message.name); }
      else if (message.type === 'state') {
        currentPage = message.name; paths = message.page.paths.map(hydrate); resetBaseline(); isDrawing = false; currentPath = previewShape = draggingImage = resizingImage = null;
        codeInFlight = codeDirty = false; applyCode(message.page); pageModal.style.display = 'none'; redraw(); clearCursors();
        applyEmbed(message.page.embedUrl);
      } else if (message.type === 'patch' && message.name === currentPage && message.sender !== me.id) {
        syncBoardBeforeRemote();
        const objects = new Map(paths.map(p => [p.id,p]));
        for (const id of message.remove) { objects.delete(id); baseline.delete(id); }
        for (const p of message.upsert) { objects.set(p.id,hydrate(p)); baseline.set(p.id,JSON.stringify(p)); }
        paths = [...objects.values()]; redraw();
      } else if (message.type === 'code' && message.name === currentPage) {
        codeRevision = message.revision;
        if (message.sender === me.id) { codeInFlight = false; sharedCode = message.code; sharedLanguage = message.language; }
        else if (!codeInFlight && !codeDirty) applyCode(message);
      } else if (message.type === 'code-conflict' && message.name === currentPage) {
        // Preserve a rejected edit as a downloadable recovery file before accepting authoritative text.
        const blob = new Blob([window.editor?.getValue() || sharedCode], {type:'text/plain'});
        const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'whiteboard-code-recovery.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
        codeInFlight = codeDirty = false; applyCode(message.page); status.textContent = 'Code conflict: your edit was saved in a recovery file.';
      } else if (message.type === 'deleted' && message.name === currentPage) {
        currentPage = null; paths = []; baseline.clear(); redraw(); pageModal.style.display = 'flex'; clearCursors(); applyEmbed(null);
      } else if (message.type === 'embed' && message.name === currentPage) {
        applyEmbed(message.url);
      } else if (message.type === 'presence') renderPresence(message.users);
      else if (message.type === 'cursor') renderCursor(message);
      else if (message.type === 'preview' && message.user !== me.id && message.page === currentPage) {
        if (message.path) remotePreviews.set(message.user,message.path); else remotePreviews.delete(message.user);
        redraw();
      }
      else if (message.type === 'error') { status.textContent = message.message; if (currentPage) loadPage(); }
    } finally { applyingRemote = false; }
    if (codeDirty && !codeInFlight) sendCode();
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    connected = false; codeInFlight = false; clearCursors(); applyEmbed(null); participants.replaceChildren(); logout.hidden = true;
    authOverlay.style.display = 'flex'; status.textContent = 'Disconnected';
    authError.textContent = attemptedLogin ? 'Connection closed. Sign in to retry. The workspace may be full (10 people), or this session is already open in another tab.' : '';
  };
  ws.onerror = () => { status.textContent = 'Unable to connect'; };
}
function syncBoardBeforeRemote() { applyingRemote = false; syncBoard(); applyingRemote = true; }
function clearCursors() { cursorLayer.replaceChildren(); cursors.clear(); remotePreviews.clear(); redraw(); }
function renderPresence(users) {
  participants.replaceChildren();
  status.textContent = `${users.length}/10 online`;
  for (const user of users) {
    const chip = document.createElement('span'); chip.className = 'participant'; chip.style.setProperty('--user-color',user.color); chip.textContent = user.name + (user.id === me.id ? ' (you)' : ''); chip.title = user.page || 'Choosing a page'; participants.append(chip);
    if (user.id !== me.id) {
      let cursor = cursors.get(user.id);
      if (!cursor) { const element = document.createElement('div'); element.className = 'remote-cursor'; element.innerHTML = '<svg viewBox="0 0 24 30"><path d="M2 2 L2 24 L8 18 L13 28 L17 26 L12 16 L22 16 Z" fill="currentColor" stroke="white"/></svg><span></span>'; element.hidden = true; cursorLayer.append(element); cursor = {element}; cursors.set(user.id,cursor); }
      cursor.element.style.setProperty('--user-color',user.color); cursor.element.querySelector('span').textContent = user.name;
      if (user.page !== currentPage) cursor.element.hidden = true;
    }
  }
  for (const [id,cursor] of cursors) if (!users.some(u => u.id === id)) { cursor.element.remove(); cursors.delete(id); }
  for (const id of remotePreviews.keys()) if (!users.some(u => u.id === id && u.page === currentPage)) remotePreviews.delete(id);
  redraw();
}
function renderCursor(message) {
  const cursor = cursors.get(message.user); if (!cursor) return;
  cursor.element.hidden = !message.visible || message.page !== currentPage;
  cursor.element.style.transform = `translate(${message.x / 1600 * canvas.clientWidth}px,${message.y / 900 * canvas.clientHeight}px)`;
}
let cursorTick = 0;
let previewTick = 0;
function sendPreview() {
  if (Date.now() - previewTick < 60) return;
  previewTick = Date.now();
  const path = currentPath || previewShape;
  if (path && path.tool !== 'stroke-eraser') emit({type:'preview',path:serialize(path)});
}
canvas.addEventListener('mousemove',sendPreview);
canvas.addEventListener('touchmove',sendPreview,{passive:true});
for (const event of ['mouseup','touchend','mouseleave']) canvas.addEventListener(event, () => { syncBoard(); emit({type:'preview',path:null}); });
canvas.addEventListener('pointermove', event => { if (Date.now() - cursorTick < 40) return; cursorTick = Date.now(); emit({type:'cursor',...getPos(event),visible:true}); });
canvas.addEventListener('pointerleave', () => emit({type:'cursor',visible:false}));
btnEditor.addEventListener('click', () => emit({type:'cursor',visible:false}));
document.addEventListener('visibilitychange', () => { if (document.hidden) emit({type:'cursor',visible:false}); });
window.addEventListener('DOMContentLoaded', () => { listPages(); document.getElementById('join-name').focus(); });
connect();
