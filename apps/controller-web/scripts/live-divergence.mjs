/** STEP4R: saved-data analysis only. No browser, decode or inference entry point. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';

const [jsonArg, webmArg, step4qArg, outputArg] = process.argv.slice(2);
if (!jsonArg || !webmArg || !step4qArg || !outputArg) throw new Error('Usage: capture.json capture.webm step4q-private-directory step4r-registered-private-directory');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), repository = resolve(root, '../..');
const output = resolve(outputArg), q = resolve(step4qArg);
if (!relative(repository, output).startsWith('../') || output === q) throw new Error('Use a separate private output directory outside the repository.');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = async (path) => JSON.parse(await readFile(path, 'utf8'));
const qBefore = await readFile(join(q, 'holdout-report.json'));
const oldReport = JSON.parse(qBefore), provenance = oldReport.provenance;
const qRegistrationBytes = await readFile(join(q, 'registration.json'));
const registered = JSON.parse(qRegistrationBytes), policy = await read(join(output, 'registration.json'));
const same = (a, b, message) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(message); };
same(hash(qBefore), policy.step4qReportSha256, 'STEP4Q report changed. STOP; no reinference.');
same(hash(qRegistrationBytes), policy.step4qRegistrationSha256, 'STEP4Q registration changed. STOP.');
const jsonBytes = await readFile(resolve(jsonArg)), webmBytes = await readFile(resolve(webmArg));
same(hash(jsonBytes), provenance.jsonSha256, 'Capture JSON SHA mismatch.');
same(hash(webmBytes), provenance.webmSha256, 'WebM SHA mismatch.');
same(webmBytes.length, provenance.byteLength, 'WebM byteLength mismatch.');
for (const [path, expected] of Object.entries(policy.verifiedHashes))
  same(hash(await readFile(resolve(root, path))), expected, `Registered input/source changed: ${path}`);
for (const [path, expected] of Object.entries(provenance.registeredSources))
  same(hash(await readFile(join(root, path))), expected, `STEP4Q source changed: ${path}`);
same(hash(await readFile(join(root, 'src/holdout/v2HoldoutAnalysis.ts'))), provenance.analysisSha256, 'STEP4Q analysis source changed.');
const runs = [];
for (const item of provenance.rawRunHashes) {
  const bytes = await readFile(join(q, item.filename)); same(hash(bytes), item.sha256, `Raw run SHA mismatch: ${item.filename}`);
  const run = JSON.parse(bytes); same(run.holdoutIdentity, registered.identity, 'Raw run identity mismatch.'); runs.push(run);
}
const server = await createServer({ root, configFile: false, logLevel: 'error' });
try {
  const { readReplaySession } = await server.ssrLoadModule('/src/replay/readReplaySession.ts');
  const { estimatorConfig } = await server.ssrLoadModule('/src/estimator/estimatorConfig.ts');
  const { ESTIMATOR_VALIDATION_PROTOCOL_V1 } = await server.ssrLoadModule('/src/capture/estimatorValidationProtocol.ts');
  same(registered.configs, registered.protocol.estimatorVariants.map(estimatorConfig), 'Estimator config mismatch.');
  same(registered.protocol, ESTIMATOR_VALIDATION_PROTOCOL_V1, 'Protocol mismatch.');
  const session = readReplaySession(jsonBytes.toString('utf8'));
  const { createV2HoldoutReport } = await server.ssrLoadModule('/src/holdout/v2HoldoutAnalysis.ts');
  // Recompute analysis only from cached landmarks; verifies every PTS/media/config and all 4Q observations.
  const preserved = await createV2HoldoutReport(session, runs, registered.plan, oldReport.createdAt);
  const { provenance: _provenance, ...original } = oldReport;
  same(preserved, original, 'STEP4Q report no longer reproduces. STOP.');
  const { ALIGNMENT_TOLERANCE_MS } = await server.ssrLoadModule('/src/holdout/divergenceTimeline.ts');
  same(ALIGNMENT_TOLERANCE_MS, policy.alignment.toleranceMs, 'Pre-registered alignment changed.');
  const { createLiveDivergenceReport } = await server.ssrLoadModule('/src/holdout/liveDivergenceAnalysis.ts');
  const report = createLiveDivergenceReport(session, runs);
  same(report, createLiveDivergenceReport(session, runs), 'Non-deterministic STEP4R report.');
  same(hash(await readFile(join(q, 'holdout-report.json'))), hash(qBefore), 'STEP4Q report was modified.');
  const sourcePaths = ['scripts/live-divergence.mjs', 'src/holdout/liveDivergenceAnalysis.ts', 'src/holdout/divergenceTimeline.ts'];
  const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, hash(await readFile(join(root, path)))])));
  await writeFile(join(output, 'divergence-report.json'), JSON.stringify({ ...report, provenance: {
    capture: registered.identity, rawRunHashes: provenance.rawRunHashes, step4qReportSha256: hash(qBefore),
    step4qReportReproduced: true, step4qSourcesUnchanged: true, noInference: true, deterministic: true,
    registrationSha256: hash(await readFile(join(output, 'registration.json'))), sourceHashes,
  } }) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ parity: report.originalParity.status, attribution: report.attribution,
    counterfactuals: report.counterfactuals.map((c) => ({ id: c.id, counts: c.counts, events: c.events?.map((e) => ({ direction: e.direction, timestamp: e.timestamp, stageIndex: e.stageIndex })) })),
    comparisons: report.comparisons, output }, null, 2));
} finally { await server.close(); }
