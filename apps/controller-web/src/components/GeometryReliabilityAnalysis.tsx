import { memo, useEffect, useRef, useState } from 'react';
import { BODY_ROLES, type BodyInput, type BodyRole } from '../discovery/bodyLocalFeatures';
import { prepareGeometryInputs, type GeometryFixture } from '../discovery/geometryReliabilityFeatures';
import { createGeometryEvidence, compareReliabilityMarkers, analyzeQualityGate, createGeometryReport, geometryTracesCsv,
  type GeometryEvidence, type GeometryMarkerReport, type GeometryReport, type QualityGateResult } from '../discovery/analyzeGeometryReliability';
import { qualityGateConfigs } from '../discovery/geometryReliabilityMarkers';
import { readReplaySession } from '../replay/readReplaySession';
import { useLocalDownload } from '../replay/useLocalDownload';

export const GeometryReliabilityAnalysis = memo(function GeometryReliabilityAnalysis() {
  const loaded = useRef<BodyInput[]>([]), prepared = useRef<GeometryFixture[]>([]), generation = useRef(0), inputRef = useRef<HTMLInputElement>(null);
  const [inputs, setInputs] = useState<{ filename: string; captureId: string; role: BodyRole }[]>([]);
  const [evidence, setEvidence] = useState<GeometryEvidence | null>(null), [markers, setMarkers] = useState<GeometryMarkerReport | null>(null), [report, setReport] = useState<GeometryReport | null>(null);
  const [progress, setProgress] = useState<string | null>(null), [error, setError] = useState<string | null>(null), [selected, setSelected] = useState<string | null>(null);
  const { download, clear } = useLocalDownload();
  useEffect(() => () => { generation.current++; loaded.current = []; prepared.current = []; }, []);
  function invalidate() { generation.current++; clear(); prepared.current = []; setEvidence(null); setMarkers(null); setReport(null); setSelected(null); setProgress(null); setError(null); }
  async function load(files: File[]) {
    invalidate(); loaded.current = []; setInputs([]); const job = generation.current; setProgress('Reading STEP4N captures…');
    try {
      const next: BodyInput[] = [];
      for (const file of files) { const text = await file.text(); if (job !== generation.current) return;
        next.push({ filename: file.name, role: 'UNASSIGNED', session: readReplaySession(text) }); }
      loaded.current = next; setInputs(next.map((i) => ({ filename: i.filename, captureId: i.session.captureId, role: i.role })));
    } catch (cause) { if (job === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (job === generation.current) setProgress(null); }
  }
  async function inspect() {
    invalidate(); const job = generation.current; setProgress('Checking parity / frozen baseline and measuring geometry distributions…');
    try {
      await new Promise<void>((r) => window.setTimeout(r, 0)); if (job !== generation.current) return;
      const fixtures = prepareGeometryInputs(loaded.current), result = createGeometryEvidence(fixtures);
      if (job === generation.current) { prepared.current = fixtures; setEvidence(result); }
    } catch (cause) { if (job === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (job === generation.current) setProgress(null); }
  }
  async function compareMarkers() {
    if (!evidence) return;
    generation.current++; clear(); const job = generation.current; setMarkers(null); setReport(null); setSelected(null); setError(null); setProgress('Comparing descriptive reliability markers…');
    try {
      await new Promise<void>((r) => window.setTimeout(r, 0)); if (job !== generation.current) return;
      const measured = compareReliabilityMarkers(prepared.current, evidence);
      if (job === generation.current) { setMarkers(measured); setReport(createGeometryReport(evidence, measured)); }
    } catch (cause) { if (job === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (job === generation.current) setProgress(null); }
  }
  async function experiment() {
    if (!evidence || !markers) return;
    generation.current++; clear(); const job = generation.current; setSelected(null); setError(null); setProgress('Running entry-only quality-gate thought experiments…');
    try {
      const results: QualityGateResult[] = [], configs = qualityGateConfigs();
      for (let i = 0; i < configs.length; i++) {
        if (i % 4 === 0) { await new Promise<void>((r) => window.setTimeout(r, 0)); if (job !== generation.current) return; setProgress(`${i}/${configs.length} STEP4N entry-only gates`); }
        results.push(analyzeQualityGate(prepared.current, evidence, markers, configs[i]));
      }
      if (job === generation.current) setReport(createGeometryReport(evidence, markers, results));
    } catch (cause) { if (job === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (job === generation.current) setProgress(null); }
  }
  const detail = report?.qualityGateExperiments.find((r) => r.config.id === selected);
  return <section aria-labelledby="geometry-reliability-title">
    <h3 id="geometry-reliability-title">STEP 4N — Pose Geometry Reliability</h3>
    <p>DIAGNOSTIC / POST_FAILURE_EXPLORATORY · World도 pose 추정값이며 절대 위치 truth가 아닙니다. Projection/identity suspect는 원인 확정이 아닙니다.</p>
    <label>Geometry Reliability Replay JSON <input ref={inputRef} type="file" multiple accept=".json,application/json" onChange={(e) => void load(Array.from(e.target.files ?? []))} /></label>
    {inputs.map((i, index) => <p key={`${i.captureId}/${index}`}>{i.filename} · {i.captureId}{' '}<label>Geometry role for {i.filename} <select value={i.role} onChange={(e) => {
      invalidate(); const role = e.target.value as BodyRole;
      loaded.current = loaded.current.map((v, j) => j === index ? { ...v, role } : v); setInputs((prev) => prev.map((v, j) => j === index ? { ...v, role } : v));
    }}>{BODY_ROLES.map((role) => <option key={role}>{role}</option>)}</select></label></p>)}
    <p>기존 다섯 capture의 역할을 직접 지정하세요. LIVE parity 불일치 시 중단합니다. First Neutral 호환은 OLD CLEAN에만 허용합니다.</p>
    <button disabled={!inputs.length || inputs.some((i) => i.role === 'UNASSIGNED') || progress !== null} onClick={() => void inspect()}>Inspect Geometry Reliability</button>{' '}
    <button disabled={!evidence || progress !== null} onClick={() => void compareMarkers()}>Compare Reliability Markers</button>{' '}
    <button disabled={!markers || progress !== null} onClick={() => void experiment()}>Optional Quality-Gate Thought Experiment</button>{' '}
    <button disabled={progress === null} onClick={invalidate}>Cancel Geometry Analysis</button>{' '}
    <button onClick={() => { invalidate(); loaded.current = []; setInputs([]); if (inputRef.current) inputRef.current.value = ''; }}>Reset Geometry Analysis</button>{' '}
    <button disabled={!evidence || progress !== null} onClick={() => { if (evidence) download(new Blob([JSON.stringify(report ?? evidence, null, 2)], { type: 'application/json' }), 'plank-stork-step-4n-results.json'); }}>Download Geometry JSON</button>{' '}
    <button disabled={!evidence || progress !== null} onClick={() => { if (evidence) download(new Blob([geometryTracesCsv(evidence)], { type: 'text/csv;charset=utf-8' }), 'plank-stork-step-4n-traces.csv'); }}>Download Geometry Traces CSV</button>
    <p>분포 → coarse marker → 선택적24개 gate 순서입니다. 고정 Y+flexion+integrity12의 entry만 비교하며 진행 중 run은 취소하지 않습니다. World detector, production 적용, 자동 BEST 없음.</p>
    {progress && <p role="status">{progress}</p>}{error && <p role="alert">{error}</p>}
    {evidence && <>
      <details><summary>Geometry definitions / eligibility / continuity</summary><pre>{JSON.stringify(evidence.settings, null, 2)}</pre></details>
      {evidence.geometryReliabilityEvidence.perFixture.map((f) => <details key={`${f.input.captureId}/${f.input.trialId}`}>
        <summary>{f.input.role} · {f.input.filename} · parity {f.liveReplayParity.required ? 'MATCH' : 'LEGACY'}</summary>
        <details><summary>Frozen image/world baseline</summary><pre>{JSON.stringify(f.baseline, null, 2)}</pre></details>
        <details><summary>Geometry stage / label distributions</summary><pre>{JSON.stringify({ perStage: f.perStageDistributions, perLabel: f.perLabelDistributions }, null, 2)}</pre></details>
        <details><summary>Segment stability / projection / overlap / identity</summary><pre>{JSON.stringify({ segmentStability: f.segmentStability, projectionDisagreement: f.projectionDisagreement, overlapDiagnostics: f.overlapDiagnostics, identityContinuity: f.identityContinuity }, null, 2)}</pre></details>
        <details><summary>World information gain / grouped windows</summary><pre>{JSON.stringify({ worldInformationGain: f.worldInformationGain, groups: f.groups.map((g) => ({ group: g.group, frames: g.frameCount, sideFrames: g.sideFrameCount, windows: g.windowCount })) }, null, 2)}</pre></details>
        {f.anchorTraces.map((a, i) => <details key={i}><summary>{a.kind} {a.mode} {a.side} · {a.candidateStart.toFixed(1)}ms</summary><pre>{JSON.stringify({ anchor: a.anchorMeaning,
          entry: a.rows.find((r) => r.timestamp === a.candidateStart), confirm: a.rows.find((r) => r.timestamp === a.kickConfirm) }, null, 2)}</pre></details>)}
      </details>)}
    </>}
    {markers && <details><summary>Reliability marker coverage / visibility mismatch / world cuts</summary><pre>{JSON.stringify({ cuts: markers.cuts, interpretation: markers.interpretation,
      perFixture: markers.perFixture.map(({ categoryProfiles: _profiles, ...f }) => f) }, null, 2)}</pre></details>}
    {report && report.qualityGateExperiments.length > 0 && <>
      <p>{report.qualityGateExperiments.length} quality-gate experiments · EXPLORATORY_QUALITY_VIABLE {report.exploratoryQualityViableConfigs.length}. Production ready 판정이 아닙니다.</p>
      <div className="signal-table-scroll"><table className="visibility-table"><caption>Geometry quality-gate thought experiments</caption><thead><tr><th>Gate</th><th>False removed/added</th><th>True lost</th><th>Assessment</th><th>Details</th></tr></thead><tbody>
        {report.qualityGateExperiments.map((r) => <tr key={r.config.id}><th>{r.config.id}</th><td>{r.perFixture.reduce((n, f) => n + f.falseRemoved, 0)}/{r.perFixture.reduce((n, f) => n + f.falseAdded, 0)}</td><td>{r.perFixture.reduce((n, f) => n + f.trueLost, 0)}</td><td>{r.assessment}</td><td><button onClick={() => setSelected(r.config.id)}>Inspect geometry {r.config.id}</button></td></tr>)}
      </tbody></table></div>
      {detail && <details open><summary>Per-fixture entry observations / counts / events</summary><pre>{JSON.stringify(detail, null, 2)}</pre></details>}
    </>}
  </section>;
});
