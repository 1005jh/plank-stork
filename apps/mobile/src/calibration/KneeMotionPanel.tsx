import { useEffect, useRef } from 'react';
import type { CalibrationAction, RemoteMotionValidationState } from '@plank-stork/protocol';
import type { CalibrationCommand } from './useCalibrationRemote';

const labels: Record<CalibrationAction, string> = {
  TWIST_LEFT: '← 왼쪽 트위스트', TWIST_RIGHT: '오른쪽 트위스트 →', KNEE_LEFT: '← 왼쪽 니킥', KNEE_RIGHT: '오른쪽 니킥 →',
};
export function KneeMotionPanel({ motion, canStart, send }: {
  motion: RemoteMotionValidationState; canStart: boolean; send: (command: CalibrationCommand) => void;
}) {
  const guide = useRef<HTMLDivElement>(null);
  const active = motion.status === 'ACTIVE';
  useEffect(() => { if (active) guide.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); }, [active]);
  const action = motion.expectedMotion;
  return <section className="calibration-card" aria-labelledby="mobile-motion-title">
    <h3 id="mobile-motion-title">Knee Motion Validation</h3>
    <p>Neutral 보정 후 바로 시작합니다. Action Calibration은 필요하지 않습니다. 좌우는 본인 신체 기준입니다.</p>
    <button disabled={!canStart || active} onClick={() => send('motion:validation:start')}>Knee Motion Validation 시작</button>
    {!canStart && !active && <p>카메라와 Pose를 확인하고 Neutral FROZEN까지 완료하세요.</p>}
    {motion.status !== 'IDLE' && <button className="secondary" onClick={() => send('motion:validation:reset')}>Motion 검증 초기화</button>}
    {active && <div className="action-guide knee-motion-guide" ref={guide} role="status">
      <p className="phase">{motion.phase}</p>
      {(motion.phase === 'PREPARE' || motion.phase === 'NEUTRAL') && <p className="major-instruction">기본 자세를 유지하세요</p>}
      {motion.phase === 'RETURN' && <p className="major-instruction">기본 자세로 돌아오세요</p>}
      {(motion.phase === 'MOVE' || motion.phase === 'HOLD') && <>
        <p className="major-instruction">{action && action !== 'NEUTRAL' ? labels[action] : '-'}</p>
        <p className="major-instruction">{motion.phase === 'MOVE' ? '자세로 이동하세요' : '유지하세요'}</p>
      </>}
      <p className="countdown">{(motion.remainingMs / 1000).toFixed(1)}초</p>
      <p>Recorded frames: {motion.recordedFrames}</p>
    </div>}
    {motion.status === 'COMPLETED' && <div role="status">
      <p className="major-instruction">Motion 검증 기록 완료</p>
      <p>{motion.recordedFrames} frames · Laptop에서 Download Motion Validation JSON을 누르세요. 판정 결과가 아닌 측정 기록입니다.</p>
    </div>}
  </section>;
}
