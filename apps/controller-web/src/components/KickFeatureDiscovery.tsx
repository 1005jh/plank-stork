import { useEffect, useRef, useState } from 'react';
import { analyzeDiscovery, createDiscoveryReport, type DatasetSummary, type DiscoveryAnalysis, type FeatureDiscoveryReport, type FeatureSummary } from '../discovery/analyzeDiscovery';
import { DISCOVERY_FEATURES, FEATURE_IDS, type FeatureId } from '../discovery/discoveryFeatures';
import { readReplaySession } from '../replay/readReplaySession';
import { useLocalDownload } from '../replay/useLocalDownload';
import { prepareTemporalDatasets, summarizeTemporalDatasets, createTemporalReport, type PreparedTemporalDataset, type TemporalDataset, type TemporalDiscoveryReport } from '../discovery/analyzeTemporal';
import { TemporalFeatureDiscovery } from './TemporalFeatureDiscovery';
import { YKickShadowPanel } from './YKickShadowPanel';
import { ReacquisitionAnalysis } from './ReacquisitionAnalysis';

const number = (value: number | null) => value === null ? '-' : value.toFixed(3);
const percent = (value: number | null) => value === null ? '-' : `${(value * 100).toFixed(1)}%`;
const identity = (d: DatasetSummary) => `${d.input.filename} · ${d.input.captureId} · trial ${d.input.trialId}`;

function FeatureTable({ rows, name }: { rows: FeatureSummary[]; name: string }) {
  return <div className="signal-table-scroll" tabIndex={0} role="region" aria-label={name}>
    <table className="visibility-table signal-table">
      <caption>{name}</caption>
      <thead><tr>{['Feature / space', 'Coverage', 'Neutral', 'Twist', 'Knee L', 'Knee R', 'NonKick P95', 'NonKick Max', 'Knee L Peak', 'Knee R Peak', 'Min Kick Peak', 'Sample Margin', 'Robust Margin', 'Direction L Margin', 'Direction R Margin', 'Direction consistent'].map((s) => <th key={s}>{s}</th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={row.feature}>
        <th scope="row">{row.feature}<br />{DISCOVERY_FEATURES[row.feature].group}{DISCOVERY_FEATURES[row.feature].group === 'ANGLE' ? ' · EXPLORATORY' : ''}<br />{row.lowCoverage ? 'LOW / MISSING COVERAGE' : ''}</th>
        {[row.overallCoverage, row.neutralCoverage, row.twistCoverage, row.kneeLeftCoverage, row.kneeRightCoverage].map((c, i) => <td key={i}>{percent(c)}</td>)}
        {[row.nonKickP95, row.nonKickMax, row.kneeLeftPeak, row.kneeRightPeak, row.minKickPeak, row.sampleSeparationMargin, row.robustSeparationMargin, row.directionLeftMargin, row.directionRightMargin].map((v, i) => <td key={i}>{number(v)}</td>)}
        <td>{row.directionConsistentAcrossObservedKicks === null ? 'UNKNOWN / N/A' : String(row.directionConsistentAcrossObservedKicks)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function DatasetDetails({ dataset }: { dataset: DatasetSummary }) {
  const [open, setOpen] = useState(false), [feature, setFeature] = useState<FeatureId>('hipCenterRelative2DDisplacement');
  const definition = DISCOVERY_FEATURES[feature];
  const directions = dataset.features.find((f) => f.feature === feature)!.directions;
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Stage / limb details — {dataset.input.filename} / trial {dataset.input.trialId}</summary>
    {open && <>
      <label>Feature <select value={feature} onChange={(e) => setFeature(e.target.value as FeatureId)}>
        {FEATURE_IDS.map((id) => <option key={id}>{id}</option>)}
      </select></label>
      <p>{definition.formula} · {definition.unit} · {definition.evidence ? 'LEFT/RIGHT evidence = abs(value)' : 'Raw diagnostic: separation 대상 아님'}</p>
      <div className="signal-table-scroll"><table className="visibility-table signal-table">
        <caption>Stage × feature × side (peak = max abs value)</caption>
        <thead><tr>{['Stage', 'Side', 'Frames', 'Usable', 'Coverage', 'Median', 'P90', 'P95', 'Max', 'Peak', 'Peak abs velocity (/s)', 'Velocity samples'].map((s) => <th key={s}>{s}</th>)}</tr></thead>
        <tbody>{dataset.stageSummaries.filter((r) => r.feature === feature).map((r) => <tr key={`${r.stageIndex}-${r.side}`}>
          <th>{r.stageIndex} {r.expected}</th><td>{r.side}</td><td>{r.frameCount}</td><td>{r.usableFrameCount}</td><td>{percent(r.coverage)}</td>
          {[r.median, r.p90, r.p95, r.max, r.peak, r.peakAbsVelocity].map((v, i) => <td key={i}>{number(v)}</td>)}<td>{r.velocitySampleCount}</td>
        </tr>)}</tbody>
      </table></div>
      <table className="visibility-table"><caption>Limb-specific direction evidence</caption>
        <thead><tr><th>Stage</th><th>Left peak</th><th>Right peak</th><th>Correct side margin</th></tr></thead>
        <tbody>{directions.map((d) => <tr key={d.stageIndex}><th>{d.expected}</th><td>{number(d.leftPeak)}</td><td>{number(d.rightPeak)}</td><td>{number(d.correctSideMargin)}</td></tr>)}</tbody>
      </table>
      <details><summary>Analysis-only Neutral reference / stage times</summary>
        <pre>{JSON.stringify({ bodyScale: dataset.bodyScale, neutralReference: dataset.neutralReference, stages: dataset.stages }, null, 2)}</pre>
      </details>
    </>}
  </details>;
}

export function KickFeatureDiscovery() {
  const [report, setReport] = useState<FeatureDiscoveryReport | null>(null);
  const [temporal, setTemporal] = useState<TemporalDiscoveryReport | null>(null);
  const [errors, setErrors] = useState<string[]>([]), [progress, setProgress] = useState<string | null>(null);
  const generation = useRef(0), input = useRef<HTMLInputElement>(null);
  const prepared = useRef<PreparedTemporalDataset[]>([]);
  const { download, clear } = useLocalDownload();
  useEffect(() => () => { generation.current++; prepared.current = []; }, []);
  const reset = () => {
    generation.current++; clear(); setReport(null); setTemporal(null); setErrors([]); setProgress(null);
    prepared.current = [];
    if (input.current) input.current.value = '';
  };
  const analyze = async (files: File[]) => {
    if (!files.length) return;
    const job = ++generation.current;
    clear(); setReport(null); setTemporal(null); setErrors([]); setProgress('분석 준비 중…');
    prepared.current = [];
    const datasets: DiscoveryAnalysis[] = [], failures: string[] = [];
    const temporalDatasets: TemporalDataset[] = [];
    for (const [index, file] of files.entries()) {
      // Yield between files; timestamps for analysis always come from Replay JSON.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (job !== generation.current) return;
      setProgress(`${index + 1} / ${files.length} · ${file.name}`);
      try {
        const text = await file.text();
        if (job !== generation.current) return;
        const session = readReplaySession(text);
        const discovery = analyzeDiscovery(session, file.name), timeline = prepareTemporalDatasets(session, file.name);
        const temporal = summarizeTemporalDatasets(timeline);
        datasets.push(...discovery); temporalDatasets.push(...temporal);
        prepared.current.push(...timeline);
      } catch (cause) {
        failures.push(`${file.name}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    if (job !== generation.current) return;
    // Raw JSON is released. Scalar-only replay timelines stay in a ref for an explicit shadow run.
    setReport(datasets.length ? createDiscoveryReport(datasets) : null);
    setTemporal(temporalDatasets.length ? createTemporalReport(temporalDatasets) : null); setErrors(failures); setProgress(null);
  };
  return <section aria-labelledby="kick-discovery-title">
    <h3 id="kick-discovery-title">STEP 4G — Kick Feature Discovery</h3>
    <p>기존 STEP 4F version 1 Capture JSON만 선택하세요. 여러 파일과 모든 trial을 로컬에서 분석합니다. WebM / 카메라 / 재추론은 필요하지 않습니다.</p>
    <label>Feature Discovery Replay JSON <input ref={input} type="file" accept=".json,application/json" multiple disabled={progress !== null}
      onChange={(e) => { void analyze(Array.from(e.target.files ?? [])); }} /></label>
    <div className="pose-controls">
      <button type="button" disabled={!report || progress !== null} onClick={() => {
        if (report) download(new Blob([JSON.stringify({ ...report,
          inputs: report.inputs.map((input, index) => ({ ...input, role: temporal?.inputs[index]?.role ?? 'UNASSIGNED' })) }, null, 2)], { type: 'application/json' }), `plank-stork-feature-discovery-${report.createdAt.replace(/[:.]/g, '-')}.json`);
      }}>Download Feature Discovery JSON</button>
      <button type="button" onClick={reset}>Reset Feature Discovery</button>
    </div>
    {progress && <p role="status">{progress}</p>}
    {errors.length > 0 && <div role="alert">분석 제외 파일:{errors.map((error, index) => <p key={index}>{error}</p>)}</div>}
    <p className="pose-note">현재 small fixture set의 기술 통계입니다. universal threshold 또는 feature 자동 선택 결과가 아닙니다.
      Label은 Guided stage 기준입니다. LEFT/RIGHT evidence는 각 신체 limb의 움직임이며 좌표 부호나 Mirror로 방향을 정하지 않습니다.</p>
    <p className="pose-note">Coverage는 기록된 stage의 usable side-frame 비율입니다. 80% 미만 또는 관측 없음은 LOW / MISSING COVERAGE로 표시합니다.
      Angle은 exploratory입니다. signed feature의 stage 통계는 원값, separation/direction은 절댓값을 사용합니다.
      Direction margin은 각 label의 관측 stage 중 최솟값이며 하나라도 ≤ 0이면 false, 부족하면 UNKNOWN입니다.</p>
    {report && <>
      <p>{report.inputs.length} datasets · {report.createdAt}</p>
      <FeatureTable rows={report.aggregate} name="Aggregate — selected datasets" />
      {report.perDataset.map((dataset, index) => <section key={`${index}-${identity(dataset)}`}>
        <h4>{identity(dataset)} · Role: {temporal?.inputs[index]?.role ?? 'UNASSIGNED'}</h4>
        <p>{dataset.frameCount} attributed frames · {dataset.unattributedFrameCount} outside stage · {dataset.stageSource}</p>
        {dataset.warnings.map((warning) => <p key={warning}>{warning}</p>)}
        <FeatureTable rows={dataset.features} name={identity(dataset)} />
        <DatasetDetails dataset={dataset} />
      </section>)}
    </>}
    <TemporalFeatureDiscovery report={temporal} onChange={setTemporal} />
    <ReacquisitionAnalysis key={`reacquisition-${JSON.stringify(temporal?.inputs ?? [])}`} temporal={temporal} getPrepared={() => prepared.current} />
    <YKickShadowPanel key={JSON.stringify(temporal?.inputs ?? [])} temporal={temporal} getPrepared={() => prepared.current} />
  </section>;
}
