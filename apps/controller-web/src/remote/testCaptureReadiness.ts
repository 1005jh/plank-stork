import type { RemoteCaptureReadinessState } from '@plank-stork/protocol';
import { ESTIMATOR_VALIDATION_PROTOCOL_V1 as P } from '../capture/estimatorValidationProtocol';

export function captureReadinessFixture(overrides: Partial<RemoteCaptureReadinessState> = {}): RemoteCaptureReadinessState {
  return {
    captureRecording: false, estimatorNeutralStatus: 'NOT_REQUIRED',
    analysisReadyFrameCount: 0, requiredFrameCount: P.neutralReferenceMinUsableFrames,
    perJointUsableFrames: Object.fromEntries(P.requiredJoints.map((name) => [name, 0])) as RemoteCaptureReadinessState['perJointUsableFrames'],
    missingJoints: [], allJointsReadyNow: false, guidedStartAllowed: true,
    ...overrides,
  };
}
