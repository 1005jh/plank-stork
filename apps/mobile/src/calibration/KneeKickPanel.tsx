import { useEffect, useRef } from 'react';
import type { RemoteDetectorTestState, RemoteKneeKickState } from '@plank-stork/protocol';
import type { CalibrationCommand } from './useCalibrationRemote';

const instructions = { NEUTRAL: '기본 자세로 돌아와 유지하세요', TWIST_LEFT: '왼쪽 트위스트', TWIST_RIGHT: '오른쪽 트위스트', KNEE_LEFT: '왼쪽 니킥', KNEE_RIGHT: '오른쪽 니킥' };
export function KneeKickPanel({ detector, test, prerequisiteMessage, send }: {
  detector: RemoteKneeKickState; test: RemoteDetectorTestState; prerequisiteMessage: string | null; send: (command: CalibrationCommand) => void;
}) {
  const guide = useRef<HTMLDivElement>(null);
  const active = test.status === 'ACTIVE';
  const geometryMessage = !detector.validNow || (!detector.usableLeftNow && !detector.usableRightNow)
    ? 'POSE GEOMETRY NOT READY — 현재 Kick 입력을 사용할 수 없습니다. 몸 전체가 보이도록 기본 자세를 유지하세요.'
    : !detector.usableLeftNow ? 'LEFT KNEE NOT VISIBLE — 왼쪽 무릎을 카메라에서 확인 중입니다. 무릎이 보이도록 자세를 확인하세요.'
    : !detector.usableRightNow ? 'RIGHT KNEE NOT VISIBLE — 오른쪽 무릎을 카메라에서 확인 중입니다. 무릎이 보이도록 자세를 확인하세요.'
    : 'BOTH KNEES READY · Pose usable';
  const blockedReason = active ? 'Guided Detector Test가 진행 중입니다.' : prerequisiteMessage
    ?? (!detector.ready ? '양쪽 무릎이 보이는 Neutral을 보정하고 Detector READY를 확인하세요.'
    : null);
  useEffect(() => { if (active) guide.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); }, [active]);
  return <section className="calibration-card" aria-labelledby="mobile-kick-title">
    <h3 id="mobile-kick-title">Knee Kick Detector</h3>
    <div role="status">
      {detector.ready && detector.state === 'WAIT_RETURN' && <p>복귀 감지 중 · 테스트 시간은 계속 진행됩니다.</p>}
      {detector.ready && detector.state === 'CANDIDATE' && <p>KICK 후보 확인 중</p>}
      <p>{detector.ready ? 'READY' : 'NOT_READY'} · {detector.state}</p>
      <p>{geometryMessage}</p>
      <p className="major-instruction">{detector.currentEvent === 'KNEE_LEFT' ? 'LEFT KICK' : detector.currentEvent === 'KNEE_RIGHT' ? 'RIGHT KICK' : 'NONE'}</p>
      <p>LEFT: {detector.counts.KNEE_LEFT} · RIGHT: {detector.counts.KNEE_RIGHT}</p>
      {!detector.validNow && <p>Pose를 찾는 중... 현재 입력을 사용할 수 없습니다.</p>}
      {detector.lastEvent && <p>Last: #{detector.lastEvent.id} {detector.lastEvent.direction}</p>}
    </div>
    {!detector.ready && <p>양쪽 knee가 보이는 Neutral을 보정하세요. FROZEN 후에도 NOT_READY면 카메라 배치를 확인하고 다시 보정하세요.</p>}
    <button disabled={blockedReason !== null} aria-describedby="kick-start-reason" onClick={() => send('kick:test:start')}>Guided Detector Test 시작</button>
    <p id="kick-start-reason">{blockedReason ?? '보정 완료 · 현재 인식 상태와 관계없이 22초 테스트를 시작합니다.'}</p>
    {test.status !== 'IDLE' && <button className="secondary" onClick={() => send('kick:test:reset')}>Detector Test 초기화</button>}
    {active && <div className="action-guide" ref={guide} role="status">
      <p className="phase">Guided Detector Test</p>
      <p>{detector.ready ? 'READY' : 'NOT_READY'} · {detector.state}</p>
      <p>{geometryMessage}</p>
      {detector.state === 'CANDIDATE' && <p>KICK 후보 확인 중</p>}
      {!detector.validNow && <p>현재 입력 없음 · 타이머와 동작 안내는 계속 진행됩니다.</p>}
      <p className="major-instruction">{test.expected ? instructions[test.expected] : '-'}</p>
      {test.expected !== 'NEUTRAL' && <p>지금 이동해서 한 번 수행한 뒤 유지하세요.</p>}
      <p>총 22초 · 인식 누락도 결과에 기록합니다.</p>
      <p className="countdown">{(test.remainingMs / 1000).toFixed(1)}초</p>
      <p>Test events: {test.eventCount}</p>
    </div>}
    {test.summary && <div role="status">
      <p className="major-instruction">Detector Test 완료</p>
      <p>Twist false kicks L/R: {test.summary.TWIST_LEFT.falseKickCount} / {test.summary.TWIST_RIGHT.falseKickCount}</p>
      <p>Neutral false kicks: {test.summary.NEUTRAL.falseKickCount}</p>
      {(['KNEE_LEFT', 'KNEE_RIGHT'] as const).map((key) => <p key={key}>{key}: detected {String(test.summary![key].detected)} · direction {String(test.summary![key].directionCorrect ?? '-')} · duplicates {test.summary![key].duplicateCount}</p>)}
      <p>노트북에서 단계별 이벤트와 잘못된 방향을 확인하세요.</p>
    </div>}
  </section>;
}
