import type { useKneeKick } from '../pose/kick/useKneeKick';
import { Y_KICK_ENTER, Y_KICK_ENTER_DWELL_MS, Y_KICK_CLEAR_THRESHOLD, Y_KICK_CLEAR_DWELL_MS, Y_TRACKING_LOSS_MIN_MS } from '../pose/kick/kneeKickDetectorV3';

const number = (value: number | null) => value?.toFixed(3) ?? '-';
export function KneeKickDetectorPanel({ kick, canStart, onStart }: {
  kick: ReturnType<typeof useKneeKick>; canStart: boolean; onStart: () => void;
}) {
  const { detector, test, baselineCounts, baselineSealed, diagnosticsDownload, detectorMode, v3, legacyShadow } = kick.view;
  return <section className="features-panel" aria-labelledby="knee-kick-title">
    <h3 id="knee-kick-title">STEP 4I — Y V3 Live Knee Kick Detector</h3>
    <p>EXPERIMENTAL · mode {detectorMode} · Y ENTER {Y_KICK_ENTER.toFixed(2)} / {Y_KICK_ENTER_DWELL_MS}ms · CLEAR {Y_KICK_CLEAR_THRESHOLD} / {Y_KICK_CLEAR_DWELL_MS}ms · tracking loss {Y_TRACKING_LOSS_MIN_MS}ms</p>
    <div className="recorder-stage" role="status">
      <strong>{detector.ready ? 'READY' : 'NOT_READY'} · {detector.state}</strong>
      <span className="recorder-countdown">{detector.currentEvent.replaceAll('_', ' ')}</span>
      <span>{detector.validNow ? 'Current pose usable' : 'Pose unavailable / stale'}</span>
      <span>{!detector.validNow ? 'POSE GEOMETRY NOT READY' : !detector.usableLeftNow ? 'LEFT KNEE NOT VISIBLE' : !detector.usableRightNow ? 'RIGHT KNEE NOT VISIBLE' : 'BOTH KNEES READY'}</span>
      <span>LEFT event count: {detector.counts.KNEE_LEFT} · RIGHT event count: {detector.counts.KNEE_RIGHT}</span>
    </div>
    {!detector.ready && <p>Neutral 보정 중 양쪽 knee를 관찰해야 합니다. 유효 표본 L {baselineCounts.left} / R {baselineCounts.right} (각 20개 필요).
      {baselineSealed ? ' Baseline이 부족하거나 body scale이 너무 작습니다. 카메라 배치를 확인하고 Neutral을 다시 보정하세요.' : ' Neutral FROZEN 후 detector baseline을 고정합니다.'}</p>}
    <dl className="pose-metrics">
      <div><dt>Body scale</dt><dd>{number(detector.baseline?.bodyScale ?? null)}</dd></div>
      <div><dt>Normalized Y LEFT</dt><dd>{number(v3.normalizedYLeft)}</dd></div>
      <div><dt>Normalized Y RIGHT</dt><dd>{number(v3.normalizedYRight)}</dd></div>
      <div><dt>Tracking LEFT / RIGHT</dt><dd>{v3.leftTrackingState} / {v3.rightTrackingState}</dd></div>
      <div><dt>Enter run L / R (ms)</dt><dd>{number(v3.leftEnterRunMs)} / {number(v3.rightEnterRunMs)}</dd></div>
      <div><dt>Clear run L / R (ms)</dt><dd>{number(v3.leftClearRunMs)} / {number(v3.rightClearRunMs)}</dd></div>
      <div><dt>Last event</dt><dd>{detector.lastEvent ? `#${detector.lastEvent.id} ${detector.lastEvent.direction} @ ${detector.lastEvent.timestamp.toFixed(0)}ms` : '-'}</dd></div>
    </dl>
    <p>Y V3가 live event와 Guided 결과를 생성합니다. 방향은 신체의 LEFT/RIGHT knee 기준이며 Mirror와 무관합니다. 추적이 끊겨도 22초 안내는 계속 진행됩니다.</p>
    <details><summary>Legacy X shadow · reference only</summary>
      <p>State: {legacyShadow.state} · Normalized X L/R: {number(legacyShadow.normalizedLeft)} / {number(legacyShadow.normalizedRight)}</p>
      <p>Last event: {legacyShadow.lastEvent ? `#${legacyShadow.lastEvent.id} ${legacyShadow.lastEvent.direction}` : '-'} · Counts L/R: {legacyShadow.counts.KNEE_LEFT} / {legacyShadow.counts.KNEE_RIGHT}</p>
      <p>Last frame event agreement: {String(legacyShadow.eventAgreement)} · direction agreement: {String(legacyShadow.directionAgreement ?? '-')} · 불일치는 V3 실패 판정이 아닙니다.</p>
    </details>
    {detector.state === 'WAIT_RETURN' && <p>복귀 감지 중 · 테스트 시간은 계속 진행됩니다.</p>}
    {detector.state === 'CANDIDATE' && <p>KICK 후보 확인 중</p>}
    <h4>Guided Detector Test</h4>
    <div className="camera-controls">
      <button disabled={!canStart || test.status === 'ACTIVE'} onClick={onStart}>Start Guided Detector Test</button>
      <button onClick={kick.resetTest}>Reset Detector Test</button>
    </div>
    <p>Neutral 보정 완료 후 시작합니다. 폰 안내에 따라 동작을 한 번씩 수행하세요. Neutral 2초 / 각 동작 3초, 총 22초이며 인식 누락도 결과에 기록합니다. 다른 보정·검증 안내와 동시에 실행하지 마세요.</p>
    <div className="recorder-stage" role="status"><strong>Detector test: {test.status}</strong><span>{test.expected ?? '-'}</span>
      <span>{`${(test.remainingMs / 1000).toFixed(1)}s remaining`} · Events: {test.eventCount}</span></div>
    {test.summary && <>
      <p>TWIST_LEFT falseKickCount: {test.summary.TWIST_LEFT.falseKickCount} · TWIST_RIGHT falseKickCount: {test.summary.TWIST_RIGHT.falseKickCount} · NEUTRAL falseKickCount: {test.summary.NEUTRAL.falseKickCount}</p>
      {(['KNEE_LEFT', 'KNEE_RIGHT'] as const).map((key) => <p key={key}>{key}: detected {String(test.summary![key].detected)} · directionCorrect {String(test.summary![key].directionCorrect ?? '-')} · wrongEventCount {test.summary![key].wrongEventCount} · duplicateCount {test.summary![key].duplicateCount}</p>)}
      <div className="signal-table-scroll"><table className="visibility-table" aria-label="Detector test stages">
        <thead><tr><th>Stage</th><th>Events</th><th>Wrong</th><th>Duplicates</th></tr></thead>
        <tbody>{kick.stages.map((stage, index) => <tr key={index}><th>{index + 1}. {stage.expected}</th><td>{stage.events.map((event) => `#${event.id} ${event.direction}`).join(', ') || '-'}</td><td>{stage.wrongEventCount}</td><td>{stage.duplicateCount}</td></tr>)}</tbody>
      </table></div>
      <p>안내한 expected stage와 비교한 관찰 통계이며 자동 PASS/FAIL 판정은 없습니다.</p>
      <div className="signal-table-scroll"><table className="visibility-table" aria-label="Detector diagnostics">
        <thead><tr>{['Stage', 'Start State', 'Fresh / Total', 'Usable L / R', 'Max |Y|', 'Max |Y| while ARMED', 'Enter Margin', 'Events', 'Confirmation ms'].map((label) => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{kick.diagnostics.map((row) => <tr key={row.stageIndex}>
          <th>{row.stageIndex + 1}. {row.expected}</th><td>{row.stateAtStageStart ?? '-'}</td>
          <td>{row.freshFrames} / {row.totalFrames}</td><td>{row.leftUsableFrames} / {row.rightUsableFrames}</td>
          <td>{number(row.maxAbsDominantDisplacement)}</td><td>{number(row.maxAbsDominantWhileArmed)}</td><td>{number(row.enterMargin)}</td>
          <td>{row.eventCount}</td><td>{number(row.medianConfirmationLatencyMs)}</td>
        </tr>)}</tbody>
      </table></div>
      <p>Start State는 각 stage의 첫 inference 직전 상태입니다. Fresh는 현재 Kick geometry 기준이며 4A smoothing validity와 독립적입니다. 두 validity 비교·visibility·위치 통계는 JSON에서 확인하세요.</p>
    </>}
    {diagnosticsDownload && <p>Diagnostics: {diagnosticsDownload.status} · {diagnosticsDownload.frameCount} frames · {diagnosticsDownload.source === 'CURRENT' ? '현재 trial' : '보존된 이전 trial'}</p>}
    <button disabled={!diagnosticsDownload} onClick={kick.downloadDiagnostics}>Download Current Detector Diagnostics JSON</button>
    {kick.downloadError && <p className="camera-error" role="alert">{kick.downloadError}</p>}
  </section>;
}
