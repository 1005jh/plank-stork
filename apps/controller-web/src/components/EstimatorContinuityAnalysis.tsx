import { memo, useEffect, useRef, useState } from 'react';
import { readReplaySession } from '../replay/readReplaySession';
import { useLocalDownload } from '../replay/useLocalDownload';
import type { BodyInput, BodyRole } from '../discovery/bodyLocalFeatures';
import { ESTIMATOR_VARIANTS, type EstimatorVariant } from '../estimator/estimatorConfig';
import { decodeEstimatorFrames, runEstimator, validateEstimatorMedia, type FramePlan, type EstimatorRun } from '../estimator/estimatorInference';
import { ESTIMATOR_ROLES, estimatorAnchors, analyzeEstimator, compareEstimators, type EstimatorAnchors, type EstimatorAnalysis } from '../estimator/estimatorAnalysis';

import { compareEstimatorRepetition } from '../estimator/estimatorRepeatability';

interface Input extends BodyInput { video: File | null }
interface JobData { anchors: EstimatorAnchors; plan?: FramePlan; runs: Partial<Record<EstimatorVariant, EstimatorRun>> }
export const EstimatorContinuityAnalysis = memo(function EstimatorContinuityAnalysis() {
  const loaded = useRef<Input[]>([]), jobs = useRef(new Map<string, JobData>()), abort = useRef<AbortController | null>(null);
  const [inputs, setInputs] = useState<Input[]>([]), [validated, setValidated] = useState(false), [decoded, setDecoded] = useState(false);
  const [results, setResults] = useState<(EstimatorAnalysis & { repeatability?: ReturnType<typeof compareEstimatorRepetition> })[]>([]), [report, setReport] = useState<ReturnType<typeof compareEstimators> | null>(null);
  const [progress, setProgress] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const { download, clear } = useLocalDownload();
  useEffect(() => () => { abort.current?.abort(); abort.current = null; jobs.current.clear(); loaded.current = []; }, []);
  function cancel() { abort.current?.abort(); abort.current = null; setProgress(null); }
  function invalidate() { cancel(); clear(); jobs.current.clear(); setValidated(false); setDecoded(false); setResults([]); setReport(null); setError(null); }
  function update(next: Input[]) { invalidate(); loaded.current = next; setInputs(next); }
  async function task(label: string, operation: (signal: AbortSignal, show: (message: string) => void) => Promise<void>) {
    cancel(); const controller = new AbortController(); abort.current = controller; setError(null); setProgress(label);
    const show = (message: string) => { if (!controller.signal.aborted) setProgress(message); };
    try { await operation(controller.signal, show); }
    catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (abort.current === controller) { abort.current = null; setProgress(null); } }
  }
  async function load(files: File[]) {
    update([]);
    await task('Reading estimator JSON…', async (signal) => {
      const next: Input[] = [];
      for (const file of files) {
        const text = await file.text(); if (signal.aborted) return;
        next.push({ filename: file.name, role: 'UNASSIGNED', session: readReplaySession(text), video: null });
      }
      if (new Set(next.map((i) => i.session.captureId)).size !== next.length) throw new Error('Duplicate capture JSON.');
      loaded.current = next; setInputs(next);
    });
  }
  function validate() {
    invalidate();
    void task('Validating media identity and original anchors…', async (signal) => {
      const roles = new Set<string>();
      for (const input of loaded.current) {
        if (input.role === 'UNASSIGNED' || !input.video) throw new Error('각 JSON의 role과 matching WebM을 직접 선택하세요.');
        if (roles.has(input.role)) throw new Error('Each role must be unique.'); roles.add(input.role);
        validateEstimatorMedia(input.session, input.video);
        const anchors = estimatorAnchors(input);
        if (!anchors.length) throw new Error('A completed Guided trial is required.');
        jobs.current.set(input.session.captureId, { anchors, runs: {} });
        await new Promise<void>((r) => setTimeout(r, 0)); if (signal.aborted) return;
      }
      setValidated(true);
    });
  }
  function decode() {
    void task('Decoding all frames…', async (signal, show) => {
      for (const input of loaded.current) {
        const plan = await decodeEstimatorFrames(input.video!, input.session, signal, (n) => show(`${input.role}: decoded ${n} frames`));
        if (signal.aborted) return;
        jobs.current.get(input.session.captureId)!.plan = plan;
      }
      setDecoded(true);
    });
  }
  function infer(variant: EstimatorVariant) {
    setReport(null);
    void task(`Running ${variant}…`, async (signal, show) => {
      for (const input of loaded.current) {
        const job = jobs.current.get(input.session.captureId)!;
        const run = await runEstimator(input.video!, input.session, variant, job.plan!, signal,
          (n) => show(`${input.role} / ${variant}: ${n}/${job.plan!.timestamps.length}`));
        if (signal.aborted) return;
        const analysis = analyzeEstimator(input, run, job.anchors);
        const previous = results.find((r) => r.variant === variant && r.input.captureId === input.session.captureId);
        const result = { ...analysis, ...(job.runs[variant] && previous ? { repeatability: compareEstimatorRepetition(job.runs[variant]!, run, previous, analysis) } : {}) };
        if (signal.aborted) return;
        job.runs[variant] = run;
        setResults((prev) => [...prev.filter((r) => r.variant !== variant || r.input.captureId !== input.session.captureId), result]);
      }
    });
  }
  const busy = progress !== null;
  const finished = (v: EstimatorVariant) => inputs.length > 0 && inputs.every((i) => results.some((r) => r.variant === v && r.input.captureId === i.session.captureId));
  return <section aria-labelledby="estimator-continuity-title">
    <h3 id="estimator-continuity-title">STEP 4O — Pose Estimator Continuity</h3>
    <p>POST_FAILURE_EXPLORATORY · 저장된 영상의 모든 PTS를 순차 처리합니다. Role은 직접 지정하며, 원래 JSON/WebM 이름과 capture ID가 맞아야 합니다. 새 촬영은 필요하지 않습니다.</p>
    <label>Estimator Replay JSON <input type="file" multiple accept=".json,application/json" onChange={(e) => void load(Array.from(e.target.files ?? []))} /></label>
    {inputs.map((i, index) => <div key={`${i.session.captureId}/${index}`}>
      <p>{i.filename} · {i.session.captureId}</p>
      <label>Estimator role for {i.filename} <select value={i.role} onChange={(e) => update(loaded.current.map((v, n) => n === index ? { ...v, role: e.target.value as BodyRole } : v))}>
        {ESTIMATOR_ROLES.map((role) => <option key={role}>{role}</option>)}
      </select></label>{' '}
      <label>Matching WebM for {i.filename} <input type="file" accept=".webm,video/webm" onChange={(e) => update(loaded.current.map((v, n) => n === index ? { ...v, video: e.target.files?.[0] ?? null } : v))} /></label>
      <p>Expected: {i.session.video.filename} · Selected: {i.video?.name ?? '-'}</p>
    </div>)}
    <button disabled={!inputs.length || busy} onClick={validate}>1. Validate Media Pair</button>{' '}
    <button disabled={!validated || busy} onClick={decode}>2. Decode Frames</button>{' '}
    {ESTIMATOR_VARIANTS.map((v, index) => <button key={v} disabled={!decoded || busy || index > 0 && !finished(ESTIMATOR_VARIANTS[index - 1])} onClick={() => infer(v)}>{index + 3}. Run {v}</button>)}{' '}
    <button disabled={busy || !ESTIMATOR_VARIANTS.every(finished)} onClick={() => setReport(compareEstimators(results))}>6. Compare Estimators</button>{' '}
    <button disabled={!busy} onClick={cancel}>Cancel Estimator Analysis</button>{' '}
    <button onClick={() => update([])}>Reset Estimator Analysis</button>{' '}
    <button disabled={!report || busy} onClick={() => { if (report) download(new Blob([JSON.stringify(report)], { type: 'application/json' }), 'plank-stork-step-4o-results.json'); }}>Download Estimator Report</button>
    {progress && <p role="status">{progress}</p>}{error && <p role="alert">{error}</p>}
    {validated && <p>Media pairs validated. {decoded ? 'Frame sequences decoded.' : 'Ready to decode.'}</p>}
    {decoded && <details><summary>Decoded sequence / SHA-256</summary><pre>{JSON.stringify(inputs.map((i) => ({ role: i.role, ...jobs.current.get(i.session.captureId)?.plan?.sequence })), null, 2)}</pre></details>}
    {results.map((r) => <details key={`${r.input.captureId}/${r.variant}`}><summary>{r.input.role} / {r.variant} · {r.sequence.decodedFrameCount} frames</summary>
      <pre>{JSON.stringify({ sequence: r.sequence, performance: { ...r.performance, inferenceDurationsMs: undefined }, repeatability: r.repeatability, trials: r.trials.map((t) => ({ trialId: t.trialId, baselineStatus: t.baselineStatus,
        production: t.detectorReplay?.PRODUCTION_Y_V3.counts, fixed: t.detectorReplay && { left: t.detectorReplay.FIXED_REFERENCE.left, right: t.detectorReplay.FIXED_REFERENCE.right, false: t.detectorReplay.FIXED_REFERENCE.falseEvents } })) }, null, 2)}</pre>
      <button disabled={busy} onClick={() => {
        const run = jobs.current.get(r.input.captureId)?.runs[r.variant];
        if (run) download(new Blob([JSON.stringify(run)], { type: 'application/json' }), `${r.input.captureId}-${r.variant}-poses.json`);
      }}>Download {r.input.role} {r.variant} raw poses</button>
    </details>)}
    {report && <><p>Attribution: {report.attribution}</p><pre>{JSON.stringify(report.perVariant, null, 2)}</pre></>}
    <p>Control은 과거 LIVE pose/event의 bit equality를 요구하지 않습니다. Neutral marker 구간과 STEP 4N geometry 공식은 동일하며 각 variant의 baseline을 재구성합니다. IMAGE/Heavy의 느린 추론도 frame을 생략하지 않습니다.</p>
  </section>;
});
