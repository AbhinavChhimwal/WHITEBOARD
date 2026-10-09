// OneCompiler's documented populateCode / codeChangeEvent bridge.
export const COMPILER_ORIGIN = 'https://onecompiler.com';
export const DEFAULT_CODE = '#include <iostream>\n\nint main() {\n    std::cout << "Hello, team!" << std::endl;\n    return 0;\n}\n';
export const LANGUAGE_FILES = {javascript:'index.js',c:'main.c',cpp:'main.cpp',java:'Main.java'};

export function compilerUrl(language = 'cpp', theme = 'light') {
  if (!Object.hasOwn(LANGUAGE_FILES, language)) throw Error('Unsupported language.');
  const url = new URL(`/embed/${language}`, COMPILER_ORIGIN);
  url.search = new URLSearchParams({codeChangeEvent:'true',listenToEvents:'true',hideLanguageSelection:'true',hideNew:'true',hideNewFileOption:'true',hideTitle:'true',hideEditorOptions:'true',hideRun:'true',theme:theme === 'dark' ? 'dark' : 'light'}).toString();
  return url.href;
}

export class CompilerBridge {
  constructor({send,onChange = () => {},onStatus = () => {},onResult = () => {}}) {
    this.send = send; this.onChange = onChange; this.onStatus = onStatus;
    this.onResult = onResult;
    this.state = {code:DEFAULT_CODE,stdin:'',language:'cpp'};
    this.hydrating = true;
    this.echoes = new Set();
  }
  signature(state) { return JSON.stringify([state.language,state.code,state.stdin]); }
  populate() {
    this.echoes.add(this.signature(this.state));
    if (this.echoes.size > 30) this.echoes.delete(this.echoes.values().next().value);
    this.send({eventType:'populateCode',language:this.state.language,files:[{name:LANGUAGE_FILES[this.state.language],content:this.state.code}],stdin:this.state.stdin});
  }
  setState(state) {
    if (!Object.hasOwn(LANGUAGE_FILES,state.language) || typeof state.code !== 'string') return;
    this.state = {code:state.code,stdin:typeof state.stdin === 'string' ? state.stdin : '',language:state.language};
    this.populate();
  }
  receive(data) {
    if (!data || !Object.hasOwn(LANGUAGE_FILES,data.language) || !Array.isArray(data.files) || data.files.length !== 1) return false;
    const code = data.files[0]?.content;
    const stdin = typeof data.stdin === 'string' ? data.stdin : '';
    if (typeof code !== 'string' || code.length > 1000000 || stdin.length > 64000) return false;
    const next = {code,stdin,language:data.language};
    const signature = this.signature(next);
    if (data.action === 'runComplete') { this.onResult(data.result, next); return true; }
    if (signature === this.signature(this.state)) {
      if (this.hydrating) this.echoes.clear(); else this.echoes.delete(signature);
      this.hydrating = false; this.onStatus('ready'); return true;
    }
    if (this.echoes.delete(signature)) return false;
    if (this.hydrating) { this.populate(); return false; }
    this.state = next;
    this.onChange(next); return true;
  }
  run() { if (!this.hydrating) this.send({eventType:'triggerRun'}); }
}

export function createCompilerEditor() {
  const frame = document.getElementById('compiler-frame');
  const hint = document.getElementById('compiler-status');
  const run = document.getElementById('run-code');
  const reload = document.getElementById('reload-compiler');
  const listeners = new Set();
  let requestRun, resultListener, pendingRun, executionBusy = false;
  const output = document.createElement('pre'); output.id = 'shared-run-output'; output.setAttribute('aria-live','polite');
  output.textContent = 'Shared output will appear here when someone runs the code.';
  frame.parentElement.append(output);
  let active = false, loaded = false, activePage = null, theme = document.body.dataset.theme || 'light', retryTimer, attempts = 0;
  const bridge = new CompilerBridge({
    send:message => { if (loaded && active) frame.contentWindow.postMessage(message,COMPILER_ORIGIN); },
    onChange:state => { document.getElementById('lang-select').value = state.language; for (const callback of listeners) callback(); },
    onStatus:() => { clearTimeout(retryTimer); run.disabled = executionBusy; reload.hidden = true; hint.textContent = executionBusy ? 'Running code — results will be shared with this page.' : 'Code, input and run results are shared.'; },
    onResult:(result,state) => {
      if (!pendingRun) return;
      const execution = pendingRun; pendingRun = null; clearTimeout(execution.timer);
      resultListener?.(execution.id,result && typeof result === 'object' ? result : {exception:'The compiler returned no execution result.'});
    },
  });
  function retryPopulate() {
    if (!active || !loaded || !bridge.hydrating) return;
    bridge.populate();
    if (++attempts < 20) retryTimer = setTimeout(retryPopulate,250);
    else { hint.textContent = 'The compiler did not connect. Reload the editor to try again; your shared code is safe.'; reload.hidden = false; }
  }
  frame.addEventListener('load',() => {
    if (!active) return;
    loaded = true; attempts = 0; clearTimeout(retryTimer); retryPopulate();
  });
  window.addEventListener('message',event => {
    if (!active || !loaded || event.source !== frame.contentWindow || event.origin !== COMPILER_ORIGIN) return;
    bridge.receive(event.data);
  });
  function activate(page = activePage, force = false) {
    const changedPage = page !== activePage;
    if (changedPage && pendingRun) { clearTimeout(pendingRun.timer); pendingRun = null; force = true; }
    activePage = page;
    if (active && !force) {
      if (changedPage) { bridge.hydrating = true; run.disabled = true; attempts = 0; clearTimeout(retryTimer); retryPopulate(); }
      else bridge.populate();
      return;
    }
    clearTimeout(retryTimer); active = true; loaded = false; bridge.hydrating = true; run.disabled = true;
    hint.textContent = 'Connecting the compiler…'; reload.hidden = true;
    frame.src = compilerUrl(bridge.state.language,theme);
  }
  run.addEventListener('click',() => requestRun ? requestRun() : bridge.run());
  reload.addEventListener('click',() => activate(activePage,true));
  return {
    showRunPending:() => { run.disabled = true; hint.textContent = 'Syncing code before execution…'; output.textContent = 'Preparing shared execution…'; },
    showRunError:message => { executionBusy = false; run.disabled = bridge.hydrating; hint.textContent = message; output.textContent = message; },
    onRun:callback => { requestRun = callback; },
    onRunResult:callback => { resultListener = callback; },
    executeRun:id => {
      if (bridge.hydrating) { resultListener?.(id,{exception:'Compiler is still loading. Try again.'}); return; }
      pendingRun = {id,signature:bridge.signature(bridge.state)};
      pendingRun.timer = setTimeout(() => { if (pendingRun?.id === id) { pendingRun = null; resultListener?.(id,{exception:'Execution timed out. Try again.'}); } },90000);
      bridge.run();
    },
    showExecution:execution => {
      executionBusy = execution?.status === 'running'; run.disabled = bridge.hydrating || executionBusy;
      hint.textContent = executionBusy ? 'Running code — results will be shared with this page.' : 'Code, input and run results are shared.';
      if (!execution) { output.textContent = 'Shared output will appear here when someone runs the code.'; return; }
      const heading = `${execution.runner} · ${execution.status} · code revision ${execution.revision}`;
      const result = execution.result;
      output.textContent = heading + (result ? '\n' + [result.stdout,result.stderr,result.exception].filter(Boolean).join('\n') + (result.executionTime ? `\nExecution time: ${result.executionTime} ms` : '') : '\nRunning…');
    },
    getValue:() => bridge.state.code,
    setValue:code => bridge.setState({...bridge.state,code}),
    getInput:() => bridge.state.stdin,
    setState:state => bridge.setState(state),
    setLanguage:language => bridge.setState({...bridge.state,language}),
    setTheme:value => { theme = value === 'dark' || value === 'vs-dark' ? 'dark' : 'light'; if (active) activate(activePage,true); },
    onDidChangeModelContent:listener => { listeners.add(listener); return {dispose:() => listeners.delete(listener)}; },
    layout:() => {},
    activate,
    reset:() => { clearTimeout(retryTimer); clearTimeout(pendingRun?.timer); pendingRun = null; executionBusy = false; active = loaded = false; activePage = null; bridge.hydrating = true; run.disabled = true; frame.removeAttribute('src'); },
  };
}
