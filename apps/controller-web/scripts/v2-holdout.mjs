/** STEP4Q: node scripts/v2-holdout.mjs infer|report capture.json capture.webm private-output-directory */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { openAnalysisBrowser, localRoute } from './analysis-browser.mjs';

const [mode, jsonArg, videoArg, outputArg] = process.argv.slice(2);
if (!['infer', 'report'].includes(mode) || !jsonArg || !videoArg || !outputArg)
  throw new Error('Usage: infer|report capture.json capture.webm private-output-directory');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), repository = resolve(root, '../..');
const jsonPath = resolve(jsonArg), videoPath = resolve(videoArg), output = resolve(outputArg);
if (!relative(repository, output).startsWith('..' + '/')) throw new Error('Raw outputs must be outside the repository.');
await mkdir(output, { recursive: true });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = async (name) => JSON.parse(await readFile(join(output, name), 'utf8'));
const write = (name, data) => writeFile(join(output, name), JSON.stringify(data) + '\n', { flag: 'wx' });
const sourceNames = ['src/estimator/estimatorInference.ts', 'src/estimator/estimatorConfig.ts', 'src/estimator/estimatorAnalysis.ts',
  'src/replay/mediaArtifact.ts', 'src/replay/decodedVideoSource.ts', 'src/replay/kneeKickV3Replay.ts',
  'src/pose/kick/kneeKickDetectorV3.ts', 'src/capture/estimatorValidationProtocol.ts',
  'src/discovery/geometryReliabilityFeatures.ts', 'src/discovery/integrityGuard.ts', 'scripts/v2-holdout.mjs'];
const sources = Object.fromEntries(await Promise.all(sourceNames.map(async (name) => [name, hash(await readFile(join(root, name)))])));
const server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let browser;
try {
  const { readReplaySession } = await server.ssrLoadModule('/src/replay/readReplaySession.ts');
  const { ESTIMATOR_VALIDATION_PROTOCOL_V1: protocol } = await server.ssrLoadModule('/src/capture/estimatorValidationProtocol.ts');
  const { estimatorConfig } = await server.ssrLoadModule('/src/estimator/estimatorConfig.ts');
  const jsonBytes = await readFile(jsonPath), videoBytes = await readFile(videoPath), session = readReplaySession(jsonBytes.toString('utf8'));
  if (session.version !== 2 || session.validation?.protocolId !== protocol.id || session.validation.status !== 'VALIDATION_CAPTURE_COMPLETE' || session.liveResult.trials.length !== 1)
    throw new Error('STEP4Q requires one completed V2 holdout trial.');
  if (hash(videoBytes) !== session.video.integrity.sha256 || videoBytes.length !== session.video.integrity.byteLength)
    throw new Error('V2 SHA/byteLength mismatch.');
  const identity = { captureId: session.captureId, jsonSha256: hash(jsonBytes), webmSha256: hash(videoBytes), byteLength: videoBytes.length };
  const configs = protocol.estimatorVariants.map(estimatorConfig);
  if (mode === 'infer') {
    // Explicit write-once attempt record: never silently rerun or select a better estimator outcome.
    await write('attempt.json', { step: '4Q', createdAt: new Date().toISOString(), identity, sources, configs, protocol,
      policy: { singleCapture: true, baseline: 'Each variant own landmarks in the captured exact 3s reference',
        anchors: 'NONE', fiveRoleAcceptance: false, controlLiveBitParityRequired: false, productionReplacement: false } });
    browser = await openAnalysisBrowser(server, new Map([
      ['/holdout.json', await localRoute(jsonPath, 'application/json')], ['/holdout.webm', await localRoute(videoPath, 'video/webm')],
    ]));
    console.log('GPU', JSON.stringify(browser.environment));
    const verified = await browser.evaluate(`(async()=>{
      document.title='STEP4Q verified V2 holdout';document.body.textContent='STEP4Q · single-capture analysis only · no camera';
      const {readReplaySession}=await import('/src/replay/readReplaySession.ts');
      const {ReplayMediaValidationCache}=await import('/src/replay/mediaArtifact.ts');
      const {validateEstimatorMediaArtifact,decodeEstimatorFrames}=await import('/src/estimator/estimatorInference.ts');
      const session=readReplaySession(await(await fetch('/holdout.json')).text());
      const file=new File([await(await fetch('/holdout.webm')).blob()],${JSON.stringify(basename(videoPath))},{type:'video/webm'});
      const cache=new ReplayMediaValidationCache(),signal=new AbortController().signal;
      const identity=await validateEstimatorMediaArtifact(session,file,signal,cache);
      const plan=await decodeEstimatorFrames(file,session,signal,()=>{},cache);
      window.__step4q={session,file,cache,signal,plan};return {identity,plan};
    })()`);
    await write('registration.json', { identity, sources, configs, protocol, environment: browser.environment,
      verifiedMedia: verified.identity, plan: verified.plan, reference: session.liveResult.trials[0].estimatorNeutralReference,
      registeredAt: new Date().toISOString() });
    console.log('VERIFIED', JSON.stringify({ ...identity, sequence: verified.plan.sequence }));
    for (const variant of protocol.estimatorVariants) {
      const startedAt = new Date().toISOString(), before = performance.now();
      await write(variant + '.started.json', { variant, startedAt, identity });
      console.log('START', variant, verified.plan.timestamps.length);
      const run = await browser.evaluate(`(async()=>{const{runEstimator}=await import('/src/estimator/estimatorInference.ts');
        const h=window.__step4q;return runEstimator(h.file,h.session,${JSON.stringify(variant)},h.plan,h.signal,
          n=>{if(n%300===0)console.log('PROVISIONAL_PROGRESS STEP4Q',${JSON.stringify(variant)},n);},h.cache);})()`);
      await write(variant + '.json', { ...run, holdoutIdentity: identity, environment: browser.environment,
        startedAt, completedAt: new Date().toISOString(), offlineWallMs: performance.now() - before });
      console.log('COMPLETE', variant, run.frames.length);
    }
  } else {
    const registration = await read('registration.json');
    if (JSON.stringify(registration.identity) !== JSON.stringify(identity) || JSON.stringify(registration.sources) !== JSON.stringify(sources) ||
        JSON.stringify(registration.configs) !== JSON.stringify(configs)) throw new Error('Registered inputs/config/source changed.');
    const { createV2HoldoutReport } = await server.ssrLoadModule('/src/holdout/v2HoldoutAnalysis.ts');
    const runs = [], rawRunHashes = [];
    for (const variant of protocol.estimatorVariants) {
      const name = variant + '.json', bytes = await readFile(join(output, name)), run = JSON.parse(bytes);
      if (JSON.stringify(run.holdoutIdentity) !== JSON.stringify(identity)) throw new Error('Raw run capture mismatch.');
      rawRunHashes.push({ filename: name, sha256: hash(bytes) }); runs.push(run);
    }
    const createdAt = new Date().toISOString();
    const report = await createV2HoldoutReport(session, runs, registration.plan, createdAt);
    if (JSON.stringify(report) !== JSON.stringify(await createV2HoldoutReport(session, runs, registration.plan, createdAt)))
      throw new Error('STEP4Q report is not deterministic.');
    await write('holdout-report.json', { ...report, provenance: { ...identity, rawRunHashes, environment: registration.environment,
      registeredSources: sources, analysisSha256: hash(await readFile(join(root, 'src/holdout/v2HoldoutAnalysis.ts'))), reportDeterminism: true } });
    console.log('REPORT', report.status, report.variants.map((v) => ({ variant: v.variant, baseline: v.baselineStatus, outcome: v.eventAssessment })));
  }
} finally { browser?.close(); await server.close(); }
