import { memo, useEffect, useRef, useState } from 'react';
import { BODY_ROLES, prepareBodyInputs, type BodyRole, type BodyInput, type BodyFixture } from '../discovery/bodyLocalFeatures';
import { createBodyEvidence, analyzeFeatureConfig, createBodyReport, type BodyEvidence, type BodyReport, type FeatureResult } from '../discovery/analyzeBodyLocal';
import { directFeatureConfigs, temporalFeatureConfigs } from '../discovery/featureKickShadow';
import { readReplaySession } from '../replay/readReplaySession';
import { useLocalDownload } from '../replay/useLocalDownload';

export const BodyLocalAnalysis = memo(function BodyLocalAnalysis() {
  const loaded = useRef<BodyInput[]>([]), prepared = useRef<BodyFixture[]>([]), results = useRef<FeatureResult[]>([]), generation = useRef(0), fileInput = useRef<HTMLInputElement>(null);
  const [inputs, setInputs] = useState<{ filename: string; captureId: string; role: BodyRole }[]>([]);
  const [evidence, setEvidence] = useState<BodyEvidence | null>(null), [report, setReport] = useState<BodyReport | null>(null);
  const [progress, setProgress] = useState<string | null>(null), [error, setError] = useState<string | null>(null), [selected, setSelected] = useState<string | null>(null);
  const { download, clear } = useLocalDownload();
  useEffect(() => () => { generation.current++; loaded.current = []; prepared.current = []; results.current = []; }, []);
  function invalidate() { generation.current++; clear(); prepared.current = []; results.current = []; setEvidence(null); setReport(null); setSelected(null); setProgress(null); setError(null); }
  async function load(files: File[]) {
    invalidate(); loaded.current = []; setInputs([]); const job = generation.current; setProgress('Reading STEP4M captures…');
    try {
      const next: BodyInput[] = [];
      for (const file of files) { const text = await file.text(); if (job !== generation.current) return;
        next.push({ filename: file.name, role: 'UNASSIGNED', session: readReplaySession(text) }); }
      loaded.current = next; setInputs(next.map((i) => ({ filename: i.filename, captureId: i.session.captureId, role: i.role })));
    } catch (cause) { if (job === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (job === generation.current) setProgress(null); }
  }
  async function inspect() {
    invalidate(); const job = generation.current; setProgress('Checking LIVE parity and measuring body-local distributions…');
    try {
      await new Promise<void>((r) => window.setTimeout(r, 0)); if (job !== generation.current) return;
      const fixtures = prepareBodyInputs(loaded.current), measured = createBodyEvidence(fixtures);
      if (job === generation.current) { prepared.current = fixtures; setEvidence(measured); }
    } catch (cause) { if (job === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (job === generation.current) setProgress(null); }
  }
  const canTemporal = results.current.filter((r) => !r.temporalRule).length === directFeatureConfigs().length &&
    results.current.every((r) => !r.temporalRule && r.assessment === 'REJECTED');
  async function compare(temporal: boolean) {
    if (!evidence || temporal && !canTemporal) return;
    generation.current++; clear(); const job = generation.current; setError(null); setSelected(null); setProgress('Comparing STEP4M families…');
    try {
      const configs = temporal ? temporalFeatureConfigs() : directFeatureConfigs(), next = temporal ? [...results.current] : [];
      for (let i = 0; i < configs.length; i++) {
        if (i % 4 === 0) { await new Promise<void>((r) => window.setTimeout(r, 0)); if (job !== generation.current) return; setProgress(`${i}/${configs.length} STEP4M ${temporal ? 'causal' : 'direct'} configs`); }
        next.push(analyzeFeatureConfig(prepared.current, evidence, configs[i]));
      }
      if (job === generation.current) { results.current = next; setReport(createBodyReport(evidence, next)); }
    } catch (cause) { if (job === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (job === generation.current) setProgress(null); }
  }
  const detail = report?.candidateFamilyResults.find((r) => r.id === selected);
  return <section aria-labelledby="body-local-title">
    <h3 id="body-local-title">STEP 4M — Body-local / Temporal Kick Feature Redesign</h3>
    <p>POST_FAILURE_EXPLORATORY · 다섯 capture 모두 feature discovery 자료입니다. Production 적용이나 자동 BEST 선택은 하지 않습니다.</p>
    <label>Body-local Replay JSON <input ref={fileInput} type="file" multiple accept=".json,application/json" onChange={(e) => void load(Array.from(e.target.files ?? []))} /></label>
    {inputs.map((i, index) => <p key={`${i.captureId}/${index}`}>{i.filename} · {i.captureId}{' '}<label>Body-local role for {i.filename} <select value={i.role} onChange={(e) => {
      invalidate(); const role = e.target.value as BodyRole; loaded.current = loaded.current.map((v, j) => index === j ? { ...v, role } : v);
      setInputs((prev) => prev.map((v, j) => index === j ? { ...v, role } : v));
    }}>{BODY_ROLES.map((r) => <option key={r}>{r}</option>)}</select></label></p>)}
    <p>역할은 직접 지정합니다. OLD CLEAN만 first Neutral 호환을 허용하고 그 구간은 평가에서 제외합니다. Live parity 불일치 시 분석을 중단합니다.</p>
    <button disabled={!inputs.length || inputs.some((i) => i.role === 'UNASSIGNED') || progress !== null} onClick={() => void inspect()}>Inspect Body-local Features</button>{' '}
    <button disabled={!evidence || progress !== null} onClick={() => void compare(false)}>Compare Candidate Families</button>{' '}
    <button disabled={!canTemporal || progress !== null} onClick={() => void compare(true)}>Compare Causal Temporal Candidates</button>{' '}
    <button disabled={progress === null} onClick={invalidate}>Cancel Body-local Analysis</button>{' '}
    <button onClick={() => { invalidate(); loaded.current = []; setInputs([]); if (fileInput.current) fileInput.current.value = ''; }}>Reset Body-local Analysis</button>{' '}
    <button disabled={!evidence || progress !== null} onClick={() => { if (evidence) download(new Blob([JSON.stringify(report ?? evidence, null, 2)], { type: 'application/json' }), `plank-stork-step-4m-${report ? 'results' : 'evidence'}.json`); }}>Download Body-local JSON</button>
    <p>직접 grid: 8 families × 8 thresholds × 4 dwells = 256. 전체 직접 grid가 REJECTED일 때만 고정된 180개 temporal 비교가 가능합니다. Residual의 양측 절댓값은 같아 방향을 분리하지 못합니다.</p>
    {progress && <p role="status">{progress}</p>}{error && <p role="alert">{error}</p>}
    {evidence && <>
      <details><summary>Body-local definitions / frozen baseline / temporal rules</summary><pre>{JSON.stringify(evidence.settings, null, 2)}</pre></details>
      <details><summary>Reference matrix: Y / Y+12 / fixed Y+flexion+12</summary><pre>{JSON.stringify(evidence.referenceMatrix, null, 2)}</pre></details>
      {evidence.bodyLocalEvidence.perFixture.map((f) => <details key={`${f.input.captureId}/${f.input.trialId}`}>
        <summary>{f.input.role} · {f.input.filename} · parity {f.liveReplayParity.required ? 'MATCH' : 'LEGACY'}</summary>
        <details><summary>Frozen Neutral / coverage</summary><pre>{JSON.stringify({ baseline: f.baseline, coverage: f.coverage }, null, 2)}</pre></details>
        <details><summary>Per-stage / label distributions — usable, coverage, min, p05, median, p95, max</summary><pre>{JSON.stringify({ stages: f.perStageDistributions, labels: f.perLabelDistributions, windows: f.eventWindowGroups }, null, 2)}</pre></details>
        {f.anchorTraces.map((a, i) => <details key={i}><summary>{a.kind} {a.mode} {a.side} · {a.candidateStart.toFixed(1)}ms</summary><pre>{JSON.stringify({ anchor: a.anchorMeaning,
          entry: a.rows.find((r) => r.timestamp === a.candidateStart), confirm: a.rows.find((r) => r.timestamp === a.kickConfirm), temporal: f.temporalSummaries[i] }, null, 2)}</pre></details>)}
      </details>)}
    </>}
    {report && <>
      <p>{report.candidateFamilyResults.length} configs · EXPLORATORY_VIABLE {report.exploratoryViableConfigs.length} · production ready 판정이 아닙니다.</p>
      <details><summary>Threshold / dwell neighborhoods</summary><pre>{JSON.stringify(report.neighborhoodSummary, null, 2)}</pre></details>
      <div className="signal-table-scroll"><table className="visibility-table"><caption>Body-local candidate matrix</caption><thead><tr><th>Config</th><th>False removed/added</th><th>True preserved/lost</th><th>Latency p50/p95/max ms</th><th>Assessment</th><th>Details</th></tr></thead>
        <tbody>{report.candidateFamilyResults.map((r) => <tr key={r.id}><th>{r.id}</th><td>{r.falseRemoved}/{r.falseAdded}</td><td>{r.truePreserved}/{r.trueLost}</td><td>{[r.latency.p50, r.latency.p95, r.latency.max].map((n) => n?.toFixed(1) ?? '-').join('/')}</td><td>{r.assessment}</td><td><button onClick={() => setSelected(r.id)}>Inspect body {r.id}</button></td></tr>)}</tbody></table></div>
      {detail && <details open><summary>Body-local per-fixture counts / coverage / events / latency</summary><pre>{JSON.stringify(detail, null, 2)}</pre></details>}
    </>}
  </section>;
});
