/** Local analysis only. Usage: node scripts/forensic-media.mjs prepare|infer|report inventory.json output-directory */
import { readFile, writeFile, mkdir, mkdtemp, readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import { Input, FilePathSource, WEBM, EncodedPacketSink } from 'mediabunny';

const [mode, inventoryPath, outputPath] = process.argv.slice(2);
if (!['prepare', 'infer', 'report'].includes(mode) || !inventoryPath || !outputPath) throw new Error('Usage: prepare|infer|report inventory.json output-directory');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), output = resolve(outputPath);
await mkdir(output, { recursive: true });
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = async (path) => JSON.parse(await readFile(path, 'utf8'));
const write = async (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const ledgerPath = join(output, 'preregistration.json');
const sourcePaths = ['forensic/forensicRules.ts', 'forensic/forensicMath.ts', 'forensic/forensicScoring.ts', 'forensic/forensicRecorded.ts', 'forensic/forensicInference.ts',
  'estimator/estimatorConfig.ts', 'pose/poseConstants.ts', 'pose/createPoseLandmarker.ts', 'replay/decodedVideoSource.ts', 'replay/replayTypes.ts'];
const sources = Object.fromEntries(await Promise.all(sourcePaths.map(async (p) => [p, digest(await readFile(join(root, 'src', p)))])));
const server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let chrome, socket;
try {
  const { FORENSIC_RULES, FORENSIC_JOINTS } = await server.ssrLoadModule('/src/forensic/forensicRules.ts');
  const { frameSequence } = await server.ssrLoadModule('/src/estimator/estimatorInference.ts');
  const { recordedTrace } = await server.ssrLoadModule('/src/forensic/forensicRecorded.ts');
  const { readReplaySession } = await server.ssrLoadModule('/src/replay/readReplaySession.ts');
  if (mode === 'prepare') {
    const inventory = await read(inventoryPath);
    // Deliberately select only file inventory. Prior pairings/assessment never enter the scorer.
    const jsons = [], videos = [];
    for (const item of inventory.jsons) {
      const bytes = await readFile(item.path), sha256 = digest(bytes);
      if (sha256 !== item.sha256) throw new Error('JSON changed since inventory: ' + item.path);
      const session = readReplaySession(bytes.toString());
      const trace = recordedTrace({ filename: basename(item.path), role: item.role, session });
      jsons.push({ path: item.path, filename: basename(item.path), role: item.role, sha256, captureId: trace.captureId,
        captureDurationMs: trace.captureDurationMs, requiredEndMs: trace.requiredEndMs, windows: trace.windows });
    }
    for (const item of inventory.videos) {
      const sha256 = digest(await readFile(item.path)); if (sha256 !== item.sha256) throw new Error('WebM changed since inventory: ' + item.path);
      const input = new Input({ source: new FilePathSource(item.path), formats: [WEBM] });
      try {
        const track = await input.getPrimaryVideoTrack(); if (!track) throw new Error('Missing video track');
        const timestamps = [];
        for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) timestamps.push(packet.timestamp * 1000);
        videos.push({ path: item.path, filename: basename(item.path), mediaId: sha256, byteLength: (await stat(item.path)).size,
          plan: { timestamps, sequence: await frameSequence(timestamps) } });
      } finally { input.dispose(); }
    }
    if (jsons.length !== 5 || videos.length !== 6) throw new Error('STEP4O.2 requires exactly 5 JSON and 6 media.');
    await write(ledgerPath, { step: '4O.2', frozenAt: new Date().toISOString(), rules: FORENSIC_RULES, joints: FORENSIC_JOINTS,
      sources, jsons, videos, metadataOnly: true, inferenceHasNotStarted: true });
    console.log('PRE_REGISTERED', ledgerPath);
  } else {
    const ledgerBytes = await readFile(ledgerPath), ledger = JSON.parse(ledgerBytes), reportId = 'step-4o2-' + digest(ledgerBytes).slice(0, 16);
    if (JSON.stringify(sources) !== JSON.stringify(ledger.sources)) throw new Error('Frozen source changed; do not tune forensic rules after inference.');
    for (const item of [...ledger.jsons, ...ledger.videos]) if (digest(await readFile(item.path)) !== (item.sha256 ?? item.mediaId)) throw new Error('Source content changed: ' + item.path);
    if (mode === 'infer') {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/forensic.html') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>STEP4O.2 Forensic only</title><p>Full VIDEO GPU sequential forensic inference. No camera or recording.</p>'); return; }
        const match = /^\/forensic-media\/([a-f0-9]{64})$/.exec(req.url ?? '');
        if (!match) return next();
        const media = ledger.videos.find((v) => v.mediaId === match[1]);
        if (!media) { res.statusCode = 404; res.end(); return; }
        res.setHeader('Content-Type', 'video/webm'); res.setHeader('Content-Length', media.byteLength); createReadStream(media.path).pipe(res);
      });
      // Place the read-only allowlist route before Vite's SPA HTML fallback.
      server.middlewares.stack.unshift(server.middlewares.stack.pop());
      await server.listen();
      const port = server.httpServer.address().port, profile = await mkdtemp(join(tmpdir(), 'plank-stork-forensic-chrome-'));
      const chromePath = process.env.FORENSIC_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      chrome = spawn(chromePath, ['--user-data-dir=' + profile, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'], { stdio: 'ignore' });
      let debugPort;
      for (let i = 0; i < 100; i++) { try { debugPort = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
      if (!debugPort) throw new Error('Isolated Chrome debugging port unavailable.');
      const tabs = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      socket = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
      await new Promise((r, reject) => { socket.addEventListener('open', r, { once: true }); socket.addEventListener('error', reject, { once: true }); });
      let nextId = 0; const pending = new Map();
      socket.addEventListener('message', (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); }
        else if (msg.method === 'Runtime.consoleAPICalled') {
          const line = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
          if (line.startsWith('FORENSIC_PROGRESS')) console.log(line);
        }
      });
      const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
      const evaluate = async (expression) => {
        const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
        return r.result.value;
      };
      await call('Runtime.enable'); await call('Page.enable'); await call('Page.navigate', { url: `http://127.0.0.1:${port}/forensic.html` });
      await new Promise((r) => setTimeout(r, 1000));
      const environment = await evaluate(`(() => { const c=document.createElement('canvas'),g=c.getContext('webgl2'),e=g?.getExtension('WEBGL_debug_renderer_info');return {userAgent:navigator.userAgent,webCodecs:typeof VideoDecoder!=='undefined',webgl2:!!g,renderer:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):null};})()`);
      if (!environment.webgl2 || !environment.webCodecs || /SwiftShader|llvmpipe|software/i.test(environment.renderer ?? '')) throw new Error('Hardware GPU/WebCodecs required: ' + JSON.stringify(environment));
      console.log('GPU_ENVIRONMENT', JSON.stringify(environment));
      for (const media of ledger.videos) {
        const cachePath = join(output, media.mediaId + '.trace.json');
        if ((await readdir(output)).includes(basename(cachePath))) {
          const cache = await read(cachePath); if (cache.reportId !== reportId || cache.mediaId !== media.mediaId) throw new Error('Invalid cache binding.');
          console.log('CACHE_REUSED', media.filename); continue;
        }
        // Exclusive start marker prevents silently re-running a partially failed inference.
        await write(join(output, media.mediaId + '.started.json'), { reportId, startedAt: new Date().toISOString() });
        console.log('INFERENCE_START', media.filename, media.plan.timestamps.length);
        const run = await evaluate(`(async()=>{const {inferForensicMedia}=await import('/src/forensic/forensicInference.ts');const response=await fetch('/forensic-media/${media.mediaId}');if(!response.ok)throw new Error('Media fetch failed');const blob=await response.blob();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==${JSON.stringify(media.mediaId)})throw new Error('Served media hash mismatch before inference');const file=new File([blob],${JSON.stringify(media.filename)},{type:'video/webm'});return inferForensicMedia(file,${JSON.stringify(media.mediaId)},${JSON.stringify(media.plan)},new AbortController().signal,(n)=>{if(n%300===0)console.log('FORENSIC_PROGRESS',${JSON.stringify(media.filename)},n);});})()`);
        await write(cachePath, { reportId, ...run, environment, completedAt: new Date().toISOString() });
        console.log('INFERENCE_COMPLETE', media.filename, run.sequence.decodedFrameCount);
      }
    } else {
      const { scoreTraceMatrix } = await server.ssrLoadModule('/src/forensic/forensicScoring.ts');
      const recorded = [];
      for (const j of ledger.jsons) recorded.push(recordedTrace({ filename: j.filename, role: j.role, session: readReplaySession(await readFile(j.path, 'utf8')) }));
      const inferred = [];
      for (const v of ledger.videos) {
        const cache = await read(join(output, v.mediaId + '.trace.json'));
        if (cache.reportId !== reportId || cache.mediaId !== v.mediaId || JSON.stringify(cache.sequence) !== JSON.stringify(v.plan.sequence)) throw new Error('Cache is not bound to preregistration/complete PTS.');
        inferred.push(cache);
      }
      const result = scoreTraceMatrix(recorded, inferred);
      await write(join(output, 'forensic-report.json'), { reportId, createdAt: new Date().toISOString(), preregistrationSha256: digest(ledgerBytes), rules: ledger.rules,
        inputs: { jsons: ledger.jsons, videos: ledger.videos.map(({ plan, ...v }) => ({ ...v, sequence: plan.sequence })) }, ...result,
        fourOAllowed: result.allVerified, blockedCaptures: result.rows.filter((r) => !r.verified).map((r) => r.captureId) });
      console.log('REPORT_COMPLETE', reportId, 'allVerified=' + result.allVerified);
      for (const row of result.rows) console.log(JSON.stringify(row));
    }
  }
} finally {
  socket?.close(); if (chrome) chrome.kill('SIGTERM'); await server.close();
}
