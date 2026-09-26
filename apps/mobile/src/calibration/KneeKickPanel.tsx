import { useEffect, useRef } from 'react';
import type { RemoteDetectorTestState, RemoteKneeKickState } from '@plank-stork/protocol';
import type { CalibrationCommand } from './useCalibrationRemote';

const instructions = { NEUTRAL: '기본 자세로 돌아와 유지하세요', TWIST_LEFT: '왼쪽 트위스트', TWIST_RIGHT: '오른쪽 트위스트', KNEE_LEFT: '왼쪽 니킥', KNEE_RIGHT: '오른쪽 니킥' };
export function KneeKickPanel({ detector, test, canStart, send }: {
  detector: RemoteKneeKickState; test: RemoteDetectorTestState; canStart: boolean; send: (command: CalibrationCommand) => void;
}) {
  const guide = useRef<HTMLDivElement>(null);
  const active = test.status === 'ACTIVE';
  useEffect(() => { if (active) guide.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); }, [active]);
  return <section className="calibration-card" aria-labelledby="mobile-kick-title">
    <h3 id="mobile-kick-title">Knee Kick Detector</h3>
    <div role="status">
      <p>{detector.ready ? 'READY' : 'NOT_READY'} · {detector.state}</p>
      <p className="major-instruction">{detector.currentEvent === 'KNEE_LEFT' ? 'LEFT KICK' : detector.currentEvent === 'KNEE_RIGHT' ? 'RIGHT KICK' : 'NONE'}</p>
      <p>LEFT: {detector.counts.KNEE_LEFT} · RIGHT: {detector.counts.KNEE_RIGHT}</p>
      {!detector.validNow && <p>Pose를 찾는 중... 현재 입력을 사용할 수 없습니다.</p>}
      {detector.lastEvent && <p>Last: #{detector.lastEvent.id} {detector.lastEvent.direction}</p>}
    </div>
    {!detector.ready && <p>양쪽 knee가 보이는 Neutral을 보정하세요. FROZEN 후에도 NOT_READY면 카메라 배치를 확인하고 다시 보정하세요.</p>}
    <button disabled={!canStart || active} onClick={() => send('kick:test:start')}>Guided Detector Test 시작</button>
    {test.status !== 'IDLE' && <button className="secondary" onClick={() => send('kick:test:reset')}>Detector Test 초기화</button>}
    {active && <div className="action-guide" ref={guide} role="status">
      <p className="phase">Guided Detector Test</p>
      <p className="major-instruction">{test.expected ? instructions[test.expected] : '-'}</p>
      {test.expected !== 'NEUTRAL' && <p>지금 이동해서 한 번 수행한 뒤 유지하세요.</p>}
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
