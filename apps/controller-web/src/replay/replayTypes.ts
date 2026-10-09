import type { VideoIntegrity } from './mediaArtifact';
import type { CaptureValidation, EstimatorNeutralReference } from '../capture/estimatorValidationProtocol';
import type { VideoReplayDiagnostics } from './videoReplayMetrics';
import type { DetectorTestSummary, KneeKickState } from '@plank-stork/protocol';
import type { PoseFrame } from '../recorder/poseRecorderTypes';
import type { PoseDelegate } from '../pose/createPoseLandmarker';
import type { NeutralCalibration, PoseFeatureView } from '../pose/features/poseFeatureTypes';
import type { KickDetectorMode, KneeKickAnalysis } from '../pose/kick/kneeKickAnalysis';
import type { KneeKickBaseline } from '../pose/kick/kneeKickDetector';
import type { Y_KICK_V3_CONFIG, KneeKickBaselineV3 } from '../pose/kick/kneeKickDetectorV3';
import type { diagnosticConfig } from '../pose/kick/kneeKickDiagnostics';

export type KickSnapshot = ReturnType<KneeKickAnalysis['getReplaySnapshot']>;
export type KickObservation = { kind: 'CLOCK' | 'START' | 'RESET'; timestamp: number; reason?: string } |
  { kind: 'FRAME'; timestamp: number; frame: PoseFrame; neutral: PoseFeatureView };
export type KickObserver = (event: KickObservation, read: () => KickSnapshot) => void;
export interface ReplayPoint { x: number; y: number; z: number; visibility: number | null }
export interface ReplayPoseFrame { tMs: number; order: number; landmarks: ReplayPoint[]; worldLandmarks: ReplayPoint[] }
export interface ReplayEvent { id: number; direction: 'KNEE_LEFT' | 'KNEE_RIGHT'; tMs: number }
export type ReplayMarkerType = 'CAPTURE_START' | 'CAPTURE_STOP' | 'NEUTRAL_CALIBRATION_START' | 'NEUTRAL_FROZEN' |
  'GUIDED_TEST_START' | 'GUIDED_STAGE_CHANGE' | 'GUIDED_TEST_COMPLETE' | 'GUIDED_TEST_STOP' | 'INVALID_MISSING_ESTIMATOR_REFERENCE';
export interface ReplayMarker { type: ReplayMarkerType; tMs: number; order: number; trialId?: number; stageIndex?: number; expected?: string }
export interface ReplayResult {
  poseFrameCount: number; poseUsableFrameCount: number; events: ReplayEvent[]; finalState: KneeKickState;
  guidedSummary: DetectorTestSummary | null;
}
export interface ReplayTrial {
  estimatorNeutralReference?: EstimatorNeutralReference;
  validationStatus?: 'REFERENCE_READY' | 'INVALID_MISSING_ESTIMATOR_REFERENCE';
  id: number; startMs: number; endMs: number | null; startOrder: number; endOrder: number | null;
  baseline: KneeKickBaseline; neutralBaseline: NeutralCalibration | null; result: ReplayResult;
  /** V3 baseline; result is PRIMARY according to session.detectorMode. baseline remains X for compatibility. */
  baselineV3?: KneeKickBaselineV3 | null;
  legacyXShadow?: { result: ReplayResult };
}
export interface ReplaySession {
  detectorMode?: KickDetectorMode;
  detectorConfigV3?: typeof Y_KICK_V3_CONFIG;
  version: 1 | 2; captureId: string; createdAt: string;
  attemptId?: string; validation?: CaptureValidation;
  video: { integrity?: VideoIntegrity; filename: string; mimeType: string; width: number; height: number; nominalFrameRate: number | null; videoBitsPerSecond: number; sourceVideoTimeAtStart: number };
  pose: { model: string; modelUrl: string; delegate: PoseDelegate; settings: Record<string, number | string | boolean> };
  display: { mirrorEnabled: boolean };
  timing: { durationMs: number; captureStartPerformanceMs: number };
  markers: ReplayMarker[]; poseFrames: ReplayPoseFrame[];
  /** Real live clock reads, including reads between inferences. No synthetic polling on replay. */
  clockSamples: { tMs: number; order: number; trialId: number }[];
  liveResult: {
    neutralBaseline: NeutralCalibration | null; kickBaseline: KneeKickBaseline | null;
    kickBaselineV3?: KneeKickBaselineV3 | null;
    detectorConfig: ReturnType<typeof diagnosticConfig>; guidedSummary: DetectorTestSummary | null;
    events: (ReplayEvent & { trialId: number | null })[]; trials: ReplayTrial[];
  };
}
export interface CaptureCamera { stream: MediaStream; delegate: PoseDelegate; width: number; height: number; videoTime: number }
export interface ReplayOutput {
  replayMode: 'LANDMARK' | 'VIDEO'; sourceCaptureId: string; trialId: number; result: ReplayResult;
  detectorConfig: ReturnType<typeof diagnosticConfig>;
  comparison: ReplayComparison;
  videoDiagnostics?: VideoReplayDiagnostics;
  videoPose?: { delegate: PoseDelegate; modelUrl: string };
}

/** Missing landmarks remain []; missing visibility remains null. Never mirror or retain SDK objects. */
export function copyPoseFrame(frame: PoseFrame, startMs: number, order: number): ReplayPoseFrame {
  const copy = (points: PoseFrame['landmarks']) => points.map(({ x, y, z, visibility }) => ({ x, y, z, visibility: visibility ?? null }));
  return { tMs: frame.timestamp - startMs, order, landmarks: copy(frame.landmarks), worldLandmarks: copy(frame.worldLandmarks) };
}
export function asPoseFrame(frame: ReplayPoseFrame): PoseFrame {
  const copy = (points: ReplayPoint[]) => points.map(({ x, y, z, visibility }) => ({ x, y, z, ...(visibility === null ? {} : { visibility }) }));
  return { timestamp: frame.tMs, videoTime: frame.tMs / 1000, landmarks: copy(frame.landmarks), worldLandmarks: copy(frame.worldLandmarks) };
}

/** Version 1 captures before live V3 always mean X. Never infer mode from baselineV3 alone. */
export function replayDetectorMode(session: ReplaySession): KickDetectorMode { return session.detectorMode ?? 'LEGACY_X'; }
export interface ReplayComparison {
  target?: 'LIVE_V3' | 'LIVE_X' | 'LIVE_X_SHADOW';
  available?: boolean;
  eventsEqual: boolean; finalStateEqual: boolean; guidedSummaryEqual: boolean; timestampToleranceMs: number;
}
