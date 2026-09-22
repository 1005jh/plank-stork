import { useEffect, useRef } from 'react';
import type { CalibrationAction, CalibrationRemoteState } from '@plank-stork/protocol';
import type { CalibrationCommand } from './useCalibrationRemote';

const ACTIONS: CalibrationAction[] = ['TWIST_LEFT', 'TWIST_RIGHT', 'KNEE_LEFT', 'KNEE_RIGHT'];
const LABELS: Record<CalibrationAction, string> = {
  TWIST_LEFT: '← 왼쪽 트위스트', TWIST_RIGHT: '오른쪽 트위스트 →',
  KNEE_LEFT: '← 왼쪽 니킥', KNEE_RIGHT: '오른쪽 니킥 →',
};
const ERRORS = {
  CAMERA_NOT_READY: '카메라 준비 필요 — 노트북에서 Start Camera를 눌러주세요.',
  POSE_NOT_DETECTED: 'Pose not detected — 몸 전체가 카메라에 보이도록 이동하세요.',
  NEUTRAL_NOT_FROZEN: '기본 자세 보정을 먼저 완료하세요.',
};
const number = (value: number | null | undefined) => value?.toFixed(3) ?? '-';

export function CalibrationPanel({ state, connected, send }: {
  state: CalibrationRemoteState | null;
  connected: boolean;
  send: (command: CalibrationCommand) => void;
}) {
  const guideRef = useRef<HTMLDivElement>(null);
  const activeGuide = connected && state?.actionCalibration.status === 'ACTIVE';
  useEffect(() => {
    if (activeGuide) guideRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [activeGuide]);
  if (!connected || !state) return (
    <section className="calibration-card" aria-labelledby="remote-title">
      <h2 id="remote-title">Calibration Remote</h2>
      <p className="major-instruction" role="status">연결 대기</p>
      <p>노트북의 controller-web과 Socket 연결을 확인하세요.</p>
      <button disabled>Neutral 보정 시작</button>
      <button disabled>동작 보정 시작</button>
    </section>
  );

  const { controller, neutral, actionCalibration: action, classification } = state;
  const collectingNeutral = neutral.collectionState === 'HIP' || neutral.collectionState === 'FINISHING';
  const active = action.status === 'ACTIVE';
  const complete = action.status === 'COMPLETED';
  const allReady = ACTIONS.every((key) => action.readiness[key]);
  const poseStale = !controller.poseDetected || classification?.reason === 'POSE_STALE';
  const stable = classification?.stableAction ?? 'NONE';
  return (
    <section aria-labelledby="remote-title">
      <h2 id="remote-title">Calibration Remote</h2>
      <div className="calibration-card">
        <div className="device-status">
          <p>카메라 <strong>{controller.cameraRunning ? 'RUNNING' : '카메라 준비 필요'}</strong></p>
          <p>Pose <strong>{controller.poseDetected ? 'DETECTED' : 'NOT DETECTED'}</strong></p>
        </div>
        {!controller.cameraRunning && <p>노트북에서 Start Camera를 눌러주세요.</p>}
        {state.lastCommandError && <p role="alert">{ERRORS[state.lastCommandError]}</p>}
      </div>

      <section className="calibration-card" aria-labelledby="neutral-title">
        <h3 id="neutral-title">1. 기본 자세 보정</h3>
        <button disabled={!controller.cameraRunning || !controller.poseDetected || collectingNeutral}
          onClick={() => send('calibration:neutral:start')}>
          {neutral.frozen ? 'Neutral 다시 보정' : 'Neutral 보정 시작'}
        </button>
        <div role="status">
          {neutral.collectionState === 'HIP' && <p className="major-instruction">기본 플랭크 자세를 유지하세요</p>}
          {neutral.collectionState === 'FINISHING' && <>
            <p className="major-instruction">HIP 보정 완료</p>
            <p>기본 자세를 조금만 더 유지하세요</p>
            <p className="countdown">{(neutral.kneeGraceRemainingMs / 1000).toFixed(1)}초</p>
          </>}
          {neutral.frozen && <p className="success">기본 자세 보정 완료 ✓</p>}
        </div>
        <ul className="readiness">
          <li>HIP <strong>{neutral.hipSamples} / 20 {neutral.hipReady ? 'READY' : 'PARTIAL'}</strong></li>
          <li>LEFT KNEE <strong>{neutral.leftKneeSamples} / 20 {neutral.leftKneeReady ? 'READY' : 'PARTIAL'}</strong></li>
          <li>RIGHT KNEE <strong>{neutral.rightKneeSamples} / 20 {neutral.rightKneeReady ? 'READY' : 'PARTIAL'}</strong></li>
        </ul>
        {neutral.frozen && (!neutral.leftKneeReady || !neutral.rightKneeReady) && <p>Knee PARTIAL이어도 다음 보정을 진행할 수 있습니다.</p>}
      </section>

      <section className="calibration-card" aria-labelledby="action-title">
        <h3 id="action-title">2. 동작 보정</h3>
        <p>LEFT / RIGHT는 본인의 신체 기준입니다. Mirror와 관계없습니다.</p>
        {!neutral.frozen && <p>기본 자세 보정을 먼저 완료하세요.</p>}
        {action.status === 'IDLE' && neutral.frozen && <p>동작 보정 필요</p>}
        <button disabled={!controller.cameraRunning || !neutral.frozen || active} onClick={() => send('calibration:action:start')}>
          {complete ? '다시 보정' : '동작 보정 시작'}
        </button>
        {action.status !== 'IDLE' && <button className="secondary" onClick={() => send('calibration:action:reset')}>동작 보정 초기화</button>}
        {active && <div ref={guideRef} className="action-guide" role="status">
          <p className="phase">{action.phase === 'RECORD' ? 'RECORD / HOLD' : action.phase}</p>
          {action.phase === 'PREPARE' && <p className="major-instruction">기본 플랭크 자세를 유지하세요</p>}
          {action.phase === 'RETURN_NEUTRAL' && <p className="major-instruction">기본 플랭크 자세로 돌아오세요</p>}
          {(action.phase === 'MOVE' || action.phase === 'RECORD') && <>
            <p className="major-instruction">{action.action ? LABELS[action.action] : '-'}</p>
            <p className="major-instruction">{action.phase === 'MOVE' ? '자세로 이동하세요' : '그대로 유지하세요'}</p>
          </>}
          <p className="countdown">{(action.remainingMs / 1000).toFixed(1)}초</p>
          {poseStale && <p>Pose를 찾는 중... 몸 전체가 카메라에 보이는지 확인하세요.</p>}
        </div>}
        {complete && <>
          <p className="major-instruction">{allReady ? '동작 보정 완료 ✓' : '동작 보정 종료 — 다시 보정이 필요합니다'}</p>
          <ul className="readiness">{ACTIONS.map((key) => <li key={key}>{key.replaceAll('_', ' ')} <strong>{action.readiness[key] ? 'READY' : 'RETRY NEEDED'}</strong></li>)}</ul>
        </>}
      </section>

      {complete && <section className="calibration-card" aria-labelledby="live-title">
        <h3 id="live-title">현재 동작 · Live Classification</h3>
        <p className="major-instruction" role="status">
          {!controller.cameraRunning ? '카메라 준비 필요' : poseStale ? 'Pose를 찾는 중... · POSE STALE' : !allReady ? '동작 보정 필요' :
            stable === 'NONE' ? (classification?.reason === 'OK' ? 'NEUTRAL' : 'NONE · 동작 확인 중') : stable.replaceAll('_', ' ')}
        </p>
        {classification && <>
          <dl className="classification-debug">
            <dt>Raw</dt><dd>{poseStale ? 'NONE' : classification.rawAction}</dd>
            <dt>Stable</dt><dd>{poseStale ? 'NONE' : classification.stableAction}</dd>
            <dt>Confidence</dt><dd>{poseStale ? '-' : classification.confidence.toFixed(2)}</dd>
            <dt>Reason</dt><dd>{poseStale ? 'POSE_STALE' : classification.reason}</dd>
          </dl>
          <details><summary>거리 debug</summary><dl className="classification-debug">
            <dt>Neutral Score</dt><dd>{number(classification.neutralMovementScore)}</dd>
            <dt>Best Distance</dt><dd>{number(classification.bestDistance)}</dd>
            <dt>Second Distance</dt><dd>{number(classification.secondBestDistance)}</dd>
            {ACTIONS.map((key) => <div className="distance-row" key={key}><dt>{key} distance</dt><dd>{number(classification.actionDistances[key])}</dd></div>)}
          </dl></details>
        </>}
      </section>}
    </section>
  );
}
