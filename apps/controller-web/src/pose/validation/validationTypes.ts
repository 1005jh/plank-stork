import type { PoseDelegate } from '../createPoseLandmarker';
import type { ActionClassification, ActionFeatureKey, ActionPrototypes, ActionSampleCounts, PoseAction, PoseActionState, PoseActionView } from '../actions/poseActionTypes';
import type { CalibratedPoseFeatures, NeutralCalibration, PoseFeatures, PoseFeatureView, SmoothedPoseFeatures } from '../features/poseFeatureTypes';
import type { RecordedLandmark } from '../../recorder/poseRecorderTypes';

export interface ValidationStage {
  phase: 'PREPARE' | 'RECORD_NEUTRAL' | 'MOVE' | 'RECORD_ACTION' | 'RETURN_NEUTRAL';
  expectedAction: PoseActionState;
  durationMs: number;
}
export interface ValidationStart {
  cameraRunning: boolean;
  delegate: PoseDelegate | null;
  videoWidth: number;
  videoHeight: number;
  previewMirrored: boolean;
  features: PoseFeatureView;
  actions: PoseActionView;
  timeOrigin: number;
  createdAt: string;
}
export interface ValidationSample {
  timestamp: number;
  videoTime: number;
  stageIndex: number;
  expectedAction: PoseActionState;
  /** Current pose and required HIP signal are usable, independently of prediction correctness. */
  poseValid: boolean;
  landmarks: RecordedLandmark[];
  worldLandmarks: RecordedLandmark[];
  rawFeatures: PoseFeatures;
  calibratedFeatures: CalibratedPoseFeatures;
  smoothedFeatures: SmoothedPoseFeatures;
  classification: ActionClassification;
}
export interface ClassifierConfigSnapshot {
  featureScales: Record<ActionFeatureKey, number>;
  neutralExitScore: number;
  neutralEnterScore: number;
  maxDistance: number;
  minMargin: number;
  minConfidence: number;
  enterMs: number;
  releaseMs: number;
  maxFrameGapMs: number;
  smoothingWindowMs: number;
  actionMinSamples: number;
  hipCalibrationVisibility: number;
  kneeCalibrationVisibility: number;
}
export interface ValidationMetadata {
  version: 1;
  createdAt: string;
  model: 'pose_landmarker_full';
  delegate: PoseDelegate;
  videoWidth: number;
  videoHeight: number;
  previewMirrored: boolean;
  timeOrigin: number;
  startedAt: number;
  neutralBaseline: NeutralCalibration;
  actionPrototypes: ActionPrototypes;
  actionCalibrationSampleCounts: Record<PoseAction, ActionSampleCounts>;
  classifierConfig: ClassifierConfigSnapshot;
  sequence: ValidationStage[];
}
export interface ValidationView {
  status: 'IDLE' | 'ACTIVE' | 'COMPLETED';
  phase: ValidationStage['phase'] | 'IDLE' | 'COMPLETED';
  expectedAction: PoseActionState | null;
  remainingMs: number;
  recordedFrames: number;
  sampleCounts: Record<PoseActionState, number>;
}
export interface LabelSummary {
  totalRecordedFrames: number;
  validPoseFrames: number;
  staleFrames: number;
  /** Correctness rates use validPoseFrames, so missing Neutral poses cannot count as correct NONE. */
  rawCorrectRate: number | null;
  stableCorrectRate: number | null;
}
export interface FeatureRepeatability {
  sampleCount: number;
  prototype: number | null;
  validationMedian: number | null;
  difference: number | null;
  normalizedDrift: number | null;
}
export interface ActionSummary extends LabelSummary {
  distanceComparableFrames: number;
  ownPrototypeNearestRate: number | null;
  medianConfidence: number | null;
  medianOwnDistance: number | null;
  medianClosestOtherDistance: number | null;
  medianMargin: number | null;
  featureRepeatability: Record<ActionFeatureKey, FeatureRepeatability>;
}
export interface ValidationSummary {
  actions: Record<PoseAction, ActionSummary>;
  neutral: LabelSummary & {
    scoreFrames: number;
    medianNeutralMovementScore: number | null;
    p90NeutralMovementScore: number | null;
  };
}
export interface ValidationDataset extends ValidationMetadata {
  status: 'COMPLETED';
  summary: ValidationSummary;
  samples: ValidationSample[];
}
