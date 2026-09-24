import { ACTION_FEATURE_KEYS } from '../pose/actions/poseActionConstants';
import { POSE_ACTIONS } from '../pose/actions/poseActionTypes';
import type { useActionValidation } from '../pose/validation/useActionValidation';

const value = (number: number | null) => number?.toFixed(3) ?? '-';
const percent = (number: number | null) => number === null ? '-' : `${(number * 100).toFixed(1)}%`;

export function PoseValidation({ validation, canStart, onStart }: {
  validation: ReturnType<typeof useActionValidation>; canStart: boolean; onStart: () => void;
}) {
  const { view, summary } = validation;
  return <section className="features-panel validation-panel" aria-labelledby="validation-title">
    <h3 id="validation-title">STEP 4C — Action Signal Validation</h3>
    <p>Classifier v1의 반복 재현성을 측정합니다. 폰의 검증 안내를 따라 수행하세요. 자동 PASS/FAIL 판정은 하지 않습니다.</p>
    <div className="camera-controls">
      <button disabled={!canStart || view.status === 'ACTIVE'} onClick={onStart}>Start Action Validation</button>
      <button disabled={view.status !== 'COMPLETED'} onClick={validation.download}>Download Validation JSON</button>
      <button onClick={validation.resetValidation}>Reset Validation</button>
    </div>
    {validation.error && <p role="alert" className="camera-error">{validation.error}</p>}
    <div className="recorder-stage" role="status">
      <strong>Validation: {view.status}</strong>
      <span>Current phase: {view.phase}</span>
      <span>Expected action: {view.expectedAction ?? '-'}</span>
      <span className="recorder-countdown">{(view.remainingMs / 1000).toFixed(1)}s remaining</span>
      <span>Recorded frames: {view.recordedFrames}</span>
    </div>
    <p>{Object.entries(view.sampleCounts).map(([label, count]) => `${label}: ${count}`).join(' · ')}</p>
    {summary && <>
      <h4>Validation Summary</h4>
      <p className="pose-note">정답률은 유효 pose frame 기준입니다. Own nearest는 네 거리 모두 유효한 frame 중 단독 최단 비율입니다. 결측 통계는 -입니다.</p>
      <div className="signal-table-scroll"><table className="visibility-table signal-table" aria-label="Validation summary">
        <thead><tr>{['Action', 'Total', 'Valid', 'Stale', 'Raw correct', 'Stable correct', 'Own nearest', 'Distance frames', 'Confidence', 'Own distance', 'Other distance', 'Margin'].map((name) => <th key={name}>{name}</th>)}</tr></thead>
        <tbody>{POSE_ACTIONS.map((action) => {
          const row = summary.actions[action];
          return <tr key={action}><th>{action}</th><td>{row.totalRecordedFrames}</td><td>{row.validPoseFrames}</td><td>{row.staleFrames}</td>
            <td>{percent(row.rawCorrectRate)}</td><td>{percent(row.stableCorrectRate)}</td><td>{percent(row.ownPrototypeNearestRate)}</td><td>{row.distanceComparableFrames}</td>
            <td>{value(row.medianConfidence)}</td><td>{value(row.medianOwnDistance)}</td><td>{value(row.medianClosestOtherDistance)}</td><td>{value(row.medianMargin)}</td></tr>;
        })}</tbody>
      </table></div>
      <h4>Neutral records</h4>
      <p>Total {summary.neutral.totalRecordedFrames} / Valid {summary.neutral.validPoseFrames} / Stale {summary.neutral.staleFrames}</p>
      <p>Raw NONE {percent(summary.neutral.rawCorrectRate)} · Stable NONE {percent(summary.neutral.stableCorrectRate)}</p>
      <p>Neutral movement score: median {value(summary.neutral.medianNeutralMovementScore)} / p90 {value(summary.neutral.p90NeutralMovementScore)} ({summary.neutral.scoreFrames} frames)</p>
      <details><summary>Feature repeatability — prototype vs validation median</summary>
        <div className="signal-table-scroll"><table className="visibility-table signal-table" aria-label="Validation feature repeatability">
          <thead><tr>{['Action', 'Feature', 'Samples', 'Prototype', 'Validation median', 'Difference', 'Normalized drift'].map((name) => <th key={name}>{name}</th>)}</tr></thead>
          <tbody>{POSE_ACTIONS.flatMap((action) => ACTION_FEATURE_KEYS.map((key) => {
            const row = summary.actions[action].featureRepeatability[key];
            return <tr key={`${action}-${key}`}><th>{action}</th><th>{key}</th><td>{row.sampleCount}</td><td>{value(row.prototype)}</td>
              <td>{value(row.validationMedian)}</td><td>{value(row.difference)}</td><td>{value(row.normalizedDrift)}</td></tr>;
          }))}</tbody>
        </table></div>
      </details>
    </>}
    <p className="pose-note">JSON에는 full raw landmark·feature·분류 결과와 시작 시점의 보정 기준/설정이 포함됩니다. Laptop에서만 다운로드합니다. 재보정·Camera Stop 시 dataset을 초기화합니다.</p>
  </section>;
}
