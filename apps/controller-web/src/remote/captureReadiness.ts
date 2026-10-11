import type { RemoteCaptureReadinessState } from '@plank-stork/protocol';
import { ESTIMATOR_VALIDATION_PROTOCOL_V1 as P } from '../capture/estimatorValidationProtocol';
import type { ReplayCapture } from '../replay/replayCapture';

/** Project the existing capture view; never infer readiness from counts or current visibility. */
export function captureReadinessSnapshot(view: ReturnType<ReplayCapture['getView']>): RemoteCaptureReadinessState {
  const captureRecording = view.artifactState === 'RECORDING';
  const { readiness } = view;
  return {
    captureRecording,
    estimatorNeutralStatus: captureRecording ? readiness.status : 'NOT_REQUIRED',
    analysisReadyFrameCount: readiness.analysisReadyFrameCount,
    requiredFrameCount: P.neutralReferenceMinUsableFrames,
    perJointUsableFrames: Object.fromEntries(P.requiredJoints.map((name) => [name, readiness.perJointUsableFrames[name]])) as RemoteCaptureReadinessState['perJointUsableFrames'],
    missingJoints: P.requiredJoints.filter((name) => readiness.current.some((joint) => joint.name === name && !joint.usable)),
    allJointsReadyNow: readiness.allReadyNow,
    guidedStartAllowed: view.guidedStartAllowed,
  };
}
