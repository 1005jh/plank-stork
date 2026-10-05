import { memo, useEffect, useRef, useState } from 'react';
import { INTEGRITY_ROLES, prepareIntegrityInputs, type IntegrityInput, type IntegrityRole, type IntegrityFixture } from '../discovery/integrityFeatures';
import { createIntegrityEvidence, analyzeIntegrityConfig, createIntegrityReport, integrityTracesCsv,
  type IntegrityEvidence, type IntegrityReport, type IntegrityConfigResult } from '../discovery/analyzeIntegrity';
import { integrityConfigs } from '../discovery/integrityGuard';
import { readReplaySession } from '../replay/readReplaySession';
import { useLocalDownload } from '../replay/useLocalDownload';

const num = (v: number | null) => v === null ? '-' : v.toFixed(3);
// Saved-file analysis has no live pose props. Camera metric ticks must not re-render
// the potentially large evidence tables; its own local state still updates normally.
export const IntegrityAnalysis = memo(function IntegrityAnalysis() {
  const loaded = useRef<IntegrityInput[]>([]), prepared = useRef<IntegrityFixture[]>([]), generation = useRef(0), inputRef = useRef<HTMLInputElement>(null);
  const [inputs, setInputs] = useState<{ filename: string; captureId: string; role: IntegrityRole }[]>([]);
  const [evidence, setEvidence] = useState<IntegrityEvidence | null>(null), [report, setReport] = useState<IntegrityReport | null>(null);
  const [progress, setProgress] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null), { download, clear } = useLocalDownload();
  useEffect(() => () => { generation.current++; loaded.current = []; prepared.current = []; }, []);
  function invalidate() { generation.current++; clear(); prepared.current = []; setEvidence(null); setReport(null); setError(null); setProgress(null); setSelected(null); }
  async function load(files: File[]) {
    invalidate(); loaded.current = []; setInputs([]); const job = generation.current; setProgress('Reading integrity captures…');
    try {
      const result: IntegrityInput[] = [];
      for (const file of files) { const text = await file.text(); if (job !== generation.current) return;
        result.push({ filename: file.name, role: 'UNASSIGNED', session: readReplaySession(text) }); }
      loaded.current = result; setInputs(result.map((r) => ({ filename: r.filename, captureId: r.session.captureId, role: r.role })));
    } catch (cause) { if (job === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (job === generation.current) setProgress(null); }
  }
  async function inspect() {
    invalidate(); const job = generation.current; setProgress('Verifying LIVE parity and measuring integrity distributions…');
    try {
      await new Promise<void>((r) => window.setTimeout(r, 0)); if (job !== generation.current) return;
      const fixtures = prepareIntegrityInputs(loaded.current), result = createIntegrityEvidence(fixtures);
      if (job === generation.current) { prepared.current = fixtures; setEvidence(result); }
    } catch (cause) { if (job === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (job === generation.current) setProgress(null); }
  }
  async function run() {
    if (!evidence) return;
    generation.current++; clear(); setReport(null); setSelected(null); setError(null);
    const job = generation.current; setProgress('Running fixed integrity grid…');
    try {
      const results: IntegrityConfigResult[] = [], configs = integrityConfigs();
      for (let i = 0; i < configs.length; i++) {
        if (i % 4 === 0) {
          await new Promise<void>((r) => window.setTimeout(r, 0)); if (job !== generation.current) return;
          setProgress(`${i} / ${configs.length} integrity configs × Y / fixed flexion`);
        }
        results.push(analyzeIntegrityConfig(prepared.current, evidence, configs[i]));
      }
      if (job === generation.current) setReport(createIntegrityReport(evidence, results));
    } catch (cause) { if (job === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (job === generation.current) setProgress(null); }
  }
  const detail = report?.strategies.find((r) => r.id === selected);
  const exportJson = () => {
    if (evidence) download(new Blob([JSON.stringify(report ?? evidence, null, 2)], { type: 'application/json' }), `plank-stork-step-4k1-${report ? 'results' : 'evidence'}.json`);
  };
  return <section aria-labelledby="integrity-title">
    <h3 id="integrity-title">STEP 4K.1 — Landmark Integrity Validation</h3>
    <p>Analysis only · 저장된 네 capture의 soft discontinuity를 비교합니다. 먼저 분포/trace를 확인한 뒤 고정 grid를 실행합니다. Y .40/50ms와 flexion 15°/67ms, clear5°/150ms는 고정입니다. 자동 BEST/production 적용 없음.</p>
    <label>Integrity Replay JSON <input ref={inputRef} type="file" accept=".json,application/json" multiple onChange={(e) => void load(Array.from(e.target.files ?? []))} /></label>
    {inputs.map((item, i) => <p key={`${item.captureId}/${i}`}>{item.filename} · {item.captureId}{' '}
      <label>Integrity role for {item.filename} <select value={item.role} onChange={(e) => {
        invalidate(); const role = e.target.value as IntegrityRole;
        loaded.current = loaded.current.map((r, j) => j === i ? { ...r, role } : r);
        setInputs((prev) => prev.map((r, j) => j === i ? { ...r, role } : r));
      }}>{INTEGRITY_ROLES.map((role) => <option key={role}>{role}</option>)}</select></label></p>)}
    <p>Role은 직접 선택합니다. 모든 reference와 STRESS role이 있어야 전체 viable 판정이 가능합니다. 파일명으로 역할을 추정하지 않습니다.</p>
    <button disabled={!inputs.length || inputs.some((i) => i.role === 'UNASSIGNED') || progress !== null} onClick={() => void inspect()}>Inspect Integrity Features</button>{' '}
    <button disabled={!evidence || progress !== null} onClick={() => void run()}>Run Integrity Guard Comparison</button>{' '}
    <button disabled={progress === null} onClick={invalidate}>Cancel Integrity Analysis</button>{' '}
    <button onClick={() => { invalidate(); loaded.current = []; setInputs([]); if (inputRef.current) inputRef.current.value = ''; }}>Reset Integrity Analysis</button>{' '}
    <button disabled={!evidence || progress !== null} onClick={exportJson}>Download Integrity JSON</button>{' '}
    <button disabled={!evidence || progress !== null} onClick={() => { if (evidence) download(new Blob([integrityTracesCsv(evidence)], { type: 'text/csv;charset=utf-8' }), 'plank-stork-step-4k1-traces.csv'); }}>Download Integrity Traces CSV</button>
    {progress && <p role="status">{progress}</p>}{error && <p role="alert">{error}</p>}
    {evidence && <>
      <details><summary>Integrity LIVE parity / frozen baseline</summary><pre>{JSON.stringify(evidence.liveReplayParity, null, 2)}</pre></details>
      <p>속도는 인접한 recorded tMs의 차이로 계산합니다. Missing / dt≥400ms를 가로질러 누적하지 않습니다.</p>
      {evidence.perFixture.map((f) => <details key={`${f.input.captureId}/${f.input.trialId}`}>
        <summary>{f.input.filename} / trial {f.input.trialId} · {f.input.role} · {f.segmentBaseline.source}</summary>
        <p>Neutral window {num(f.segmentBaseline.startMs)}–{num(f.segmentBaseline.endMs)}ms · HK/KA median L {num(f.segmentBaseline.LEFT.hipKnee.median)}/{num(f.segmentBaseline.LEFT.kneeAnkle.median)} · R {num(f.segmentBaseline.RIGHT.hipKnee.median)}/{num(f.segmentBaseline.RIGHT.kneeAnkle.median)}</p>
        <div className="signal-table-scroll"><table className="visibility-table"><caption>Integrity distributions · min / p05 / median / p95 / max</caption>
          <thead><tr>{['Group', 'Side', '|Y velocity| /s', '2D velocity /s', 'Knee-ankle ratio', 'Usable Y vel / 2D / ratio'].map((s) => <th key={s}>{s}</th>)}</tr></thead>
          <tbody>{f.distributions.map((d) => {
            const values = (s: typeof d.yVelocity) => [s.min, s.p05, s.median, s.p95, s.max].map(num).join(' / ');
            return <tr key={`${d.group}/${d.side}`}><th>{d.group}</th><td>{d.side}</td><td>{values(d.absYVelocity)}</td><td>{values(d.knee2DVelocity)}</td><td>{values(d.kneeAnkleRatio)}</td><td>{d.yVelocity.usable}/{d.knee2DVelocity.usable}/{d.kneeAnkleRatio.usable}</td></tr>;
          })}</tbody></table></div>
        {f.traces.map((t, i) => <details key={i}><summary>{t.kind} {t.event.side} · entry {num(t.event.candidateStartedAt)}ms → event {num(t.event.timestamp)}ms · {t.referenceMode}</summary>
          <div className="signal-table-scroll"><table className="visibility-table"><caption>Entry ±500ms · {t.event.side}</caption>
            <thead><tr>{['tMs', 'Y', 'Y velocity', 'Relative X/Y', '2D velocity', 'HK length/ratio', 'KA length/ratio', 'Angle/velocity', 'Visibility H/K/A', 'Y tracking', 'Y/reference run ms'].map((s) => <th key={s}>{s}</th>)}</tr></thead>
            <tbody>{t.rows.map((r) => <tr key={r.timestamp}><th>{num(r.timestamp)}{r.isCandidateEntry ? ' ENTRY' : r.isConfirmation ? ' EVENT' : ''}</th><td>{num(r.deltaDyNorm)}</td><td>{num(r.deltaDyNormVelocity)}</td>
              <td>{num(r.kneeRelativeX)}/{num(r.kneeRelativeY)}</td><td>{num(r.kneeCenterRelative2DVelocity)}</td><td>{num(r.hipKneeLength)}/{num(r.hipKneeRatio)}</td><td>{num(r.kneeAnkleLength)}/{num(r.kneeAnkleRatio)}</td>
              <td>{num(r.kneeAngle)}/{num(r.kneeAngleVelocity)}</td><td>{num(r.visibility.hip)}/{num(r.visibility.knee)}/{num(r.visibility.ankle)}</td><td>{r.trackingState}</td><td>{num(r.candidateRunMs)}/{num(r.referenceCandidateRunMs)}</td></tr>)}</tbody>
          </table></div></details>)}
      </details>)}
    </>}
    {report && <>
      <p>viableIntegrityConfigs: {report.viableIntegrityConfigs.length} · fixed flexion diagnostic: {report.viableFixedFlexionDiagnosticConfigs.length} · {report.strategies.length} configs including NONE · 자동 BEST 없음</p>
      <div className="signal-table-scroll"><table className="visibility-table"><caption>Integrity guard comparison</caption><thead><tr>
        {['Guard / threshold', 'Mode', 'Old L/R', 'Live1 L/R', 'Independent L/R/false', 'Stress false', 'Wrong/dup/hard-gap/soft-gap', 'Activations / true-kick / neutral', 'False removed / true lost', 'Assessment', 'Details'].map((s) => <th key={s}>{s}</th>)}
      </tr></thead><tbody>{report.strategies.flatMap((s) => [s.yOnly, s.fixedFlexionDiagnostic].map((r) => {
        const role = (name: IntegrityRole, falseCount = false) => r.perFixture.filter((f) => f.input.role === name).map((f) => `${f.left}/${f.right}${falseCount ? `/${f.falseEvents}` : ''}`).join(', ') || '-';
        const sum = (key: 'wrong' | 'duplicates' | 'crossGap' | 'softGapCross' | 'guardActivationCount' | 'guardActivationsDuringTrueKick' | 'guardActivationsDuringNeutral') => r.perFixture.reduce((n, f) => n + f[key], 0);
        return <tr key={`${s.id}/${r.mode}`}><th>{s.id}</th><td>{r.mode}</td><td>{role('REFERENCE_OLD_CLEAN')}</td><td>{role('REFERENCE_LIVE_1')}</td><td>{role('REFERENCE_LIVE_2_INDEPENDENT', true)}</td>
          <td>{r.perFixture.filter((f) => f.input.role === 'STRESS').map((f) => `${f.observableFalseEvents}/${f.falseEvents} observable/total`).join(', ')}</td>
          <td>{sum('wrong')}/{sum('duplicates')}/{sum('crossGap')}/{sum('softGapCross')}</td><td>{sum('guardActivationCount')}/{sum('guardActivationsDuringTrueKick')}/{sum('guardActivationsDuringNeutral')}</td>
          <td>{r.perFixture.reduce((n, f) => n + f.regression.falseEventsRemoved, 0)}/{r.perFixture.reduce((n, f) => n + f.regression.trueEventsLost, 0)}</td><td>{r.assessment}</td><td><button onClick={() => setSelected(s.id)}>Inspect guard {s.id}</button></td></tr>;
      }))}</tbody></table></div>
      {detail && <details open><summary>Guard episodes / recovery latency / events</summary><pre>{JSON.stringify(detail, null, 2)}</pre></details>}
    </>}
  </section>;
});
