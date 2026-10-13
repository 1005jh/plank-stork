/** STEP4S: node scripts/recovery-policy.mjs capture.json capture.webm step4q-dir step4r-dir registered-step4s-dir */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';

const [jsonArg, webmArg, qArg, rArg, outArg] = process.argv.slice(2);
if (!jsonArg || !webmArg || !qArg || !rArg || !outArg) throw new Error('Usage: capture.json capture.webm step4q-dir step4r-dir registered-step4s-dir');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), repo = resolve(root, '../..');
const q = resolve(qArg), r = resolve(rArg), output = resolve(outArg);
if (!relative(repo, output).startsWith('../') || output === q || output === r) throw new Error('Separate output directory outside Git required.');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const same = (a, b, message) => { if (!isDeepStrictEqual(a, b)) throw new Error(message); };
const write = (name, data) => writeFile(join(output, name), JSON.stringify(data) + '\n', { flag: 'wx' });
const registration = await json(join(output, 'registration.json'));
same(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), registration.head, 'Registered HEAD changed.');
same(registration.policies, ['CONTROL', 'S1', 'S2', 'S1+S2'], 'Policy list changed.');
for (const [path, expected] of Object.entries(registration.hashes)) same(hash(await readFile(path)), expected, `Registered input changed: ${path}`);
const preservation = await json(join(output, 'preservation-before.json'));
const verifyPreservation = async () => {
  for (const [path, expected] of Object.entries(preservation.tracked)) same(hash(await readFile(join(repo, path))), expected, `Existing source/result changed: ${path}`);
  for (const [path, expected] of Object.entries(preservation.private)) same(hash(await readFile(path)), expected, `STEP4Q/4R private file changed: ${path}`);
};
await verifyPreservation();
const qReport = await json(join(q, 'holdout-report.json')), qRegistration = await json(join(q, 'registration.json'));
const rReport = await json(join(r, 'divergence-report.json'));
const jsonBytes = await readFile(resolve(jsonArg)), webmBytes = await readFile(resolve(webmArg));
same(hash(jsonBytes), qReport.provenance.jsonSha256, 'Capture JSON SHA mismatch.');
same(hash(webmBytes), qReport.provenance.webmSha256, 'WebM SHA mismatch.');
same(webmBytes.length, qReport.provenance.byteLength, 'WebM byteLength mismatch.');
const runs = [];
for (const run of qReport.provenance.rawRunHashes) {
  const bytes = await readFile(join(q, run.filename)); same(hash(bytes), run.sha256, 'Raw run SHA mismatch.'); runs.push(JSON.parse(bytes));
}
const sourcePaths = ['scripts/recovery-policy.mjs', 'src/holdout/recoveryShadowFactory.ts', 'src/holdout/recoverySynthetic.ts', 'src/holdout/recoveryPolicyAnalysis.ts'];
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async (p) => [p, hash(await readFile(join(root, p)))])));
const server = await createServer({ root, configFile: false, logLevel: 'error' });
try {
  const { readReplaySession } = await server.ssrLoadModule('/src/replay/readReplaySession.ts');
  const session = readReplaySession(jsonBytes.toString('utf8'));
  const { recoveryImplementationProof } = await server.ssrLoadModule('/src/holdout/recoveryShadowFactory.ts');
  const proof = recoveryImplementationProof(); same(proof.sourceSha256, registration.productionSha256, 'Production hash mismatch.');
  same(Object.fromEntries(Object.keys(registration.config).map((k) => [k, proof.config[k]])), registration.config, 'Fixed detector config mismatch.');
  // Seal implementation before evaluating capture policies. A retry requires identical source.
  const lock = { sourceHashes, proof, registrationSha256: hash(await readFile(join(output, 'registration.json'))) };
  try { same(await json(join(output, 'implementation-lock.json')), lock, 'STEP4S implementation changed after lock.'); }
  catch (error) { if (error.code === 'ENOENT') await write('implementation-lock.json', lock); else throw error; }

  const { createV2HoldoutReport } = await server.ssrLoadModule('/src/holdout/v2HoldoutAnalysis.ts');
  const { createLiveDivergenceReport } = await server.ssrLoadModule('/src/holdout/liveDivergenceAnalysis.ts');
  const { provenance: _qp, ...qOriginal } = qReport, { provenance: _rp, ...rOriginal } = rReport;
  same(await createV2HoldoutReport(session, runs, qRegistration.plan, qReport.createdAt), qOriginal, 'STEP4Q report changed.');
  same(createLiveDivergenceReport(session, runs), rOriginal, 'STEP4R report changed.');
  const { createRecoveryPolicyReport } = await server.ssrLoadModule('/src/holdout/recoveryPolicyAnalysis.ts');
  const video = runs.find((v) => v.variant === 'FULL_VIDEO_CONTROL');
  const report = createRecoveryPolicyReport(session, video.frames);
  same(report, createRecoveryPolicyReport(session, video.frames), 'STEP4S report is non-deterministic.');
  for (const [stream, id] of [['live', 'LIVE_A'], ['video', 'VIDEO_A']]) {
    const actual = report.policies[0][stream], previous = rReport.counterfactuals.find((c) => c.id === id);
    same(actual.counts, previous.counts, `CONTROL ${stream} counts differ from STEP4R.`);
    same(actual.events, previous.events, `CONTROL ${stream} events differ from STEP4R.`);
    same(actual.finalState, previous.finalState, `CONTROL ${stream} final state differs from STEP4R.`);
  }
  await verifyPreservation();
  const provenance = { head: registration.head, capture: qRegistration.identity,
    rawRunHashes: qReport.provenance.rawRunHashes, step4qReportSha256: hash(await readFile(join(q, 'holdout-report.json'))),
    step4rReportSha256: hash(await readFile(join(r, 'divergence-report.json'))),
    priorReportsReproduced: true, existingFilesUnchanged: true, deterministic: true, sourceHashes, registrationSha256: lock.registrationSha256,
    noNewCapture: true, noInference: true, noThresholdChange: true, noProductionChange: true };
  await write('recovery-report.json', { ...report, provenance });
  const compactStream = ({ trace: _trace, transitions, ...stream }) => ({ ...stream,
    transitions: transitions.filter((t) => t.trialWindow).map((t) => ({ timestamp: t.timestamp, stageIndex: t.stageIndex, expected: t.expected,
      stateBefore: t.stateBefore, state: t.state, leftTrackingState: t.leftTrackingState, rightTrackingState: t.rightTrackingState,
      leftY: t.normalizedYLeft, rightY: t.normalizedYRight, leftEnterMs: t.leftEnterRunMs, rightEnterMs: t.rightEnterRunMs,
      leftClearMs: t.leftClearRunMs, rightClearMs: t.rightClearRunMs, returnMs: t.returnRunMs, event: t.event })) });
  await write('recovery-summary.json', { ...report, policies: report.policies.map(({ live, video, synthetic, ...row }) => ({ ...row,
    live: compactStream(live), video: compactStream(video), synthetic: { ...synthetic, cases: synthetic.cases.map(({ trace: _trace, ...c }) => c) } })), provenance });
  console.log(JSON.stringify({ status: report.status, policies: report.policies.map((p) => ({ policy: p.policy,
    LIVE: p.live.counts, FULL_VIDEO: p.video.counts, syntheticFailed: p.synthetic.cases.filter((s) => s.status === 'FAIL').map((s) => s.id),
    livePreserved: p.liveSuccessPreserved, leftRecovered: p.videoLeftRecovered, falseEliminated: p.videoFalseEliminated, status: p.status })) }, null, 2));
} finally { await server.close(); }
