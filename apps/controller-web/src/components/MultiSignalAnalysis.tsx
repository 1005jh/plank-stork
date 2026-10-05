import { useEffect, useRef, useState } from 'react';
import { analyzeMultiConfig, assertYReferenceParity, createMultiReport, prepareMultiInputs, type MultiInput, type MultiReport, type MultiConfigResult } from '../discovery/analyzeMultiSignal';
import { MULTI_ROLES, type MultiRole } from '../discovery/multiSignalFeatures';
import { multiConfigs } from '../discovery/multiSignalShadow';
import { readReplaySession } from '../replay/readReplaySession';
import { useLocalDownload } from '../replay/useLocalDownload';

const num = (value: number | null) => value === null ? '-' : value.toFixed(3);
const total = multiConfigs().length;
export function MultiSignalAnalysis() {
  const loaded = useRef<MultiInput[]>([]), generation = useRef(0), input = useRef<HTMLInputElement>(null);
  const [inputs, setInputs] = useState<{ filename: string; captureId: string; role: MultiRole }[]>([]);
  const [report, setReport] = useState<MultiReport | null>(null), [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null), [page, setPage] = useState(0), [viableOnly, setViableOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null), { download, clear } = useLocalDownload();
  useEffect(() => () => { generation.current++; loaded.current = []; }, []);
  function invalidate() { generation.current++; clear(); setReport(null); setError(null); setProgress(null); setPage(0); setSelected(null); }
  async function load(files: File[]) {
    invalidate(); loaded.current = []; setInputs([]);
    const job = generation.current; setProgress('Reading saved captures…');
    try {
      const result: MultiInput[] = [];
      for (const file of files) {
        const json = await file.text(); if (job !== generation.current) return;
        result.push({ filename: file.name, role: 'UNASSIGNED', session: readReplaySession(json) });
      }
      loaded.current = result;
      setInputs(result.map((r) => ({ filename: r.filename, captureId: r.session.captureId, role: r.role })));
    } catch (cause) { if (job === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (job === generation.current) setProgress(null); }
  }
  async function run() {
    invalidate(); const job = generation.current; setProgress('LIVE V3 / latest calibration parity 먼저 확인…');
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); if (job !== generation.current) return;
      const fixtures = prepareMultiInputs(loaded.current); assertYReferenceParity(fixtures);
      const results: MultiConfigResult[] = [], configs = multiConfigs();
      for (let i = 0; i < configs.length; i++) {
        if (i % 8 === 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); if (job !== generation.current) return;
          setProgress(`${i} / ${total} configs`);
        }
        results.push(analyzeMultiConfig(fixtures, configs[i]));
      }
      if (job === generation.current) setReport(createMultiReport(fixtures, results));
    } catch (cause) { if (job === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (job === generation.current) setProgress(null); }
  }
  const rows = report?.strategies.filter((r) => !viableOnly || r.assessment === 'VIABLE') ?? [];
  const detail = report?.strategies.find((r) => r.id === selected);
  return <section aria-labelledby="multi-signal-title">
    <h3 id="multi-signal-title">STEP 4J — Multi-Signal Kick Evidence Validation</h3>
    <p>Analysis only · 저장된 JSON만 사용합니다. Y 0.40/50ms는 고정합니다. X control과 Y+flexion 후보를 비교하며 production rule/BEST를 선택하지 않습니다.</p>
    <label>Multi-signal Replay JSON <input ref={input} type="file" accept=".json,application/json" multiple onChange={(e) => void load(Array.from(e.target.files ?? []))} /></label>
    {inputs.map((item, i) => <p key={`${item.captureId}-${i}`}>
      {item.filename} · {item.captureId}{' '}
      <label>Role for {item.filename} <select value={item.role} onChange={(e) => {
        invalidate(); const role = e.target.value as MultiRole;
        loaded.current = loaded.current.map((entry, index) => index === i ? { ...entry, role } : entry);
        setInputs(inputs.map((entry, index) => index === i ? { ...entry, role } : entry));
      }}>{MULTI_ROLES.map((role) => <option key={role}>{role}</option>)}</select></label>
    </p>)}
    <p>Role은 직접 지정하세요. 두 REFERENCE role과 STRESS가 모두 필요하며 각 role에 여러 capture를 넣을 수 있습니다. 최신 실제 calibration을 사용하고, setup이 없는 첫 Neutral 재구성 구간은 평가에서 제외합니다.</p>
    <button disabled={!inputs.length || inputs.some((i) => i.role === 'UNASSIGNED') || progress !== null} onClick={() => void run()}>Run Multi-Signal Analysis</button>{' '}
    <button disabled={progress === null} onClick={invalidate}>Cancel Multi-Signal Analysis</button>{' '}
    <button onClick={() => { invalidate(); loaded.current = []; setInputs([]); if (input.current) input.current.value = ''; }}>Reset Multi-Signal Analysis</button>{' '}
    <button disabled={!report || progress !== null} onClick={() => {
      if (report) download(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `plank-stork-step-4j-${report.createdAt.replace(/[:.]/g, '-')}.json`);
    }}>Download Multi-Signal JSON</button>
    {progress && <p role="status">{progress}</p>}{error && <p role="alert">{error}</p>}
    {report && <>
      <p>{report.viableConfigs.length} viableConfigs / {report.strategies.length} · 자동 BEST 없음</p>
      <details><summary>LIVE replay / latest calibration parity</summary><pre>{JSON.stringify(report.liveReplayParity, null, 2)}</pre></details>
      {report.perFixture.map((f) => <details key={`${f.input.captureId}/${f.input.trialId}`}>
        <summary>{f.input.filename} / trial {f.input.trialId} · {f.input.role} · baseline {f.baseline.source}</summary>
        <p>Calibration start {num(f.baseline.calibrationStartMs)}ms · window {num(f.baseline.startMs)}–{num(f.baseline.endMs)}ms · angle usable L/R {f.baseline.LEFT.usableFrames}/{f.baseline.RIGHT.usableFrames}</p>
        <table className="visibility-table"><caption>Flexion signal by stage / limb</caption>
          <thead><tr>{['Stage', 'Side', 'Coverage', 'Ankle coverage', 'Neutral angle', 'Peak flexion ↑', 'Longest above ms (8/10/12/15/20°)'].map((v) => <th key={v}>{v}</th>)}</tr></thead>
          <tbody>{f.stageSignals.map((s) => <tr key={`${s.stageIndex}/${s.side}`}><th>{s.stageIndex} {s.expected}{s.calibrationOnly ? ' (excluded)' : ''}</th><td>{s.side}</td>
            <td>{num(s.FLEXION.coverage)}</td><td>{num(s.ankleCoverage)}</td><td>{num(s.neutralAngle)}</td><td>{num(s.FLEXION.peak)}</td><td>{s.FLEXION.thresholds.map((t) => num(t.longestAboveMs)).join(' / ')}</td></tr>)}</tbody>
        </table>
      </details>)}
      <label><input type="checkbox" checked={viableOnly} onChange={(e) => { setViableOnly(e.target.checked); setPage(0); }} />Viable multi-signal configs only</label>
      <p><button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous multi-signal configs</button>{' '}{page * 50 + 1}–{Math.min(rows.length, (page + 1) * 50)} / {rows.length}{' '}
        <button disabled={(page + 1) * 50 >= rows.length} onClick={() => setPage(page + 1)}>Next multi-signal configs</button></p>
      <div className="signal-table-scroll"><table className="visibility-table"><caption>Multi-signal strategy sweep</caption>
        <thead><tr>{['Strategy', 'Enter / dwell', 'Return policy / clear', 'Old Clean L/R', 'Live L/R', 'Stress false', 'Stress cross-gap', 'Wrong / Duplicate', 'Trigger source L/R', 'Final state', 'Assessment', 'Details'].map((v) => <th key={v}>{v}</th>)}</tr></thead>
        <tbody>{rows.slice(page * 50, (page + 1) * 50).map((r) => {
          const c = r.config, forRole = (role: MultiRole) => r.perFixture.filter((f) => f.input.role === role);
          const lr = (role: MultiRole) => forRole(role).map((f) => `${f.left}/${f.right}`).join(', ') || '-';
          return <tr key={r.id}><th>{r.strategy}</th><td>Y .40/50 · {r.strategy === 'Y_OR_FLEXION' ? `F ${c.flexEnter}°/${c.flexDwellMs}` : r.strategy !== 'Y_ONLY' ? `X ${c.xEnter}/${c.xDwellMs}` : '-'}</td>
            <td>{c.returnPolicy} · Y .25/100 · {r.strategy === 'Y_OR_FLEXION' ? `F ${c.flexClear}°/${c.flexClearDwellMs}` : '-'}</td>
            <td>{lr('REFERENCE_OLD_CLEAN')}</td><td>{lr('REFERENCE_LIVE')}</td><td>{forRole('STRESS').map((f) => `${f.observableFalseEvents} observable / ${f.falseEvents} total`).join(', ')}</td>
            <td>{forRole('STRESS').reduce((n, f) => n + f.crossGap, 0)}</td><td>{r.perFixture.reduce((n, f) => n + f.wrong, 0)} / {r.perFixture.reduce((n, f) => n + f.duplicates, 0)}</td>
            <td>{r.perFixture.map((f) => `${f.input.role}: ${f.events.map((e) => `${e.side}:${e.triggerSource}`).join(',') || '-'}`).join(' · ')}</td>
            <td>{r.perFixture.map((f) => f.finalState).join(' / ')}</td><td>{r.assessment}</td><td><button onClick={() => setSelected(r.id)}>Inspect {r.id}</button></td></tr>;
        })}</tbody>
      </table></div>
      {detail && <details open><summary>Multi-signal events / stage outcomes / channel loss episodes</summary><pre>{JSON.stringify(detail, null, 2)}</pre></details>}
    </>}
  </section>;
}
