import { CORRIDOR_FEATURES } from '../pose/motion/kneeMotionFeatures';
import { EXPECTED_MOTIONS, type MotionMetrics } from '../pose/motion/kneeMotionTypes';
import type { useKneeMotionValidation } from '../pose/motion/useKneeMotionValidation';

const number = (value: number | null) => value?.toFixed(3) ?? '-';
const percent = (value: number | null) => value === null ? '-' : `${(value * 100).toFixed(1)}%`;
function MetricsRow({ label, data }: { label: string; data: MotionMetrics }) {
  return <tr><th>{label}</th><td>{data.totalFrames} / {data.validFrames} / {data.staleFrames}</td>
    <td>{number(data.medianAbsKneeCenterOffsetX)} / {number(data.maxAbsKneeCenterOffsetX)}</td>
    <td>{number(data.peakRelativeKneeVelocity.left)} / {number(data.peakRelativeKneeVelocity.right)}</td>
    <td>{number(data.peakKneeHipDistanceChange.left)} / {number(data.peakKneeHipDistanceChange.right)}</td>
    <td>{number(data.medianLeftKneeVisibility)} / {number(data.medianRightKneeVisibility)}</td></tr>;
}
function Header() {
  return <thead><tr>{['Motion / phase', 'Total / valid / stale', 'Median / max abs offset', 'Peak relative velocity L/R', 'Peak distance change L/R', 'Visibility median L/R'].map((label) => <th key={label}>{label}</th>)}</tr></thead>;
}
export function KneeMotionValidationPanel({ motion, canStart, onStart }: {
  motion: ReturnType<typeof useKneeMotionValidation>; canStart: boolean; onStart: () => void;
}) {
  const { view, analysis } = motion;
  return <section className="features-panel motion-panel" aria-labelledby="knee-motion-title">
    <h3 id="knee-motion-title">STEP 4D — Knee Motion Signal Validation</h3>
    <p>Action Calibration 없이 Neutral FROZEN 후 시작합니다. 15초 동안 MOVE/HOLD/RETURN을 모두 기록해 temporal signal을 비교합니다. 최종 KICK 판정은 하지 않습니다.</p>
    <div className="camera-controls">
      <button disabled={!canStart || view.status === 'ACTIVE'} onClick={onStart}>Start Knee Motion Validation</button>
      <button disabled={view.status !== 'COMPLETED'} onClick={motion.download}>Download Motion Validation JSON</button>
      <button onClick={motion.resetMotion}>Reset Motion Validation</button>
    </div>
    {motion.error && <p role="alert" className="camera-error">{motion.error}</p>}
    <div className="recorder-stage" role="status">
      <strong>Motion: {view.status}</strong><span>Phase: {view.phase}</span><span>Expected motion: {view.expectedMotion ?? '-'}</span>
      <span className="recorder-countdown">{(view.remainingMs / 1000).toFixed(1)}s remaining</span><span>Recorded frames: {view.recordedFrames}</span>
    </div>
    {analysis && <>
      <h4>Motion Summary</h4>
      <p className="pose-note">각 측정값은 해당 값이 finite인 frame을 사용합니다. Pose valid는 hip/knee 4점의 2D 좌표 유효성입니다. Visibility cutoff는 적용하지 않습니다. 거리 변화는 Neutral median 대비 절댓값이며 속도 단위는 normalized coordinate/s입니다.</p>
      <div className="signal-table-scroll"><table className="visibility-table signal-table" aria-label="Motion summary"><Header /><tbody>
        {EXPECTED_MOTIONS.map((key) => <MetricsRow key={key} label={key} data={analysis.byMotion[key]} />)}
      </tbody></table></div>
      <details><summary>각 MOVE / HOLD / RETURN stage</summary><div className="signal-table-scroll"><table className="visibility-table signal-table" aria-label="Motion stage summary"><Header /><tbody>
        {analysis.stages.map((row) => <MetricsRow key={row.stageIndex} label={`${row.expectedMotion} / ${row.phase}`} data={row} />)}
      </tbody></table></div></details>
      <details><summary>Neutral corridor — median / p10 / p90 / MAD</summary><div className="signal-table-scroll"><table className="visibility-table signal-table" aria-label="Neutral corridors">
        <thead><tr>{['Candidate', 'Samples', 'Median', 'p10', 'p90', 'MAD'].map((key) => <th key={key}>{key}</th>)}</tr></thead>
        <tbody>{CORRIDOR_FEATURES.map((key) => { const row = analysis.neutralCorridor[key]; return <tr key={key}><th>{key}</th><td>{row.sampleCount}</td><td>{number(row.median)}</td><td>{number(row.p10)}</td><td>{number(row.p90)}</td><td>{number(row.mad)}</td></tr>; })}</tbody>
      </table></div></details>
      <h4>Dominant knee — MOVE/HOLD displacement</h4>
      {(['KNEE_LEFT', 'KNEE_RIGHT'] as const).map((key) => { const row = analysis.dominantKnees[key]; return <p key={key}>{key}: <strong>{row.dominantKnee}</strong> · peak L {number(row.leftPeakDisplacement)} / R {number(row.rightPeakDisplacement)}</p>; })}
      <details><summary>Corridor crossing experiment — 모든 후보 / k</summary>
        <p>Neutral median ± k × MAD 바깥의 frame 비율입니다. Motion은 MOVE/HOLD만, Neutral은 최초 NEUTRAL 구간만 비교합니다. Twist/Neutral crossing은 false crossing 관찰값이며 PASS/FAIL은 없습니다.</p>
        <div className="signal-table-scroll"><table className="visibility-table signal-table" aria-label="Corridor crossings">
          <thead><tr><th>Candidate</th><th>k</th>{EXPECTED_MOTIONS.map((key) => <th key={key}>{key}</th>)}</tr></thead>
          <tbody>{analysis.crossingExperiments.map((row) => <tr key={`${row.feature}-${row.k}`}><th>{row.feature}</th><td>{row.k}</td>{EXPECTED_MOTIONS.map((key) => <td key={key}>{percent(row.rates[key].crossingRate)} ({row.rates[key].crossingFrames}/{row.rates[key].comparableFrames})</td>)}</tr>)}</tbody>
        </table></div>
      </details>
    </>}
    <p className="pose-note">Mirror는 metadata/preview만 변경합니다. JSON은 Laptop에서 내려받으며 Neutral 재보정·Camera Stop 전에 다운로드하세요.</p>
  </section>;
}
