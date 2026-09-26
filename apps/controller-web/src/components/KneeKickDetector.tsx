import type { useKneeKick } from '../pose/kick/useKneeKick';
import { KICK_ENTER_DISPLACEMENT, KICK_EXIT_DISPLACEMENT, RETURN_DWELL_MS } from '../pose/kick/kneeKickDetector';

const number = (value: number | null) => value?.toFixed(3) ?? '-';
export function KneeKickDetectorPanel({ kick, canStart, onStart }: {
  kick: ReturnType<typeof useKneeKick>; canStart: boolean; onStart: () => void;
}) {
  const { detector, test, baselineCounts, baselineSealed } = kick.view;
  return <section className="features-panel" aria-labelledby="knee-kick-title">
    <h3 id="knee-kick-title">STEP 4E — Knee Kick Detector</h3>
    <p>Experimental · ENTER {KICK_ENTER_DISPLACEMENT} / EXIT {KICK_EXIT_DISPLACEMENT} / return {RETURN_DWELL_MS}ms</p>
    <div className="recorder-stage" role="status">
      <strong>{detector.ready ? 'READY' : 'NOT_READY'} · {detector.state}</strong>
      <span className="recorder-countdown">{detector.currentEvent.replaceAll('_', ' ')}</span>
      <span>{detector.validNow ? 'Current pose usable' : 'Pose unavailable / stale'}</span>
      <span>LEFT event count: {detector.counts.KNEE_LEFT} · RIGHT event count: {detector.counts.KNEE_RIGHT}</span>
    </div>
    {!detector.ready && <p>Neutral 보정 중 양쪽 knee를 관찰해야 합니다. 유효 표본 L {baselineCounts.left} / R {baselineCounts.right} (각 20개 필요).
      {baselineSealed ? ' Baseline이 부족하거나 body scale이 너무 작습니다. 카메라 배치를 확인하고 Neutral을 다시 보정하세요.' : ' Neutral FROZEN 후 detector baseline을 고정합니다.'}</p>}
    <dl className="pose-metrics">
      <div><dt>Body scale</dt><dd>{number(detector.baseline?.bodyScale ?? null)}</dd></div>
      <div><dt>LEFT displacement</dt><dd>{number(detector.normalizedLeft)}</dd></div>
      <div><dt>RIGHT displacement</dt><dd>{number(detector.normalizedRight)}</dd></div>
      <div><dt>Dominant displacement</dt><dd>{number(detector.dominantNormalizedDisplacement)}</dd></div>
      <div><dt>Normalized velocity L/R</dt><dd>{number(detector.normalizedLeftVelocity)} / {number(detector.normalizedRightVelocity)}</dd></div>
      <div><dt>Last event</dt><dd>{detector.lastEvent ? `#${detector.lastEvent.id} ${detector.lastEvent.direction} @ ${detector.lastEvent.timestamp.toFixed(0)}ms` : '-'}</dd></div>
    </dl>
    <p>음수는 KNEE_LEFT, 양수는 KNEE_RIGHT 후보입니다. Landmark 이름이나 Mirror로 방향을 바꾸지 않습니다. 큰 이벤트 표시는 0.8초 표시이며 새 이벤트를 의미하는 ID/count는 한 번만 증가합니다.</p>
    <h4>Guided Detector Test</h4>
    <div className="camera-controls">
      <button disabled={!canStart || test.status === 'ACTIVE'} onClick={onStart}>Start Guided Detector Test</button>
      <button onClick={kick.resetTest}>Reset Detector Test</button>
    </div>
    <p>폰 안내에 따라 동작을 한 번씩 수행하세요. Neutral 2초 / 각 동작 3초, 총 22초입니다. 다른 보정·검증 안내와 동시에 실행하지 마세요.</p>
    <div className="recorder-stage" role="status"><strong>Detector test: {test.status}</strong><span>{test.expected ?? '-'}</span>
      <span>{(test.remainingMs / 1000).toFixed(1)}s remaining · Events: {test.eventCount}</span></div>
    {test.summary && <>
      <p>TWIST_LEFT falseKickCount: {test.summary.TWIST_LEFT.falseKickCount} · TWIST_RIGHT falseKickCount: {test.summary.TWIST_RIGHT.falseKickCount} · NEUTRAL falseKickCount: {test.summary.NEUTRAL.falseKickCount}</p>
      {(['KNEE_LEFT', 'KNEE_RIGHT'] as const).map((key) => <p key={key}>{key}: detected {String(test.summary![key].detected)} · directionCorrect {String(test.summary![key].directionCorrect ?? '-')} · wrongEventCount {test.summary![key].wrongEventCount} · duplicateCount {test.summary![key].duplicateCount}</p>)}
      <div className="signal-table-scroll"><table className="visibility-table" aria-label="Detector test stages">
        <thead><tr><th>Stage</th><th>Events</th><th>Wrong</th><th>Duplicates</th></tr></thead>
        <tbody>{kick.stages.map((stage, index) => <tr key={index}><th>{index + 1}. {stage.expected}</th><td>{stage.events.map((event) => `#${event.id} ${event.direction}`).join(', ') || '-'}</td><td>{stage.wrongEventCount}</td><td>{stage.duplicateCount}</td></tr>)}</tbody>
      </table></div>
      <p>안내한 expected stage와 비교한 관찰 통계이며 자동 PASS/FAIL 판정은 없습니다.</p>
    </>}
  </section>;
}
