/** STEP4O.3: node scripts/provisional-estimator.mjs prepare|infer|report forensic-directory output-directory */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { openAnalysisBrowser, localRoute } from './analysis-browser.mjs';
const [mode, forensicPath, outputPath] = process.argv.slice(2);
if (!['prepare', 'infer', 'report'].includes(mode) || !forensicPath || !outputPath) throw new Error('Usage: prepare|infer|report forensic-directory output-directory');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), output = resolve(outputPath), forensic = resolve(forensicPath);
await mkdir(output, { recursive: true });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = async (path) => JSON.parse(await readFile(path, 'utf8'));
const write = (name, data) => writeFile(join(output, name), JSON.stringify(data) + '\n', { flag: 'wx' });
const sourceNames = ['src/provisional/provisionalContract.ts', 'src/provisional/provisionalInference.ts', 'src/provisional/provisionalReport.ts',
  'src/estimator/estimatorAnalysis.ts', 'src/estimator/estimatorConfig.ts', 'src/estimator/estimatorInference.ts', 'scripts/provisional-estimator.mjs', 'scripts/analysis-browser.mjs'];
const sources = Object.fromEntries(await Promise.all(sourceNames.map(async (n) => [n, hash(await readFile(join(root, n)))])));
const server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let browser;
try {
  const contract = await server.ssrLoadModule('/src/provisional/provisionalContract.ts');
  const inference = await server.ssrLoadModule('/src/provisional/provisionalInference.ts');
  const { frameSequence } = await server.ssrLoadModule('/src/estimator/estimatorInference.ts');
  const { readReplaySession } = await server.ssrLoadModule('/src/replay/readReplaySession.ts');
  const oldLedger = await read(join(forensic, 'preregistration.json'));
  for (const [name, sha] of Object.entries(oldLedger.sources)) {
    if (hash(await readFile(join(root, 'src', name))) !== sha) throw new Error('STEP4O.2 frozen source changed: ' + name);
  }
  if (mode === 'prepare') {
    const pairs = [];
    for (const pair of contract.PROVISIONAL_PAIRS) {
      const json = oldLedger.jsons.find((j) => j.captureId === pair.captureId), video = oldLedger.videos.find((v) => v.mediaId === pair.webmSha256);
      if (!json || !video || basename(video.path).normalize('NFC') !== pair.webmFilename) throw new Error('Fixed mapping input missing.');
      if (hash(await readFile(json.path)) !== pair.jsonSha256 || hash(await readFile(video.path)) !== pair.webmSha256) throw new Error('Pinned input hash mismatch.');
      if (contract.canonical(await frameSequence(video.plan.timestamps)) !== contract.canonical(video.plan.sequence)) throw new Error('Invalid authoritative PTS plan.');
      const cachePath = join(forensic, pair.webmSha256 + '.trace.json'), cacheBytes = await readFile(cachePath);
      const cacheCheck = await inference.validateFullVideoCache(JSON.parse(cacheBytes), pair.webmSha256, video.plan);
      pairs.push({ pair, jsonPath: json.path, webmPath: video.path, plan: video.plan, cachePath, cacheSha256: hash(cacheBytes), cacheCheck: { valid: cacheCheck.valid, reason: cacheCheck.reason } });
    }
    await write('scan-registration.json', { ...contract.PROVISIONAL_PROVENANCE, registeredAt: new Date().toISOString(), sources, policy: contract.SENSITIVITY_POLICY,
      configs: contract.PROVISIONAL_VARIANTS.map(contract.provisionalConfig), pairs, limitation: contract.PAIRING_LIMITATION });
    console.log('REGISTERED', pairs.map((p) => ({ role: p.pair.role, fullVideoCacheValid: p.cacheCheck.valid })));
  } else {
    const bytes = await readFile(join(output, 'scan-registration.json')), registration = JSON.parse(bytes), scanId = 'step-4o3-' + hash(bytes).slice(0, 16);
    if (contract.canonical(registration.sources) !== contract.canonical(sources)) throw new Error('Registered source changed. Do not revise policy after observing output.');
    for (const p of registration.pairs) {
      contract.assertProvisionalPair(p.pair);
      if (hash(await readFile(p.jsonPath)) !== p.pair.jsonSha256 || hash(await readFile(p.webmPath)) !== p.pair.webmSha256 || hash(await readFile(p.cachePath)) !== p.cacheSha256) throw new Error('Registered input/cache changed.');
    }
    const runName = (p, variant) => `${p.pair.role}.${variant}.json`;
    if (mode === 'infer') {
      const routes = new Map();
      for (const p of registration.pairs) {
        routes.set('/media/' + p.pair.webmSha256, await localRoute(p.webmPath, 'video/webm'));
        routes.set('/cache/' + p.pair.webmSha256, await localRoute(p.cachePath, 'application/json'));
      }
      browser = await openAnalysisBrowser(server, routes); console.log('GPU', JSON.stringify(browser.environment));
      for (const p of registration.pairs) for (const variant of contract.PROVISIONAL_VARIANTS) {
        const name = runName(p, variant);
        if ((await readdir(output)).includes(name)) { const cached = await read(join(output, name)); if (cached.scanId !== scanId) throw new Error('Output cache scan mismatch.'); console.log('SCAN_CACHE_REUSED', name); continue; }
        await write(name + '.started', { scanId, ...contract.PROVISIONAL_PROVENANCE, startedAt: new Date().toISOString() });
        console.log('START', p.pair.role, variant, p.plan.timestamps.length);
        const run = await browser.evaluate(`(async()=>{const{runProvisionalEstimatorAnalysis}=await import('/src/provisional/provisionalInference.ts');const response=await fetch('/media/${p.pair.webmSha256}');if(!response.ok)throw new Error('WebM fetch failed');const file=new File([await response.blob()],${JSON.stringify(basename(p.webmPath))},{type:'video/webm'});const cache=${variant === 'FULL_VIDEO_CONTROL' ? `await(await fetch('/cache/${p.pair.webmSha256}')).json()` : 'undefined'};return runProvisionalEstimatorAnalysis(${JSON.stringify(p.pair)},file,${JSON.stringify(variant)},${JSON.stringify(p.plan)},new AbortController().signal,n=>{if(n%300===0)console.log('PROVISIONAL_PROGRESS',${JSON.stringify(p.pair.role)},${JSON.stringify(variant)},n);},cache);})()`);
        await write(name, { ...run, scanId, environment: browser.environment, completedAt: new Date().toISOString() });
        console.log('COMPLETE', p.pair.role, variant, run.frames.length, 'cached=' + run.cacheReuse.reused);
      }
    } else {
      const { analyzeProvisionalRun, createProvisionalReport } = await server.ssrLoadModule('/src/provisional/provisionalReport.ts');
      const analyses = [], rawRunHashes = [];
      for (const p of registration.pairs) {
        const session = readReplaySession(await readFile(p.jsonPath, 'utf8'));
        for (const variant of contract.PROVISIONAL_VARIANTS) {
          const name = runName(p, variant), rawBytes = await readFile(join(output, name)), run = JSON.parse(rawBytes);
          if (run.scanId !== scanId || run.mediaId !== p.pair.webmSha256 || contract.canonical(run.config) !== contract.canonical(contract.provisionalConfig(variant)) ||
              contract.canonical(run.sequence) !== contract.canonical(p.plan.sequence) || contract.canonical(run.frames.map((f) => f.tMs)) !== contract.canonical(p.plan.timestamps)) throw new Error('INVALID_FRAME_SEQUENCE or raw run config/hash identity mismatch.');
          rawRunHashes.push({ filename: name, sha256: hash(rawBytes) });
          analyses.push(analyzeProvisionalRun({ filename: basename(p.jsonPath), role: p.pair.role, session }, run));
          console.log('ANALYZED', p.pair.role, variant);
        }
      }
      const createdAt = new Date().toISOString(), report = createProvisionalReport(analyses, createdAt);
      const repeat = createProvisionalReport(analyses, createdAt);
      if (JSON.stringify(report) !== JSON.stringify(repeat)) throw new Error('Report determinism failed.');
      await write('sensitivity-report.json', { scanId, registrationSha256: hash(bytes), rawRunHashes, reportDeterminism: true, ...report });
      console.log('REPORT', scanId, report.classification, 'nextValidation=' + report.nextValidationWorthy);
    }
  }
} finally { browser?.close(); await server.close(); }
