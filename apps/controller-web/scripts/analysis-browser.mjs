import { createReadStream } from 'node:fs';
import { readFile, mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

/** Isolated local Chrome, read-only exact file allowlist, no camera or upload route. */
export async function openAnalysisBrowser(server, files) {
  server.middlewares.use((req, res, next) => {
    if (req.url === '/analysis.html') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Provisional estimator sensitivity</title><p>PROVISIONAL_MEDIA_PAIR · POST_FAILURE_EXPLORATORY · NON_DECISIONAL</p>'); return; }
    const item = files.get(req.url);
    if (!item) return next();
    res.setHeader('Content-Type', item.type); res.setHeader('Content-Length', item.byteLength); createReadStream(item.path).pipe(res);
  });
  server.middlewares.stack.unshift(server.middlewares.stack.pop());
  await server.listen(); const port = server.httpServer.address().port;
  const profile = await mkdtemp(join(tmpdir(), 'plank-stork-provisional-chrome-'));
  const chrome = spawn(process.env.FORENSIC_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--user-data-dir=' + profile, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'], { stdio: 'ignore' });
  let socket;
  try {
    let debugPort;
    for (let i = 0; i < 100; i++) { try { debugPort = +(await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    if (!debugPort) throw new Error('Isolated Chrome debugging port unavailable.');
    const tabs = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    socket = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let id = 0; const pending = new Map();
    socket.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id) { const p = pending.get(msg.id); if (!p) return; pending.delete(msg.id); clearTimeout(p.timer); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); }
      else if (msg.method === 'Runtime.consoleAPICalled') { const line = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '); if (line.startsWith('PROVISIONAL_PROGRESS')) console.log(line); }
    });
    socket.addEventListener('close', () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Analysis browser closed.')); } pending.clear(); });
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const n = ++id, timer = setTimeout(() => { pending.delete(n); reject(new Error('Analysis browser command timed out.')); }, 1800000);
      pending.set(n, { resolve, reject, timer }); socket.send(JSON.stringify({ id: n, method, params }));
    });
    const evaluate = async (expression) => {
      const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await call('Runtime.enable'); await call('Page.enable'); await call('Page.navigate', { url: `http://127.0.0.1:${port}/analysis.html` });
    await new Promise((r) => setTimeout(r, 500));
    const environment = await evaluate(`(()=>{const g=document.createElement('canvas').getContext('webgl2'),e=g?.getExtension('WEBGL_debug_renderer_info');return {userAgent:navigator.userAgent,webCodecs:typeof VideoDecoder!=='undefined',webgl2:!!g,renderer:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):null};})()`);
    if (!environment.webCodecs || !environment.webgl2 || /SwiftShader|llvmpipe|software/i.test(environment.renderer ?? '')) throw new Error('Hardware GPU/WebCodecs required.');
    return { evaluate, environment, close() { socket.close(); chrome.kill('SIGTERM'); } };
  } catch (cause) { socket?.close(); chrome.kill('SIGTERM'); throw cause; }
}
export async function localRoute(path, type) { return { path, type, byteLength: (await stat(path)).size }; }
