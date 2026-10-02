import { useEffect, useRef, useState } from 'react';
import { analyzeShadowConfig, createShadowReport, shadowConfigs, type ShadowConfigResult, type ShadowReport } from '../discovery/analyzeShadow';
import type { PreparedTemporalDataset, TemporalDiscoveryReport } from '../discovery/analyzeTemporal';
import { useLocalDownload } from '../replay/useLocalDownload';

export function YKickShadowPanel({ temporal, getPrepared }: { temporal: TemporalDiscoveryReport | null; getPrepared: () => readonly PreparedTemporalDataset[] }) {
  const [report, setReport] = useState<ShadowReport | null>(null), [progress, setProgress] = useState<number | null>(null);
  const [all, setAll] = useState(false), [selected, setSelected] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const generation = useRef(0), { download, clear } = useLocalDownload();
  useEffect(() => () => { generation.current++; }, []);
  async function run() {
    if (!temporal) return;
    const job = ++generation.current, prepared = getPrepared(), results: ShadowConfigResult[] = [];
    setReport(null); setSelected(null); setProgress(0); setError(null); clear();
    try {
      const configs = shadowConfigs();
      for (let index = 0; index < configs.length; index++) {
        if (index % 8 === 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
          if (job !== generation.current) return;
          setProgress(index);
        }
        results.push(analyzeShadowConfig(prepared, temporal.perDataset, configs[index]));
      }
      if (job !== generation.current) return;
      setReport(createShadowReport(temporal.perDataset, results));
    } catch (cause) {
      if (job === generation.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (job === generation.current) setProgress(null); }
  }
  const detail = report?.perConfig.find((r) => r.id === selected);
  return <section aria-labelledby="y-shadow-title">
    <h3 id="y-shadow-title">STEP 4G.2 — Y Kick Shadow</h3>
    <p>Recorded timeline 전체를 연속 처리하는 분석 전용 detector입니다. 위 Dataset roles 선택을 공유합니다.
      PRIMARY abs(Y), side별 usability · 기본 0.4 / 50ms · 2D/velocity confirmation 없음.</p>
    {temporal && <ul>{temporal.inputs.map((input, index) => <li key={index}>{input.filename} · trial {input.trialId}: {input.role}</li>)}</ul>}
    {temporal && !temporal.inputs.some((i) => i.role === 'CLEAN') && <p role="alert">No CLEAN dataset selected</p>}
    <div className="pose-controls">
      <button type="button" disabled={!temporal || progress !== null} onClick={() => { void run(); }}>Run Shadow Validation</button>
      <button type="button" disabled={progress === null} onClick={() => { generation.current++; setProgress(null); }}>Cancel Shadow Validation</button>
      <button type="button" disabled={!report || progress !== null} onClick={() => {
        if (report) download(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `plank-stork-y-kick-shadow-${report.createdAt.replace(/[:.]/g, '-')}.json`);
      }}>Download Y Kick Shadow Result JSON</button>
    </div>
    {progress !== null && <p role="status">Shadow: {progress} / 288 configs</p>}
    {error && <p role="alert">{error}</p>}
    {report && <>
      <p>{report.viableStatefulConfigs.length} viableStatefulConfigs / {report.configs.length} · 자동 선택 없음</p>
      <label><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />모든 이웃 조합 표시 (기본: Enter 0.4 / Dwell 50)</label>
      <div className="signal-table-scroll"><table className="visibility-table signal-table"><caption>Stateful sweep — return + direction strategies</caption>
        <thead><tr>{['Enter', 'Dwell', 'Exit', 'Return', 'Direction strategy', 'Clean L', 'Clean R', 'False C / S', 'Wrong C / S', 'Duplicate C / S', 'Stress cross-gap', 'Stress recovery false', 'Final state C / S', 'Assessment', 'Details'].map((s) => <th key={s}>{s}</th>)}</tr></thead>
        <tbody>{report.perConfig.filter((r) => all || (r.enter === 0.4 && r.dwellMs === 50)).map((r) => <tr key={r.id}>
          <td>{r.enter}</td><td>{r.dwellMs}</td><td>{r.exit}</td><td>{r.returnDwellMs}</td><th>{r.directionStrategy}</th>
          <td>{r.clean.correctLeft}</td><td>{r.clean.correctRight}</td><td>{r.clean.falseEvents} / {r.stress.falseEvents}</td>
          <td>{r.clean.wrongDirection} / {r.stress.wrongDirection}</td><td>{r.clean.duplicates} / {r.stress.duplicates}</td>
          <td>{r.stress.crossGapConfirmations}</td><td>{r.stress.poseLossGeneratedFalseEvents}</td>
          <td>{r.clean.finalStates.map((s) => s.state).join(', ') || '-'} / {r.stress.finalStates.map((s) => s.state).join(', ') || '-'}</td>
          <td>{r.assessment}</td><td><button type="button" onClick={() => setSelected(r.id)}>Inspect {r.id}</button></td>
        </tr>)}</tbody>
      </table></div>
      <details><summary>All viable stateful configurations</summary><pre>{JSON.stringify(report.viableStatefulConfigs, null, 2)}</pre></details>
      {detail && <section>
        <h4>{detail.id} — events / margins / return / cancellation</h4>
        {[...detail.clean.datasets, ...detail.stress.datasets, ...detail.unassigned].map((d, index) => <div key={index}>
          <h4>{d.input.filename} · trial {d.input.trialId} · {d.role}</h4>
          <p>Final: {d.finalState} · Cross-gap: {d.crossGapConfirmations} · Assessment: {d.cleanAssessment}</p>
          {d.nonKickCoverageLimited.length > 0 && <p>Non-kick coverage 제한 stage: {d.nonKickCoverageLimited.join(', ')}. False-event 수는 관측된 timeline 결과입니다.</p>}
          <div className="signal-table-scroll"><table className="visibility-table signal-table"><caption>Expected-side observability / stage result</caption>
            <thead><tr>{['Stage', 'Observable', 'Left usable', 'Right usable', 'Frames', 'Outcome', 'Correct', 'False', 'Duplicate'].map((s) => <th key={s}>{s}</th>)}</tr></thead>
            <tbody>{d.stages.map((s) => <tr key={s.stageIndex}><th>{s.stageIndex} {s.expected}</th><td>{String(s.observable)}</td><td>{s.leftUsable}</td><td>{s.rightUsable}</td><td>{s.frameCount}</td><td>{s.outcome}</td><td>{s.correct}</td><td>{s.falseEvents}</td><td>{s.duplicates}</td></tr>)}</tbody>
          </table></div>
          <details open><summary>Events / integrated margins (ratio = larger / total)</summary><pre>{JSON.stringify(d.events, null, 2)}</pre></details>
          <details><summary>Rearm timestamps / latency / next action readiness</summary><pre>{JSON.stringify({ rearmTimes: d.rearmTimes, nextActionReadiness: d.nextActionReadiness }, null, 2)}</pre></details>
          <details><summary>Candidate cancellation / state transitions</summary><pre>{JSON.stringify({ cancelledCandidates: d.cancelledCandidates, transitions: d.transitions, finalPending: d.finalPending }, null, 2)}</pre></details>
        </div>)}
      </section>}
    </>}
  </section>;
}
