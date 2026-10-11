import type { RemoteCaptureJoint, RemoteCaptureReadinessState, RemoteDetectorTestState } from '@plank-stork/protocol';

const JOINT_LABELS: Record<RemoteCaptureJoint, string> = {
  LEFT_SHOULDER: '왼쪽 어깨', RIGHT_SHOULDER: '오른쪽 어깨',
  LEFT_HIP: '왼쪽 골반', RIGHT_HIP: '오른쪽 골반',
  LEFT_KNEE: '왼쪽 무릎', RIGHT_KNEE: '오른쪽 무릎',
  LEFT_ANKLE: '왼쪽 발목', RIGHT_ANKLE: '오른쪽 발목',
};

export function EstimatorNeutralPanel({ capture, neutralFrozen, testStatus, canStartGuided }: {
  capture: RemoteCaptureReadinessState;
  neutralFrozen: boolean;
  testStatus: RemoteDetectorTestState['status'];
  canStartGuided: boolean;
}) {
  if (!capture.captureRecording) return null;
  const ready = capture.estimatorNeutralStatus === 'READY';
  const active = testStatus === 'ACTIVE';
  return <div aria-label="분석용 Neutral">
    <div role="status">
      {ready ? <p className="success">분석용 Neutral READY ✓</p> : active ? <p>분석용 Neutral: {capture.estimatorNeutralStatus}</p> : <>
        {neutralFrozen && !active && <p className="major-instruction">기본 자세를 계속 유지하세요</p>}
        <p>{capture.estimatorNeutralStatus === 'NOT_STARTED' ? '분석용 Neutral 수집 전 — 기본 자세 보정을 시작하세요.' : '분석용 Neutral 수집 중'}</p>
      </>}
      <p>분석용 Neutral: {capture.analysisReadyFrameCount} / {capture.requiredFrameCount}</p>
      {active ? <p>Guided Test 진행 중 · 타이머와 동작 안내는 계속 진행됩니다.</p>
        : ready && canStartGuided ? <p>Guided Detector Test를 시작할 수 있습니다.</p> : null}
      {!active && !ready && (capture.missingJoints.length > 0 ? <>
        <p>현재 확인 필요:</p>
        <ul>{capture.missingJoints.map((joint) => <li key={joint}>{JOINT_LABELS[joint]}</li>)}</ul>
      </> : capture.allJointsReadyNow && capture.analysisReadyFrameCount < capture.requiredFrameCount
        ? <p>현재 자세는 잘 인식되고 있습니다. 조금만 더 유지하세요.</p> : null)}
    </div>
    <details>
      <summary>관절별 수집 frame · debug</summary>
      <ul>{(Object.keys(capture.perJointUsableFrames) as RemoteCaptureJoint[]).map((joint) =>
        <li key={joint}>{joint.replaceAll('_', ' ')}: {capture.perJointUsableFrames[joint]} / {capture.requiredFrameCount}</li>)}</ul>
      <p>현재 확인 필요: {capture.missingJoints.length ? capture.missingJoints.map((joint) => JOINT_LABELS[joint]).join(', ') : '없음'}</p>
    </details>
  </div>;
}
