import { useEffect, useRef } from 'react';
import type { CalibrationAction, RemoteValidationState } from '@plank-stork/protocol';
import type { CalibrationCommand } from './useCalibrationRemote';

const labels: Record<CalibrationAction, string> = {
  TWIST_LEFT: '← 왼쪽 트위스트', TWIST_RIGHT: '오른쪽 트위스트 →',
  KNEE_LEFT: '← 왼쪽 니킥', KNEE_RIGHT: '오른쪽 니킥 →',
};

export function ValidationPanel({ validation, canStart, send }: {
  validation: RemoteValidationState; canStart: boolean; send: (command: CalibrationCommand) => void;
}) {
  const guide = useRef<HTMLDivElement>(null);
  const active = validation.status === 'ACTIVE';
  useEffect(() => { if (active) guide.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); }, [active]);
  const action = validation.expectedAction;
  return <section className="calibration-card" aria-labelledby="mobile-validation-title">
    <h3 id="mobile-validation-title">3. 동작 검증 · Signal Validation</h3>
    <p>LEFT / RIGHT는 본인의 신체 기준입니다. 보정과 별개로 반복 동작을 21.5초 동안 측정합니다.</p>
    {!canStart && !active && <p>기본 자세 FROZEN 및 네 동작 prototype READY가 필요합니다.</p>}
    <button disabled={!canStart || active} onClick={() => send('validation:start')}>
      {validation.status === 'COMPLETED' ? '다시 검증' : '동작 검증 시작'}
    </button>
    {validation.status !== 'IDLE' && <button className="secondary" onClick={() => send('validation:reset')}>검증 초기화</button>}
    {active && <div className="action-guide validation-guide" ref={guide} role="status">
      <p className="phase">{validation.phase}</p>
      {validation.phase === 'PREPARE' && <><p className="major-instruction">동작 검증을 시작합니다</p><p>기본 플랭크 자세를 유지하세요</p></>}
      {validation.phase === 'RECORD_NEUTRAL' && <p className="major-instruction">기본 자세를 유지하세요</p>}
      {validation.phase === 'RETURN_NEUTRAL' && <p className="major-instruction">기본 플랭크 자세로 돌아오세요</p>}
      {(validation.phase === 'MOVE' || validation.phase === 'RECORD_ACTION') && <>
        <p className="major-instruction">{action && action !== 'NONE' ? labels[action] : '-'}</p>
        <p className="major-instruction">{validation.phase === 'MOVE' ? '자세로 이동하세요' : '그대로 유지하세요'}</p>
      </>}
      <p className="countdown">{(validation.remainingMs / 1000).toFixed(1)}초</p>
      <p>Recorded frames: {validation.recordedFrames}</p>
    </div>}
    {validation.status === 'COMPLETED' && <div role="status">
      <p className="major-instruction">동작 검증 기록 완료</p>
      <p>{validation.recordedFrames} frames · Laptop에서 Summary를 확인하고 Download Validation JSON을 누르세요.</p>
    </div>}
  </section>;
}
