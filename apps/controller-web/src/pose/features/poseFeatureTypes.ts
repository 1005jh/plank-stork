/** Structural input shared by live MediaPipe results and indexed dataset arrays. */
export interface FeatureLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number | null;
}
export type FeatureLandmarks = readonly (FeatureLandmark | null | undefined)[];

export interface PoseFeatures {
  hipCenterX: number | null;
  hipCenterY: number | null;
  hipWidth: number | null;
  hipDepthDifference: number | null;
  leftKneeRelativeX: number | null;
  rightKneeRelativeX: number | null;
  leftKneeRelativeY: number | null;
  rightKneeRelativeY: number | null;
  leftKneeDistanceFromHip: number | null;
  rightKneeDistanceFromHip: number | null;
  leftHipVisibility: number | null;
  rightHipVisibility: number | null;
  leftKneeVisibility: number | null;
  rightKneeVisibility: number | null;
}

export const CALIBRATION_FEATURES = [
  { raw: 'hipCenterX', delta: 'deltaHipCenterX', group: 'hips' },
  { raw: 'hipCenterY', delta: 'deltaHipCenterY', group: 'hips' },
  { raw: 'hipDepthDifference', delta: 'deltaHipDepthDifference', group: 'hips' },
  { raw: 'leftKneeRelativeX', delta: 'deltaLeftKneeRelativeX', group: 'leftKnee' },
  { raw: 'rightKneeRelativeX', delta: 'deltaRightKneeRelativeX', group: 'rightKnee' },
  { raw: 'leftKneeRelativeY', delta: 'deltaLeftKneeRelativeY', group: 'leftKnee' },
  { raw: 'rightKneeRelativeY', delta: 'deltaRightKneeRelativeY', group: 'rightKnee' },
] as const;

export type CalibrationFeature = typeof CALIBRATION_FEATURES[number]['raw'];
export type CalibrationGroup = typeof CALIBRATION_FEATURES[number]['group'];
export type NeutralCalibration = Pick<PoseFeatures, CalibrationFeature>;
export type CalibratedPoseFeatures = Record<typeof CALIBRATION_FEATURES[number]['delta'], number | null>;
export type CalibrationSampleCounts = Record<CalibrationFeature, number>;

export interface CalibrationReadiness {
  ready: boolean;
  sampleCount: number;
}

export interface SmoothedPoseFeatures {
  /** Values are masked to null when stale, or when that feature is currently unavailable. */
  values: CalibratedPoseFeatures;
  /** Current frame has all required calibrated HIP features and is less than 400 ms old. */
  validNow: boolean;
  /** Last usable HIP frame's monotonic timestamp, not the UI refresh time. */
  lastValidAt: number | null;
}

export interface PoseFeatureView {
  raw: PoseFeatures;
  status: 'NOT CALIBRATED' | 'CALIBRATING' | 'CALIBRATED';
  sampleCount: number;
  sampleCounts: CalibrationSampleCounts;
  readiness: Record<CalibrationGroup, CalibrationReadiness>;
  baseline: NeutralCalibration | null;
  calibrated: CalibratedPoseFeatures;
  smoothed: SmoothedPoseFeatures;
}
