import type { PoseDelegate } from '../createPoseLandmarker';
import type { NeutralCalibration, PoseFeatureView } from '../features/poseFeatureTypes';
import type { RecordedLandmark } from '../../recorder/poseRecorderTypes';
import type { CorridorFeature, KneeMotionFeatures, KneeMotionVelocity } from './kneeMotionFeatures';

export const EXPECTED_MOTIONS = ['NEUTRAL', 'TWIST_LEFT', 'TWIST_RIGHT', 'KNEE_LEFT', 'KNEE_RIGHT'] as const;
export type ExpectedMotion = typeof EXPECTED_MOTIONS[number];
export type MotionPhase = 'NEUTRAL' | 'MOVE' | 'HOLD' | 'RETURN';
export interface MotionStage { phase: MotionPhase | 'PREPARE'; expectedMotion: ExpectedMotion; durationMs: number }
export interface MotionView {
  status: 'IDLE' | 'ACTIVE' | 'COMPLETED';
  phase: MotionStage['phase'] | 'IDLE' | 'COMPLETED';
  expectedMotion: ExpectedMotion | null;
  remainingMs: number;
  recordedFrames: number;
}
export interface MotionStart {
  cameraRunning: boolean; poseDetected: boolean; neutral: PoseFeatureView;
  delegate: PoseDelegate | null; videoWidth: number; videoHeight: number;
  previewMirrored: boolean; createdAt: string; timeOrigin: number;
}
export interface MotionSample {
  timestamp: number; videoTime: number; stageIndex: number;
  expectedMotion: ExpectedMotion; phase: MotionPhase; poseValid: boolean;
  landmarks: RecordedLandmark[]; worldLandmarks: RecordedLandmark[];
  features: KneeMotionFeatures; velocity: KneeMotionVelocity;
}
export interface RobustStats { sampleCount: number; median: number | null; p10: number | null; p90: number | null; mad: number | null }
export type NeutralCorridor = Record<CorridorFeature, RobustStats>;
export interface MotionMetrics {
  totalFrames: number; validFrames: number; staleFrames: number;
  medianAbsKneeCenterOffsetX: number | null; maxAbsKneeCenterOffsetX: number | null;
  peakRelativeKneeVelocity: { left: number | null; right: number | null };
  peakKneeHipDistanceChange: { left: number | null; right: number | null };
  peakKneeHipDistanceVelocity: { left: number | null; right: number | null };
  medianLeftKneeVisibility: number | null; medianRightKneeVisibility: number | null;
}
export interface CorridorExperiment {
  feature: CorridorFeature; k: number; lower: number | null; upper: number | null;
  rates: Record<ExpectedMotion, { comparableFrames: number; crossingFrames: number; crossingRate: number | null }>;
}
export interface DominantKnee {
  dominantKnee: 'LEFT_LANDMARK' | 'RIGHT_LANDMARK' | 'NONE';
  leftPeakDisplacement: number | null; rightPeakDisplacement: number | null;
}
export interface MotionAnalysis {
  neutralCorridor: NeutralCorridor;
  stages: (MotionMetrics & { stageIndex: number; expectedMotion: ExpectedMotion; phase: MotionPhase })[];
  byMotion: Record<ExpectedMotion, MotionMetrics>;
  crossingExperiments: CorridorExperiment[];
  dominantKnees: Record<'KNEE_LEFT' | 'KNEE_RIGHT', DominantKnee>;
}
export interface MotionMetadata {
  version: 1; createdAt: string; model: 'pose_landmarker_full'; delegate: PoseDelegate;
  videoWidth: number; videoHeight: number; previewMirrored: boolean;
  startedAt: number; timeOrigin: number; neutralBaseline: NeutralCalibration;
  measurementConfig: { minPelvisAxisLength: number; maxVelocityGapMs: number; corridorMultipliers: number[] };
  sequence: MotionStage[];
}
export interface MotionDataset extends MotionMetadata {
  status: 'COMPLETED'; neutralCorridor: NeutralCorridor;
  summary: Omit<MotionAnalysis, 'neutralCorridor'>; samples: MotionSample[];
}
