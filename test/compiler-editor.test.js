import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CompilerBridge, compilerUrl, createCompilerEditor, COMPILER_ORIGIN } from '../compiler-editor.js';

function setup() {
  const sent = [], changes = [];
  const bridge = new CompilerBridge({send:message => sent.push(message),onChange:state => changes.push(state)});
  const message = (code,language = 'cpp',stdin = '') => ({language,stdin,files:[{name:'main.cpp',content:code}]});
  return {bridge,sent,changes,message};
}
test('compiler URL enables both directions of editing and keeps a single shared file', () => {
  for (const language of ['javascript','cpp','c','java']) {
    const url = new URL(compilerUrl(language,'dark'));
    assert.equal(url.origin,'https://onecompiler.com');
    assert.equal(url.searchParams.get('codeChangeEvent'),'true');
    assert.equal(url.searchParams.get('listenToEvents'),'true');
    assert.equal(url.searchParams.get('hideNewFileOption'),'true');
    assert.equal(url.searchParams.get('theme'),'dark');
  }
  assert.throws(() => compilerUrl('../bad'));
});
test('initial compiler templates cannot overwrite the saved page before hydration', () => {
  const {bridge,changes,message,sent} = setup();
  bridge.setState({code:'saved source',stdin:'Alice\n30',language:'cpp'});
  bridge.receive(message('provider starter'));
  assert.equal(bridge.state.code,'saved source'); assert.equal(changes.length,0);
  bridge.receive(message('saved source','cpp','Alice\n30'));
  assert.equal(bridge.hydrating,false);
  bridge.receive(message('a local edit','cpp','input changed'));
  assert.equal(changes.length,1); assert.equal(changes[0].stdin,'input changed');
  bridge.run(); assert.deepEqual(sent.at(-1),{eventType:'triggerRun'});
});
test('remote changes and delayed iframe echoes do not create socket feedback loops', () => {
  const {bridge,changes,message} = setup();
  bridge.receive(message(bridge.state.code));
  bridge.setState({code:'first remote edit',stdin:'',language:'cpp'});
  bridge.setState({code:'second remote edit',stdin:'',language:'cpp'});
  bridge.receive(message('first remote edit'));
  bridge.receive(message('second remote edit'));
  assert.equal(changes.length,0); assert.equal(bridge.state.code,'second remote edit');
  bridge.receive(message('')); assert.equal(changes.at(-1).code,'');
});
test('malformed or unsupported compiler messages are ignored', () => {
  const {bridge,changes,message} = setup();
  bridge.receive(message(bridge.state.code));
  for (const value of [null,{},message('bad','unknown'),{language:'cpp',files:[]},message('a'.repeat(1000001))]) assert.equal(bridge.receive(value),false);
  assert.equal(changes.length,0);
});

test('the iframe adapter rejects forged messages and protects a page switch from stale input', () => {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  const handlers = {}, sent = [];
  const element = () => ({disabled:true,hidden:false,textContent:'',value:'',listeners:{},setAttribute(){},addEventListener(type,fn){this.listeners[type]=fn;},removeAttribute(name){delete this[name];}});
  const frame = element(); frame.contentWindow = {postMessage:(message,origin) => sent.push({message,origin})};
  frame.parentElement = {append(){}};
  const elements = {'compiler-frame':frame,'compiler-status':element(),'run-code':element(),'reload-compiler':element(),'lang-select':element()};
  globalThis.window = {addEventListener:(type,fn) => {handlers[type]=fn;}};
  globalThis.document = {body:{dataset:{theme:'light'}},getElementById:id => elements[id],createElement:element};
  let editor;
  try {
    editor = createCompilerEditor(); const changes = []; editor.onDidChangeModelContent(() => changes.push(editor.getValue()));
    editor.setState({code:'page one',language:'cpp',stdin:''}); editor.activate('one'); frame.listeners.load();
    const message = code => ({origin:COMPILER_ORIGIN,source:frame.contentWindow,data:{language:'cpp',stdin:'',files:[{content:code}]}});
    handlers.message({...message('forged'),origin:'https://evil.example'});
    handlers.message({...message('forged'),source:{}});
    assert.equal(editor.getValue(),'page one'); assert.equal(elements['run-code'].disabled,true);
    handlers.message(message('page one')); assert.equal(elements['run-code'].disabled,false);
    handlers.message(message('local edit')); assert.deepEqual(changes,['local edit']);
    editor.setState({code:'page two',language:'cpp',stdin:''}); editor.activate('two');
    handlers.message(message('stale page one edit')); assert.equal(editor.getValue(),'page two'); assert.equal(changes.length,1);
    handlers.message(message('page two')); assert.equal(elements['run-code'].disabled,false);
    elements['run-code'].listeners.click(); assert.equal(sent.at(-1).message.eventType,'triggerRun'); assert.equal(sent.at(-1).origin,COMPILER_ORIGIN);
    const results = []; editor.onRunResult((id,result) => results.push({id,result})); editor.executeRun('job');
    handlers.message({...message('page two'),data:{...message('page two').data,action:'runComplete',result:{stdout:'Shared hello!',stderr:''}}});
    assert.deepEqual(results,[{id:'job',result:{stdout:'Shared hello!',stderr:''}}]);
    handlers.message({...message('page two'),data:{...message('page two').data,action:'runComplete',result:{stdout:'duplicate'}}});
    assert.equal(results.length,1);
    editor.showExecution({runner:'Alice',status:'running',revision:2}); assert.equal(elements['run-code'].disabled,true);
    handlers.message(message('page two')); assert.equal(elements['run-code'].disabled,true);
    editor.showExecution({runner:'Alice',status:'finished',revision:2,result:{stdout:'Done'}}); assert.equal(elements['run-code'].disabled,false);
    editor.showRunPending(); assert.equal(elements['run-code'].disabled,true);
    editor.showRunError('Restart the backend'); assert.equal(elements['run-code'].disabled,false); assert.equal(elements['compiler-status'].textContent,'Restart the backend');
  } finally {
    editor?.reset(); globalThis.window = previousWindow; globalThis.document = previousDocument;
  }
});
