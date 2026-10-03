import { useEffect, useRef, useState } from 'react';
import { analyzeReacquisitionConfig, createReacquisitionReport, reacquisitionConfigs, type ReacquisitionConfigResult, type ReacquisitionReport } from '../discovery/analyzeReacquisition';
import type { PreparedTemporalDataset, TemporalDiscoveryReport } from '../discovery/analyzeTemporal';
import { falseReacquisitionTraces, type FalseReacquisitionTrace } from '../discovery/reacquisitionTrace';
import { useLocalDownload } from '../replay/useLocalDownload';

const number = (v: number | null) => v === null ? '-' : v.toFixed(1);
const CONFIG_COUNT = reacquisitionConfigs().length;
export function ReacquisitionAnalysis({ temporal, getPrepared }: { temporal: TemporalDiscoveryReport | null; getPrepared: () => readonly PreparedTemporalDataset[] }) {
  const [report, setReport] = useState<ReacquisitionReport | null>(null), [traces, setTraces] = useState<FalseReacquisitionTrace[] | null>(null);
  const [progress, setProgress] = useState<number | null>(null), [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0), [viableOnly, setViableOnly] = useState(false), [selected, setSelected] = useState<string | null>(null);
  const generation = useRef(0), { download, clear } = useLocalDownload();
  useEffect(() => () => { generation.current++; }, []);
  async function run() {
    if (!temporal) return;
    const job = ++generation.current, prepared = getPrepared();
    setReport(null); setTraces(null); setProgress(0); setError(null); setPage(0); setSelected(null); clear();
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (job !== generation.current) return;
      const trace = falseReacquisitionTraces(prepared, temporal.perDataset);
      setTraces(trace); // Ungated exact trace is available before the sweep finishes.
      const configs = reacquisitionConfigs(), results: ReacquisitionConfigResult[] = [];
      for (let i = 0; i < configs.length; i++) {
        if (i % 8 === 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
          if (job !== generation.current) return;
          setProgress(i);
        }
        results.push(analyzeReacquisitionConfig(prepared, temporal.perDataset, configs[i]));
      }
      if (job === generation.current) setReport(createReacquisitionReport(temporal.perDataset, trace, results));
    } catch (cause) { if (job === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (job === generation.current) setProgress(null); }
  }
  const rows = report?.perConfig.filter((r) => !viableOnly || r.assessment === 'VIABLE') ?? [];
  const detail = report?.perConfig.find((r) => r.id === selected);
  return <section aria-labelledby="reacquisition-title">
    <h3 id="reacquisition-title">STEP 4G.3 — Reacquisition Analysis</h3>
    <p>위 Dataset roles를 공유합니다. ENTER 0.4 / dwell 50ms, EXIT 0.2 / return 180ms를 고정하고 두 방향 전략에서 {CONFIG_COUNT}개 조합을 비교합니다.
      해당 side 입력만 일시적으로 비활성화합니다. Timeline은 계속되며 tracking 중 놓친 동작은 MISS일 수 있습니다.</p>
    {temporal && !temporal.inputs.some((d) => d.role === 'CLEAN') && <p role="alert">No CLEAN dataset selected</p>}
    {temporal && !temporal.inputs.some((d) => d.role === 'STRESS') && <p role="alert">No STRESS dataset selected</p>}
    <div className="pose-controls">
      <button type="button" disabled={!temporal || progress !== null} onClick={() => { void run(); }}>Run Reacquisition Analysis</button>
      <button type="button" disabled={progress === null} onClick={() => { generation.current++; setProgress(null); }}>Cancel Reacquisition Analysis</button>
      <button type="button" disabled={!report || progress !== null} onClick={() => {
        if (report) download(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `plank-stork-reacquisition-${report.createdAt.replace(/[:.]/g, '-')}.json`);
      }}>Download Reacquisition Analysis JSON</button>
    </div>
    {progress !== null && <p role="status">Reacquisition: {progress} / {CONFIG_COUNT} configs</p>}
    {error && <p role="alert">{error}</p>}
    {traces && <section>
      <h4>False reacquisition trace — ungated reference</h4>
      {!traces.length && <p>선택한 STRESS에서 재추적과 연결된 false event가 없습니다.</p>}
      {traces.map((trace, i) => <details key={i}>
        <summary>{trace.input.filename} · {trace.directionStrategy} · {trace.side} · gap {number(trace.gapDurationMs)}ms · trigger +{number(trace.reacquireToTriggerMs)}ms</summary>
        <p>Median은 누적 구간과 checkpoint 직전 50ms를 구분합니다. 누락된 관측은 null이며 0으로 채우지 않습니다.
          NO_CLEAR_OBSERVED는 해당 stage 끝까지 clear 관측이 없다는 뜻입니다.</p>
        <pre>{JSON.stringify(trace, null, 2)}</pre>
      </details>)}
    </section>}
    {report && <>
      <p>{report.viableReacquisitionConfigs.length} viableReacquisitionConfigs / {report.perConfig.length} · 자동 BEST 선택 없음</p>
      <label><input type="checkbox" checked={viableOnly} onChange={(e) => { setViableOnly(e.target.checked); setPage(0); }} />Viable 조합만 표시</label>
      <div className="pose-controls">
        <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous configurations</button>
        <span>{rows.length ? page * 50 + 1 : 0}–{Math.min(rows.length, (page + 1) * 50)} / {rows.length}</span>
        <button type="button" disabled={(page + 1) * 50 >= rows.length} onClick={() => setPage(page + 1)}>Next configurations</button>
      </div>
      <div className="signal-table-scroll"><table className="visibility-table signal-table"><caption>Reacquisition gate sweep</caption>
        <thead><tr>{['Loss Min', 'Strategy', 'Settle', 'Clear Threshold', 'Clear Dwell', 'Direction', 'Clean L', 'Clean R', 'Clean False', 'Clean Wrong / Dup', 'Stress Reacq False', 'Cross Gap', 'Final C / S', 'Eligibility latency C / S (median ms)', 'Complexity', 'Assessment', 'Details'].map((s) => <th key={s}>{s}</th>)}</tr></thead>
        <tbody>{rows.slice(page * 50, (page + 1) * 50).map((r) => <tr key={r.id}>
          <td>{r.lossMinMs}</td><th>{r.strategy}</th><td>{r.settleMs}</td><td>{r.clearThreshold ?? '-'}</td><td>{r.clearDwellMs}</td><td>{r.directionStrategy}</td>
          <td>{r.clean.leftDetected}</td><td>{r.clean.rightDetected}</td><td>{r.clean.falseEvents}</td><td>{r.clean.wrongDirection} / {r.clean.duplicates}</td>
          <td>{r.stress.reacquisitionFalseEvents}</td><td>{r.stress.crossGapConfirmations}</td><td>{r.clean.finalStates.map((s) => s.state).join(', ')} / {r.stress.finalStates.map((s) => s.state).join(', ')}</td>
          <td>{number(r.clean.addedEligibilityLatencyMs.median)} / {number(r.stress.addedEligibilityLatencyMs.median)}<br />Unresolved C/S: {r.clean.addedEligibilityLatencyMs.unresolvedCount}/{r.stress.addedEligibilityLatencyMs.unresolvedCount}</td>
          <td>{r.strategyComplexity}</td><td>{r.assessment}</td><td><button type="button" onClick={() => setSelected(r.id)}>Inspect gate {r.id}</button></td>
        </tr>)}</tbody>
      </table></div>
      <p>Latency는 실제 READY에 도달한 episode만 집계합니다. Unresolved는 재손실/종료로 관측이 끝난 값이며 0ms가 아닙니다.</p>
      {detail && <details open><summary>Gate events / continuity / cancellations / stage outcomes — {detail.id}</summary><pre>{JSON.stringify(detail, null, 2)}</pre></details>}
    </>}
  </section>;
}
