import { memo, useEffect, useRef, useState } from 'react';
import { prepareTwistInputs, TWIST_ROLES, type TwistRole, type TwistInput, type TwistFixture } from '../discovery/twistConfusionFeatures';
import { createTwistConfusionEvidence, analyzeTwistStrategy, createTwistReport, twistTracesCsv,
  type TwistEvidence, type TwistReport, type TwistStrategyResult } from '../discovery/analyzeTwistConfusion';
import { twistGuardConfigs } from '../discovery/twistEntryGuard';
import { readReplaySession } from '../replay/readReplaySession';
import { useLocalDownload } from '../replay/useLocalDownload';

const n = (v: number | null) => v === null ? '-' : v.toFixed(3);
const FEATURES = ['absNormalizedHipDepthDifference', 'hipMotionScore', 'ySymmetryRatio', 'yDominanceAbs', 'flexSymmetryRatio', 'flexDominanceAbs'] as const;
export const TwistConfusionAnalysis = memo(function TwistConfusionAnalysis() {
  const loaded = useRef<TwistInput[]>([]), prepared = useRef<TwistFixture[]>([]), generation = useRef(0), inputRef = useRef<HTMLInputElement>(null);
  const [inputs, setInputs] = useState<{ filename: string; captureId: string; role: TwistRole }[]>([]);
  const [evidence, setEvidence] = useState<TwistEvidence | null>(null), [report, setReport] = useState<TwistReport | null>(null);
  const [progress, setProgress] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null), { download, clear } = useLocalDownload();
  useEffect(() => () => { generation.current++; loaded.current = []; prepared.current = []; }, []);
  function invalidate() { generation.current++; clear(); prepared.current = []; setEvidence(null); setReport(null); setSelected(null); setError(null); setProgress(null); }
  async function load(files: File[]) {
    invalidate(); loaded.current = []; setInputs([]); const job = generation.current; setProgress('Reading STEP4L captures…');
    try {
      const result: TwistInput[] = [];
      for (const file of files) { const text = await file.text(); if (job !== generation.current) return;
        result.push({ filename: file.name, role: 'UNASSIGNED', session: readReplaySession(text) }); }
      loaded.current = result; setInputs(result.map((i) => ({ filename: i.filename, captureId: i.session.captureId, role: i.role })));
    } catch (cause) { if (job === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (job === generation.current) setProgress(null); }
  }
  async function inspect() {
    invalidate(); const job = generation.current; setProgress('Measuring STEP4L distributions / exact traces after LIVE parity…');
    try {
      await new Promise<void>((r) => window.setTimeout(r, 0)); if (job !== generation.current) return;
      const fixtures = prepareTwistInputs(loaded.current), result = createTwistConfusionEvidence(fixtures);
      if (job === generation.current) { prepared.current = fixtures; setEvidence(result); }
    } catch (cause) { if (job === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (job === generation.current) setProgress(null); }
  }
  async function compare() {
    if (!evidence) return;
    generation.current++; clear(); setReport(null); setSelected(null); setError(null);
    const job = generation.current; setProgress('Comparing STEP4L entry-only guards…');
    try {
      const results: TwistStrategyResult[] = [], configs = twistGuardConfigs();
      for (let i = 0; i < configs.length; i++) {
        if (i % 4 === 0) { await new Promise<void>((r) => window.setTimeout(r, 0)); if (job !== generation.current) return;
          setProgress(`${i} / ${configs.length} exploratory entry guards`); }
        results.push(analyzeTwistStrategy(prepared.current, evidence, configs[i]));
      }
      if (job === generation.current) setReport(createTwistReport(evidence, results));
    } catch (cause) { if (job === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (job === generation.current) setProgress(null); }
  }
  const detail = report?.strategyResults.find((s) => s.id === selected);
  return <section aria-labelledby="twist-confusion-title">
    <h3 id="twist-confusion-title">STEP 4L — Twist / Knee-Kick Confusion Analysis</h3>
    <p>POST_FAILURE_EXPLORATORY · LIVE3를 새 규칙 탐색에 사용하므로 independent holdout이 아닙니다. 먼저 분포/trace를 확인하고 별도 버튼으로 탐색합니다. Production 적용/자동 BEST 없음.</p>
    <p>Hip depth는 기존 world hip Z 차이입니다. 방향을 임의 매핑하지 않습니다. Velocity12, Y .40/50ms, 고정 flexion15°/67ms는 그대로입니다.</p>
    <label>Twist Confusion Replay JSON <input ref={inputRef} type="file" accept=".json,application/json" multiple onChange={(e) => void load(Array.from(e.target.files ?? []))} /></label>
    {inputs.map((item, index) => <p key={`${item.captureId}/${index}`}>{item.filename} · {item.captureId}{' '}
      <label>Twist role for {item.filename} <select value={item.role} onChange={(e) => {
        invalidate(); const role = e.target.value as TwistRole;
        loaded.current = loaded.current.map((i, j) => j === index ? { ...i, role } : i);
        setInputs((prev) => prev.map((i, j) => j === index ? { ...i, role } : i));
      }}>{TWIST_ROLES.map((role) => <option key={role}>{role}</option>)}</select></label></p>)}
    <p>파일명으로 역할을 추정하지 않습니다. 다섯 역할이 모두 있어야 EXPLORATORY_VIABLE 판정이 가능합니다. 기존 HOLDOUT 역할을 선택해도 이 report에서는 HOLDOUT_FAILURE로 표시합니다.</p>
    <button disabled={!inputs.length || inputs.some((i) => i.role === 'UNASSIGNED') || progress !== null} onClick={() => void inspect()}>Analyze Twist/Kick Confusion</button>{' '}
    <button disabled={!evidence || progress !== null} onClick={() => void compare()}>Compare Twist Entry Guards</button>{' '}
    <button disabled={progress === null} onClick={invalidate}>Cancel Twist Analysis</button>{' '}
    <button onClick={() => { invalidate(); loaded.current = []; setInputs([]); if (inputRef.current) inputRef.current.value = ''; }}>Reset Twist Analysis</button>{' '}
    <button disabled={!evidence || progress !== null} onClick={() => { if (evidence) download(new Blob([JSON.stringify(report ?? evidence, null, 2)], { type: 'application/json' }), `plank-stork-step-4l-${report ? 'results' : 'evidence'}.json`); }}>Download Twist JSON</button>{' '}
    <button disabled={!evidence || progress !== null} onClick={() => { if (evidence) download(new Blob([twistTracesCsv(evidence)], { type: 'text/csv;charset=utf-8' }), 'plank-stork-step-4l-traces.csv'); }}>Download Twist Traces CSV</button>
    {progress && <p role="status">{progress}</p>}{error && <p role="alert">{error}</p>}
    {evidence && <>
      <details><summary>Reference matrix · Y / Y+12 / fixed Y+flexion+12</summary><pre>{JSON.stringify(evidence.references.map((r) => ({ input: r.input,
        modes: [r.yOnly, r.yIntegrity12, r.fixedFlexionIntegrity12].map((m) => ({ mode: m === r.yOnly ? 'Y_ONLY' : m === r.yIntegrity12 ? 'Y_INTEGRITY12' : 'FIXED_FLEXION_INTEGRITY12',
          left: m.left, right: m.right, falseEvents: m.falseEvents, wrong: m.wrong, duplicates: m.duplicates, events: m.events })) })), null, 2)}</pre></details>
      {evidence.twistConfusionEvidence.perFixture.map((f) => <details key={`${f.input.captureId}/${f.input.trialId}`}>
        <summary>{f.input.filename} / trial {f.input.trialId} · {f.input.role} · POST_FAILURE_EXPLORATORY</summary>
        <p>Neutral {f.baseline.source} · {n(f.baseline.startMs)}–{n(f.baseline.endMs)}ms · parity {f.liveReplayParity.required ? f.liveReplayParity.matched ? 'MATCH' : 'MISMATCH' : 'LEGACY COMPATIBILITY'}</p>
        <div className="signal-table-scroll"><table className="visibility-table"><caption>Stage distributions · usable / coverage / min / p05 / median / p95 / max</caption>
          <thead><tr><th>Stage</th><th>Feature</th><th>Values</th></tr></thead><tbody>{f.perStage.flatMap((s) => FEATURES.map((feature) => {
            const d = s.features[feature]; return <tr key={`${s.stageIndex}/${feature}`}><th>{s.stageIndex} {s.expected}{s.calibrationOnly ? ' CALIBRATION EXCLUDED' : ''}</th><td>{feature}</td>
              <td>{d.usable} / {[d.coverage, d.min, d.p05, d.median, d.p95, d.max].map(n).join(' / ')}</td></tr>;
          }))}</tbody></table></div>
        {f.eventTraces.map((t, i) => <details key={i}><summary>{t.kind} {t.mode} {t.side} · entry {n(t.candidateStart)} → confirm {n(t.kickConfirm)}ms</summary>
          <pre>{JSON.stringify({ temporalPeaks: t.temporalPeaks, entry: t.rows.find((r) => r.timestamp === t.candidateStart), confirm: t.rows.find((r) => r.timestamp === t.kickConfirm) }, null, 2)}</pre>
        </details>)}
      </details>)}
    </>}
    {report && <>
      <p>{report.strategyResults.length} exploratory configs · EXPLORATORY_VIABLE: {report.exploratoryViableConfigs.length} · production ready 판정이 아닙니다.</p>
      <div className="signal-table-scroll"><table className="visibility-table"><caption>Exploratory entry suppression</caption><thead><tr>
        {['Guard', 'False removed/added', 'True preserved/lost', 'Wrong/duplicates', 'Activations kick/twist', 'Assessment', 'Details'].map((s) => <th key={s}>{s}</th>)}
      </tr></thead><tbody>{report.strategyResults.map((s) => <tr key={s.id}><th>{s.id}</th><td>{s.falseRemoved}/{s.falseAdded}</td><td>{s.trueEventsPreserved}/{s.trueEventsLost}</td>
        <td>{s.wrong}/{s.duplicates}</td><td>{s.guardActivationsDuringTrueKick}/{s.guardActivationsDuringTwist}</td><td>{s.assessment}</td><td><button onClick={() => setSelected(s.id)}>Inspect twist {s.id}</button></td></tr>)}</tbody></table></div>
      {detail && <details open><summary>Per-fixture entry observations / losses / events</summary><pre>{JSON.stringify(detail, null, 2)}</pre></details>}
    </>}
  </section>;
});
