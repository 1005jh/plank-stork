import { useEffect, useState } from 'react';
import { createTemporalReport, type TemporalDiscoveryReport, type TemporalRule } from '../discovery/analyzeTemporal';
import { TEMPORAL_SETTINGS, type TemporalRole, type WindowMode } from '../discovery/temporalEvidence';
import { LIMBS } from '../discovery/discoveryFeatures';
import { useLocalDownload } from '../replay/useLocalDownload';

const n = (value: number | null) => value === null ? '-' : value.toFixed(3);
const flag = (value: boolean | null) => value === null ? 'UNKNOWN' : String(value);
function RuleTable({ rows, caption }: { rows: TemporalRule[]; caption: string }) {
  return <div className="signal-table-scroll"><table className="visibility-table signal-table"><caption>{caption}</caption>
    <thead><tr>{['Window', 'Threshold', 'Dwell ms', '2D confirmation', 'Neutral false stages', 'Twist L false stages', 'Twist R false stages', 'Knee L', 'Knee R', 'Assessment'].map((label) => <th key={label}>{label}</th>)}</tr></thead>
    <tbody>{rows.map((r) => <tr key={`${r.window}-${r.threshold}-${r.dwellMs}-${r.confirmation2D}`}>
      <th>{r.window}</th><td>{r.threshold}</td><td>{r.dwellMs}</td><td>{r.confirmation2D ?? 'OFF'}</td>
      <td>{r.neutralFalse ?? 'UNKNOWN'}</td><td>{r.twistLeftFalse ?? 'UNKNOWN'}</td><td>{r.twistRightFalse ?? 'UNKNOWN'}</td>
      <td>{flag(r.kneeLeftDetected)}</td><td>{flag(r.kneeRightDetected)}</td><td>{r.assessment}</td>
    </tr>)}</tbody>
  </table></div>;
}
export function TemporalFeatureDiscovery({ report, onChange }: { report: TemporalDiscoveryReport | null; onChange: (report: TemporalDiscoveryReport) => void }) {
  const [window, setWindow] = useState<WindowMode>('FULL'), [threshold, setThreshold] = useState(0.35), [dwell, setDwell] = useState(100);
  const [confirmation, setConfirmation] = useState<number | null>(null);
  const { download, clear } = useLocalDownload();
  useEffect(() => { if (!report) clear(); }, [report, clear]);
  return <section aria-labelledby="temporal-discovery-title">
    <h3 id="temporal-discovery-title">STEP 4G.1 — Temporal Validation for Knee-Y Kick Evidence</h3>
    <p>위 Capture JSON 선택 시 함께 분석합니다. 측정용 threshold/dwell sweep이며 production detector 설정이 아닙니다.
      CLEAN은 모든 대상 구간을 관측할 수 있을 때만 평가합니다. STRESS missing은 false negative로 세지 않습니다.</p>
    {report && <>
      <fieldset><legend>Dataset roles — CLEAN 판정 대상 확인</legend>
        {report.perDataset.map((d, index) => <label key={index}>{d.input.filename} · {d.input.captureId} · trial {d.input.trialId}{' '}
          <select aria-label={`Temporal role ${d.input.filename} trial ${d.input.trialId}`} value={d.role} onChange={(e) => {
            onChange(createTemporalReport(report.perDataset.map((dataset, i) => i === index ? { ...dataset, role: e.target.value as TemporalRole } : dataset), report.createdAt));
          }}><option>UNASSIGNED</option><option>CLEAN</option><option>STRESS</option></select>{' '}
        </label>)}
      </fieldset>
      <p>{report.perDataset.filter((d) => d.role === 'CLEAN').length} CLEAN trials · {report.viableRulesClean.length} viable combinations (FULL + TRIMMED, Y-only + 2D confirmation).
        UNKNOWN은 0/실패가 아닙니다. 모든 dataset의 role을 직접 지정하세요. 파일명으로 추론하지 않습니다.</p>
      {report.warnings.map((warning) => <p role="alert" key={warning}>{warning}</p>)}
      <button type="button" onClick={() => onChange(createTemporalReport(report.perDataset))}>Run Temporal Validation</button>{' '}
      <button type="button" onClick={() => download(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
        `plank-stork-feature-temporal-${report.createdAt.replace(/[:.]/g, '-')}.json`)}>Download Feature Temporal Discovery JSON</button>
      <p className="pose-note">Contiguous duration은 첫/마지막 관측 frame 간격입니다. Missing 또는 400ms 이상 gap은 run·적분·velocity를 끊습니다.
        Observable = coverage ≥ 80% 및 usable gap &lt; 400ms. Direction은 양쪽이 usable인 candidate window에서만 비교합니다.</p>
      <label>Window <select aria-label="Temporal window" value={window} onChange={(e) => setWindow(e.target.value as WindowMode)}><option>FULL</option><option>TRIMMED</option></select></label>{' '}
      <label>Y threshold <select aria-label="Temporal threshold" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>{TEMPORAL_SETTINGS.thresholds.map((t) => <option key={t}>{t}</option>)}</select></label>{' '}
      <label>Dwell ms <select aria-label="Temporal dwell" value={dwell} onChange={(e) => setDwell(Number(e.target.value))}>{TEMPORAL_SETTINGS.dwellMs.map((t) => <option key={t}>{t}</option>)}</select></label>{' '}
      <label>2D confirmation <select aria-label="Temporal confirmation" value={confirmation ?? 'OFF'} onChange={(e) => setConfirmation(e.target.value === 'OFF' ? null : Number(e.target.value))}>
        <option>OFF</option>{TEMPORAL_SETTINGS.confirmation2D.map((t) => <option key={t}>{t}</option>)}</select></label>
      <RuleTable rows={report.rulesClean.filter((r) => r.window === window && r.confirmation2D === confirmation)} caption="CLEAN threshold × dwell (all 49 combinations for selected window/confirmation)" />
      <details><summary>All viable combinations — {report.viableRulesClean.length} (자동 선택 없음)</summary>
        <RuleTable rows={report.viableRulesClean} caption="All viableRulesClean — experimental combinations" />
      </details>
      {report.perDataset.map((dataset, index) => <section key={index}>
        <h4>{dataset.input.filename} · trial {dataset.input.trialId} · {dataset.role}</h4>
        <div className="signal-table-scroll"><table className="visibility-table signal-table"><caption>{window} — Y evidence / velocity / coverage</caption>
          <thead><tr>{['Stage', 'Side', 'Observable', 'Usable / frames', 'Coverage', 'Y peak', 'Y p95', 'Y peak |velocity|', 'Y p95 |velocity|', '2D peak', 'X abs peak', 'Knee visibility median', 'Max usable gap ms'].map((s) => <th key={s}>{s}</th>)}</tr></thead>
          <tbody>{dataset.stages.filter((s) => s.window === window).flatMap((stage) => LIMBS.map((side) => {
            const s = stage.sides[side];
            return <tr key={`${stage.stageIndex}-${side}`}><th>{stage.stageIndex} {stage.expected}</th><td>{side}</td><td>{String(s.observableStage)}</td><td>{s.usableFrameCount} / {s.frameCount}</td>
              <td>{s.coverage === null ? '-' : `${(100 * s.coverage).toFixed(1)}%`}</td>
              {[s.peak, s.p95, s.peakAbsVelocity, s.p95AbsVelocity, s.features.hipCenterRelative2DDisplacement.peak, s.features.normalizedXDisplacement.peak, s.visibility.kneeMedian, s.maxUsableGapMs].map((v, i) => <td key={i}>{n(v)}</td>)}</tr>;
          }))}</tbody>
        </table></div>
        <div className="signal-table-scroll"><table className="visibility-table signal-table"><caption>Threshold {threshold} / dwell {dwell}ms / 2D {confirmation ?? 'OFF'}</caption>
          <thead><tr>{['Stage', 'Side', 'Frames above', 'Fraction usable above', 'Longest frames', 'Longest ms', 'Crossings', 'First entry ms', 'Last entry ms', 'Triggered', 'Observed trigger ms'].map((s) => <th key={s}>{s}</th>)}</tr></thead>
          <tbody>{dataset.stages.filter((s) => s.window === window).flatMap((stage) => LIMBS.map((side) => {
            const t = stage.sides[side].thresholds.find((t) => t.threshold === threshold)!;
            const d = t.dwellResults.find((d) => d.dwellMs === dwell && d.confirmation2D === confirmation)!;
            return <tr key={`${stage.stageIndex}-${side}`}><th>{stage.stageIndex} {stage.expected}</th><td>{side}</td><td>{t.framesAbove}</td><td>{n(t.fractionAbove)}</td>
              <td>{t.longestContiguousRunFrames}</td><td>{n(t.longestContiguousRunMs)}</td><td>{t.crossingCount}</td><td>{n(t.firstCrossingMs)}</td><td>{n(t.lastCrossingMs)}</td><td>{flag(d.triggered)}</td><td>{n(d.triggerTime)}</td></tr>;
          }))}</tbody>
        </table></div>
        <div className="signal-table-scroll"><table className="visibility-table signal-table"><caption>Paired candidate windows — threshold {threshold} (integral: evidence × seconds)</caption>
          <thead><tr>{['Stage', 'Start ms', 'End ms', 'Left peak', 'Right peak', 'Left integrated', 'Right integrated', 'Correct-side margin', 'Direction'].map((s) => <th key={s}>{s}</th>)}</tr></thead>
          <tbody>{dataset.stages.filter((s) => s.window === window).flatMap((stage) => stage.directionEvidence.filter((d) => d.threshold === threshold).map((d, i) =>
            <tr key={`${stage.stageIndex}-${i}`}><th>{stage.stageIndex} {stage.expected}</th>{[d.startMs, d.endMs, d.leftPeak, d.rightPeak, d.leftIntegratedEvidence, d.rightIntegratedEvidence, d.correctSideMargin].map((v, i) => <td key={i}>{n(v)}</td>)}<td>{d.direction}</td></tr>))}</tbody>
        </table></div>
        <details><summary>Usable gaps — {window}</summary><pre>{JSON.stringify(dataset.stages.filter((s) => s.window === window).map((s) =>
          ({ stage: s.expected, stageIndex: s.stageIndex, LEFT: s.sides.LEFT.usableGaps, RIGHT: s.sides.RIGHT.usableGaps })), null, 2)}</pre></details>
      </section>)}
    </>}
  </section>;
}
