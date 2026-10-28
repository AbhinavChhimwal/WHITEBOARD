import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('authentication, concurrent drawing, persistence, cursors and ten-person capacity', async () => {
  const port = 3100 + Math.floor(Math.random() * 1000), origin = `http://localhost:${port}`;
  const password = 'LET_ME_DRAW';
  const directory = mkdtempSync(join(tmpdir(), 'whiteboard-test-'));
  const server = spawn(process.execPath, ['server.js'], {env:{...process.env, DATA_DIR:directory, PORT:String(port), WHITEBOARD_PASSWORD:password}, stdio:['ignore','pipe','pipe']});
  let startupError = '';
  server.stderr.on('data', chunk => { startupError = (startupError + chunk).slice(-12000); });
  const clients = [];
  const name = `Integration ${Date.now()}`;
  await new Promise((resolve,reject) => { server.stdout.once('data',resolve); server.once('error',reject); server.once('close',code => reject(Error(`Server exited ${code}\n${startupError}`))); });
  async function login(pass = password, user = '') {
    return fetch(origin + '/api/login', {method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:user,password:pass})});
  }
  function wait(ws, predicate) {
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => { ws.off('message', receive); reject(Error('Timed out waiting for socket message')); },5000);
      function receive(raw) { const message = JSON.parse(raw); if (predicate(message)) { clearTimeout(timer); ws.off('message',receive); resolve(message); } }
      ws.on('message',receive);
    });
  }
  async function connect(user) {
    const response = await login(password,user); assert.equal(response.status,200);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const ws = new WebSocket(origin.replace('http','ws') + '/socket',{headers:{Origin:origin,Cookie:cookie}});
    clients.push(ws);
    const welcome = await wait(ws,m => m.type === 'welcome'); return {ws,welcome,cookie};
  }
  const emit = (ws,m) => ws.send(JSON.stringify(m));
  try {
    assert.equal((await login('wrong')).status,401);
    assert.equal((await fetch(origin + '/api/login',{method:'POST',body:'{}'})).status,403);
    assert.equal((await fetch(origin + '/.env')).status,404);
    await new Promise(resolve => { const ws = new WebSocket(origin.replace('http','ws') + '/socket',{headers:{Origin:origin}}); ws.on('error',resolve); ws.on('open',() => { ws.close(); assert.fail('Unauthenticated socket opened'); }); });
    const a = await connect('Alice'), b = await connect('');
    assert.equal(a.welcome.user.name,'Alice'); assert.match(b.welcome.user.name,/^Guest /); assert.notEqual(a.welcome.user.color,b.welcome.user.color);
    let pending = wait(a.ws,m => m.type === 'created'); emit(a.ws,{type:'create',name,paths:[]}); await pending;
    for (const client of [a,b]) { pending = wait(client.ws,m => m.type === 'state'); emit(client.ws,{type:'join',name}); await pending; }
    pending = wait(b.ws,m => m.type === 'embed'); emit(a.ws,{type:'embed',name,url:'https://example.com/'}); assert.equal((await pending).url,'https://example.com/');
    pending = wait(a.ws,m => m.type === 'state'); emit(a.ws,{type:'join',name}); assert.equal((await pending).page.embedUrl,'https://example.com/');
    pending = wait(a.ws,m => m.type === 'error'); emit(a.ws,{type:'embed',name,url:'javascript:alert(1)'}); await pending;
    const stroke = id => ({id,tool:'pen',color:'#000000',size:5,points:[{x:1,y:2},{x:30,y:40}]});
    pending = wait(b.ws,m => m.type === 'patch' && m.upsert[0]?.id === 'a'); emit(a.ws,{type:'patch',name,upsert:[stroke('a')],remove:[]});
    emit(b.ws,{type:'patch',name,upsert:[stroke('b')],remove:[]}); await pending;
    pending = wait(a.ws,m => m.type === 'state'); emit(a.ws,{type:'join',name}); assert.equal((await pending).page.paths.length,2);
    pending = wait(b.ws,m => m.type === 'cursor'); emit(a.ws,{type:'cursor',x:200,y:300,visible:true}); assert.equal((await pending).user,a.welcome.user.id);
    pending = wait(b.ws,m => m.type === 'preview'); emit(a.ws,{type:'preview',path:stroke('preview')}); assert.equal((await pending).path.id,'preview');
    pending = wait(b.ws,m => m.type === 'code'); emit(a.ws,{type:'code',name,code:'const shared = true;',stdin:'shared input',language:'javascript',revision:0}); const syncedCode = await pending; assert.equal(syncedCode.revision,1); assert.equal(syncedCode.stdin,'shared input');
    pending = wait(b.ws,m => m.type === 'code-conflict'); emit(b.ws,{type:'code',name,code:'stale',language:'javascript',revision:0}); assert.equal((await pending).page.code,'const shared = true;');
    pending = wait(b.ws,m => m.type === 'execution'); emit(a.ws,{type:'execution-start',name,revision:1}); const running = (await pending).execution;
    assert.equal(running.status,'running'); assert.equal(running.runner,'Alice');
    pending = wait(b.ws,m => m.type === 'error'); emit(b.ws,{type:'execution-start',name,revision:1}); await pending;
    emit(b.ws,{type:'execution-result',name,id:running.id,result:{stdout:'forged'}});
    pending = wait(b.ws,m => m.type === 'execution' && m.execution.status === 'finished');
    emit(a.ws,{type:'execution-result',name,id:running.id,result:{stdout:'Hello, everyone!',stderr:'',executionTime:12}});
    assert.equal((await pending).execution.result.stdout,'Hello, everyone!');
    pending = wait(b.ws,m => m.type === 'state'); emit(b.ws,{type:'join',name}); assert.equal((await pending).execution.result.stdout,'Hello, everyone!');
    await new Promise(resolve => setTimeout(resolve,250));
    const saved = new Map(JSON.parse(readFileSync(join(directory,'pages.json'),'utf8'))).get(name);
    assert.equal(saved.paths.length,2); assert.equal(saved.code,'const shared = true;');
    assert.equal(saved.stdin,'shared input');
    assert.equal(saved.embedUrl,'https://example.com/');
    pending = wait(a.ws,m => m.type === 'embed'); emit(b.ws,{type:'embed',name,url:null}); assert.equal((await pending).url,null);
    pending = wait(a.ws,m => m.type === 'error'); emit(a.ws,{type:'patch',name,upsert:[{id:'bad',tool:'pen',points:[]}],remove:[]}); await pending;
    for (let i=2;i<10;i++) await connect(`User ${i}`);
    const response = await login(password,'Eleventh');
    await new Promise((resolve,reject) => { const ws = new WebSocket(origin.replace('http','ws')+'/socket',{headers:{Origin:origin,Cookie:response.headers.get('set-cookie').split(';')[0]}}); ws.on('unexpected-response',(req,res) => { assert.equal(res.statusCode,409); res.resume(); resolve(); }); ws.on('open',() => {ws.close();reject(Error('Eleventh user admitted'));}); ws.on('error',()=>{}); });
    pending = wait(b.ws,m => m.type === 'presence' && m.users.length === 9); a.ws.close(); await pending;
    const replacement = await connect('Replacement'); assert.ok(replacement.welcome.user.color);
    pending = wait(b.ws,m => m.type === 'deleted'); emit(b.ws,{type:'delete',name}); await pending;
  } finally {
    for (const ws of clients) ws.terminate();
    server.kill();
  }
});
