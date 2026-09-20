import type { PoseDelegate } from '../pose/createPoseLandmarker';

export const POSE_LABELS = ['NEUTRAL', 'TWIST_LEFT', 'TWIST_RIGHT', 'KNEE_LEFT', 'KNEE_RIGHT'] as const;
export type PoseLabel = typeof POSE_LABELS[number];
export type SampleCounts = Record<PoseLabel, number>;

export interface PoseFrame {
  /** Monotonic milliseconds from performance.now(), matching detectForVideo. */
  timestamp: number;
  /** Camera video.currentTime in seconds. */
  videoTime: number;
  landmarks: { x: number; y: number; z: number; visibility?: number }[];
  worldLandmarks: { x: number; y: number; z: number; visibility?: number }[];
}

export interface RecordedLandmark {
  index: number;
  x: number;
  y: number;
  z: number;
  visibility: number | null;
}

export interface PoseSample {
  label: PoseLabel;
  timestamp: number;
  videoTime: number;
  landmarks: RecordedLandmark[];
  worldLandmarks: RecordedLandmark[];
}

/** Available only while the camera is running and the latest frame has a pose. */
export interface RecordingCameraContext {
  delegate: PoseDelegate;
  videoWidth: number;
  videoHeight: number;
}

export interface DatasetMetadata extends RecordingCameraContext {
  version: 1;
  createdAt: string;
  model: 'pose_landmarker_full';
  /** Preview setting at recording start; never applied to sample coordinates. */
  previewMirrored: boolean;
  /** Unix milliseconds; add to a sample timestamp to obtain wall-clock time. */
  timeOrigin: number;
}

export interface PoseDataset extends DatasetMetadata {
  status: 'COMPLETED' | 'INTERRUPTED';
  sampleCounts: SampleCounts;
  droppedPoseFrameCount: number;
  droppedPoseFrameCounts: SampleCounts;
  samples: PoseSample[];
}

export interface GuidedStage {
  phase: 'PREPARE' | 'STABILIZE' | 'TRANSITION' | 'RECORDING';
  label: PoseLabel | null;
  nextLabel: PoseLabel | null;
  durationMs: number;
}

export interface RecorderView {
  status: 'IDLE' | 'ACTIVE' | 'COMPLETED' | 'INTERRUPTED';
  stageIndex: number;
  stage: GuidedStage | null;
  remainingMs: number;
  sampleCounts: SampleCounts;
  totalSamples: number;
  droppedPoseFrameCount: number;
  droppedPoseFrameCounts: SampleCounts;
  createdAt: string | null;
}
