import { ACTION_FEATURE_KEYS, ACTION_HIP_FEATURES, ACTION_MIN_SAMPLES } from '../pose/actions/poseActionConstants';
import { POSE_ACTIONS } from '../pose/actions/poseActionTypes';
import type { usePoseActions } from '../pose/actions/usePoseActions';

const format = (value: number | null) => value?.toFixed(3) ?? '-';

export function PoseActions({ actions }: { actions: ReturnType<typeof usePoseActions> }) {
  const { view } = actions;
  const { calibration, classification } = view;
  const stage = calibration.stage;
  return (
    <section className="features-panel actions-panel" aria-labelledby="pose-actions-title">
      <h3 id="pose-actions-title">STEP 4B — Pose Action Classifier</h3>
      {!view.neutralFrozen && <p>Action calibration requires frozen Neutral calibration.</p>}
      <div className="camera-controls">
        <button type="button" onClick={actions.start} disabled={!view.neutralFrozen || calibration.status === 'RUNNING'}>Start Action Calibration</button>
        <button type="button" onClick={actions.resetCalibration}>Reset Action Calibration</button>
      </div>
      {actions.error && <p role="alert" className="camera-error">{actions.error}</p>}
      <p className="pose-note">15초 전용 보정 · 준비 2초 → MOVE 1초 → HOLD 1.5초 · 동작 사이 Neutral 1초. 좌우는 본인의 신체 기준입니다. Mirror는 판정에 영향을 주지 않습니다.</p>
      <p className="pose-note">PREPARE/RETURN에서는 Neutral, MOVE에서는 표시된 자세로 이동하고 RECORDING 동안 유지하세요. 폰의 Calibration 화면에서도 안내를 볼 수 있습니다. Neutral 재보정 또는 Camera Stop 시 Action 보정도 초기화됩니다.</p>
      <div className="recorder-stage" role="status">
        <strong>Action Calibration: {calibration.status}</strong>
        {stage && <span>Current Stage: {stage.phase}</span>}
        {stage && <span className="recorder-label">{(stage.action ?? stage.nextAction)?.replaceAll('_', ' ')}</span>}
      </div>
      {stage && <p className="recorder-countdown">{(calibration.remainingMs / 1000).toFixed(1)}s remaining</p>}
      {stage?.phase === 'RETURN_NEUTRAL' && <p>기본 플랭크 자세로 돌아오세요. 이 구간은 수집하지 않습니다.</p>}
      {calibration.status === 'PARTIAL' && <p>HIP sample이 부족한 동작이 있습니다. 카메라/visibility를 확인하고 Start Action Calibration으로 다시 수집하세요.</p>}
      <h4>Action Prototypes</h4>
      <p className="pose-note">HIP 3개 feature에 각각 최소 {ACTION_MIN_SAMPLES} samples가 필요합니다. Knee는 해당 feature sample이 충분할 때만 사용합니다.</p>
      <table className="visibility-table" aria-label="Action prototype readiness">
        <thead><tr><th scope="col">Action</th><th scope="col">Status</th><th scope="col">HIP samples</th><th scope="col">LEFT KNEE</th><th scope="col">RIGHT KNEE</th></tr></thead>
        <tbody>{POSE_ACTIONS.map((action) => {
          const counts = calibration.sampleCounts[action];
          return <tr key={action}>
            <th scope="row">{action}</th><td>{calibration.prototypes[action] ? 'READY' : 'PARTIAL'}</td>
            <td>{Math.min(...ACTION_HIP_FEATURES.map((key) => counts[key]))}</td>
            <td>{counts.deltaLeftKneeRelativeX} / {counts.deltaLeftKneeRelativeY}</td>
            <td>{counts.deltaRightKneeRelativeX} / {counts.deltaRightKneeRelativeY}</td>
          </tr>;
        })}</tbody>
      </table>
      <p className="pose-note">Knee sample count는 X / Y 순서입니다.</p>
      <details>
        <summary>Prototype feature medians</summary>
        <div className="signal-table-scroll">
          <table className="visibility-table" aria-label="Action prototype values">
            <thead><tr><th scope="col">Feature</th>{POSE_ACTIONS.map((action) => <th key={action} scope="col">{action}</th>)}</tr></thead>
            <tbody>{ACTION_FEATURE_KEYS.map((key) => <tr key={key}>
              <th scope="row">{key}</th>{POSE_ACTIONS.map((action) => <td key={action}>{format(calibration.prototypes[action]?.features[key] ?? null)}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
      </details>
      <h4>Live Classification</h4>
      <dl className="pose-metrics" aria-label="Live action classification">
        <div><dt>Raw Action</dt><dd>{classification.rawAction}</dd></div>
        <div><dt>Stable Action</dt><dd>{classification.stableAction}</dd></div>
        <div><dt>Confidence</dt><dd>{classification.confidence.toFixed(3)}</dd></div>
        <div><dt>Reason</dt><dd>{classification.reason}</dd></div>
        <div><dt>Valid input</dt><dd>{classification.valid ? 'YES' : 'NO'}</dd></div>
        <div><dt>Neutral movement score</dt><dd>{format(classification.neutralMovementScore)}</dd></div>
        <div><dt>Best distance</dt><dd>{format(classification.bestDistance)}</dd></div>
        <div><dt>Second-best distance</dt><dd>{format(classification.secondBestDistance)}</dd></div>
      </dl>
      <table className="visibility-table" aria-label="Action distances">
        <thead><tr><th scope="col">Action</th><th scope="col">Normalized distance</th></tr></thead>
        <tbody>{POSE_ACTIONS.map((action) => <tr key={action}><th scope="row">{action}</th><td>{format(classification.actionDistances[action])}</td></tr>)}</tbody>
      </table>
      <p className="pose-note">250ms 표시 주기 · 초기 실험용 판정값입니다. Controller/폰에서 debug 상태를 확인합니다. 게임 입력으로 변환하지 않습니다.</p>
    </section>
  );
}
