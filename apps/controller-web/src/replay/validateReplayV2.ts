import { ESTIMATOR_VALIDATION_PROTOCOL_V1 as P } from '../capture/estimatorValidationProtocol';
import type { ReplaySession } from './replayTypes';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const count = (v: unknown): v is number => finite(v) && Number.isInteger(v) && v >= 0;
const hex = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
/** V2 exports must already be finalized. Incomplete experiments remain readable, with explicit status. */
export function validateReplayV2(session: ReplaySession) {
  const m = session.video.integrity, v = session.validation;
  if (!m || m.algorithm !== 'SHA-256' || !hex(m.sha256) || !hex(m.timestampHash) || !count(m.byteLength) || m.byteLength === 0 ||
    !count(m.decodedFrameCount) || m.decodedFrameCount === 0 || !finite(m.firstPtsMs) || m.firstPtsMs < 0 ||
    !finite(m.lastPtsMs) || m.lastPtsMs < m.firstPtsMs || (m.decodedFrameCount > 1 && m.lastPtsMs === m.firstPtsMs) ||
    !count(m.decodedWidth) || !count(m.decodedHeight) || m.decodedWidth <= 0 || m.decodedHeight <= 0 ||
    m.decodedWidth !== session.video.width || m.decodedHeight !== session.video.height || !Number.isFinite(Date.parse(m.finalizedAt))) throw new Error('Invalid V2 media integrity');
  if (typeof session.attemptId !== 'string' || !session.attemptId || !v || v.protocolId !== P.id ||
    !['mediaIntegrityReady', 'estimatorReferenceReady', 'trialHasEstimatorReference', 'guidedTrialCompleted'].every((key) => typeof v[key as keyof typeof v] === 'boolean') ||
    !v.mediaIntegrityReady || !Array.isArray(v.invalidReasons) || !v.invalidReasons.every((r) => typeof r === 'string')) throw new Error('Invalid V2 validation metadata');
  for (const trial of session.liveResult.trials) {
    const r = trial.estimatorNeutralReference;
    if (!r) {
      if (trial.validationStatus !== 'INVALID_MISSING_ESTIMATOR_REFERENCE' || !v.invalidReasons.includes('INVALID_MISSING_ESTIMATOR_REFERENCE')) throw new Error('Missing V2 reference status');
      continue;
    }
    const latestStart = session.markers.filter((m) => m.type === 'NEUTRAL_CALIBRATION_START' && m.tMs <= trial.startMs).at(-1);
    if (trial.validationStatus !== 'REFERENCE_READY' || r.protocolId !== P.id || !finite(r.calibrationStartMs) || r.calibrationStartMs < 0 ||
      !finite(r.startMs) || !finite(r.endMs) || r.durationMs !== 3000 || r.endMs - r.startMs !== 3000 || r.readyAtMs !== r.endMs ||
      r.startMs < r.calibrationStartMs || r.endMs > trial.startMs || latestStart?.tMs !== r.calibrationStartMs ||
      !count(r.poseFrameCount) || !count(r.analysisReadyFrameCount) || r.analysisReadyFrameCount < 60 || r.analysisReadyFrameCount > r.poseFrameCount ||
      !P.requiredJoints.every((j) => count(r.perJointUsableFrames?.[j]) && r.perJointUsableFrames[j] >= r.analysisReadyFrameCount && r.perJointUsableFrames[j] <= r.poseFrameCount) ||
      !Object.entries(P.visibility).every(([key, value]) => r.thresholds?.[key as keyof typeof r.thresholds] === value)) throw new Error('Invalid V2 estimator reference');
  }
  const trials = session.liveResult.trials;
  const hasReferences = trials.length > 0 && trials.every((t) => !!t.estimatorNeutralReference);
  const completed = trials.length > 0 && trials.every((t) => session.markers.some((m) => m.type === 'GUIDED_TEST_COMPLETE' && m.trialId === t.id));
  const complete = v.mediaIntegrityReady && v.estimatorReferenceReady && hasReferences && completed && !v.invalidReasons.length;
  if (v.trialHasEstimatorReference !== hasReferences || v.guidedTrialCompleted !== completed ||
      v.status !== (complete ? 'VALIDATION_CAPTURE_COMPLETE' : 'INCOMPLETE')) throw new Error('Inconsistent V2 validation status');
}
