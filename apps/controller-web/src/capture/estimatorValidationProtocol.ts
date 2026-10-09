export const ESTIMATOR_VALIDATION_PROTOCOL_V1 = Object.freeze({
  id: 'STEP_4P_ESTIMATOR_HOLDOUT_V1', mediaIdentity: 'SHA-256', neutralReferenceWindowMs: 3000, neutralReferenceMinUsableFrames: 60,
  requiredJoints: Object.freeze(['LEFT_SHOULDER', 'RIGHT_SHOULDER', 'LEFT_HIP', 'RIGHT_HIP', 'LEFT_KNEE', 'RIGHT_KNEE', 'LEFT_ANKLE', 'RIGHT_ANKLE'] as const),
  visibility: Object.freeze({ shoulder: .5, hip: .7, knee: .5, ankle: .5 }),
  estimatorVariants: Object.freeze(['FULL_VIDEO_CONTROL', 'FULL_IMAGE', 'HEAVY_VIDEO'] as const),
  detectorComparisons: Object.freeze(['PRODUCTION_Y_V3', 'FIXED_REFERENCE'] as const), thresholdTuningAllowed: false,
  cameraPlacement: 'Existing foot-side placement; no new angle search.',
  nextAttempt: 'Start Camera -> Start Replay Capture -> Calibrate Neutral -> Estimator Neutral READY -> Guided Test once -> Stop Capture -> ARTIFACT_READY -> save WebM and JSON. Retain every attempt, including failures; do not select only the best outcome.',
} as const);
export type RequiredJoint = typeof ESTIMATOR_VALIDATION_PROTOCOL_V1.requiredJoints[number];
export const REQUIRED_JOINTS: readonly { name: RequiredJoint; index: number; threshold: number }[] = Object.freeze(
  ESTIMATOR_VALIDATION_PROTOCOL_V1.requiredJoints.map((name, i) => Object.freeze({ name, index: [11, 12, 23, 24, 25, 26, 27, 28][i], threshold: i === 2 || i === 3 ? .7 : .5 })));
export type JointCounts = Record<RequiredJoint, number>;
export interface EstimatorNeutralReference {
  protocolId: typeof ESTIMATOR_VALIDATION_PROTOCOL_V1.id;
  calibrationStartMs: number; startMs: number; endMs: number; durationMs: 3000; readyAtMs: number;
  analysisReadyFrameCount: number; perJointUsableFrames: JointCounts; poseFrameCount: number;
  thresholds: typeof ESTIMATOR_VALIDATION_PROTOCOL_V1.visibility;
}
export interface CaptureValidation {
  protocolId: typeof ESTIMATOR_VALIDATION_PROTOCOL_V1.id;
  mediaIntegrityReady: boolean; estimatorReferenceReady: boolean; trialHasEstimatorReference: boolean; guidedTrialCompleted: boolean;
  status: 'VALIDATION_CAPTURE_COMPLETE' | 'INCOMPLETE';
  invalidReasons: string[];
}
