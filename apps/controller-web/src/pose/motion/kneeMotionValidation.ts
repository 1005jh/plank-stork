import type { PoseFrame } from '../../recorder/poseRecorderTypes';
import { CALIBRATION_FEATURES, type PoseFeatureView } from '../features/poseFeatureTypes';
import { snapshotLandmarks } from '../snapshotLandmarks';
import { calculateKneeMotionVelocity, extractKneeMotionFeatures, MAX_VELOCITY_GAP_MS, MIN_PELVIS_AXIS_LENGTH, motionPoseValid, type KneeMotionFeatures } from './kneeMotionFeatures';
import { analyzeKneeMotion, CORRIDOR_MULTIPLIERS } from './kneeMotionAnalyzer';
import { EXPECTED_MOTIONS, type MotionAnalysis, type MotionDataset, type MotionMetadata, type MotionSample, type MotionStage, type MotionStart, type MotionView } from './kneeMotionTypes';

export const MOTION_SEQUENCE: readonly MotionStage[] = [
  { phase: 'PREPARE', expectedMotion: 'NEUTRAL', durationMs: 2000 },
  { phase: 'NEUTRAL', expectedMotion: 'NEUTRAL', durationMs: 1000 },
  ...EXPECTED_MOTIONS.filter((motion) => motion !== 'NEUTRAL').flatMap((expectedMotion): MotionStage[] => [
    { phase: 'MOVE', expectedMotion, durationMs: 1000 },
    { phase: 'HOLD', expectedMotion, durationMs: 1000 },
    // RETURN keeps the preceding motion label, so its temporal return can be analyzed separately.
    { phase: 'RETURN', expectedMotion, durationMs: 1000 },
  ]),
];
export function kneeMotionReady(cameraRunning: boolean, poseDetected: boolean, neutral: PoseFeatureView): boolean {
  return cameraRunning && poseDetected && neutral.collectionState === 'FROZEN' && neutral.baseline !== null;
}

export class KneeMotionValidation {
  private status: MotionView['status'] = 'IDLE';
  private metadata: MotionMetadata | null = null;
  private samples: MotionSample[] = [];
  private stageIndex = 0;
  private remainingMs = 0;
  private lastFrameAt: number | null = null;
  private previousValid: { timestamp: number; features: KneeMotionFeatures } | null = null;
  private analysis: MotionAnalysis | null = null;

  start(context: MotionStart, now: number): boolean {
    if (this.status === 'ACTIVE' || !kneeMotionReady(context.cameraRunning, context.poseDetected, context.neutral) || !context.delegate) return false;
    this.reset();
    this.metadata = {
      version: 1, createdAt: context.createdAt, model: 'pose_landmarker_full', delegate: context.delegate,
      videoWidth: context.videoWidth, videoHeight: context.videoHeight, previewMirrored: context.previewMirrored,
      timeOrigin: context.timeOrigin, startedAt: now, neutralBaseline: { ...context.neutral.baseline! },
      measurementConfig: { minPelvisAxisLength: MIN_PELVIS_AXIS_LENGTH, maxVelocityGapMs: MAX_VELOCITY_GAP_MS, corridorMultipliers: [...CORRIDOR_MULTIPLIERS] },
      sequence: MOTION_SEQUENCE.map((stage) => ({ ...stage })),
    };
    this.status = 'ACTIVE'; this.remainingMs = 2000;
    return true;
  }

  private advance(now: number): void {
    if (this.status !== 'ACTIVE' || !this.metadata) return;
    let elapsed = Math.max(0, now - this.metadata.startedAt);
    for (const [index, stage] of this.metadata.sequence.entries()) {
      if (elapsed < stage.durationMs) { this.stageIndex = index; this.remainingMs = stage.durationMs - elapsed; return; }
      elapsed -= stage.durationMs;
    }
    this.status = 'COMPLETED'; this.remainingMs = 0;
    this.analysis = analyzeKneeMotion(this.samples, this.metadata.sequence);
    this.previousValid = null;
  }

  recordFrame(frame: PoseFrame, neutral: PoseFeatureView): void {
    if (this.status !== 'ACTIVE' || !this.metadata || frame.timestamp < this.metadata.startedAt) return;
    if (neutral.collectionState !== 'FROZEN' || CALIBRATION_FEATURES.some(({ raw }) => neutral.baseline?.[raw] !== this.metadata!.neutralBaseline[raw])) { this.reset(); return; }
    if (this.lastFrameAt !== null && frame.timestamp <= this.lastFrameAt) return;
    this.lastFrameAt = frame.timestamp;
    this.advance(frame.timestamp);
    if (this.status !== 'ACTIVE') return;
    const features = extractKneeMotionFeatures(frame.landmarks);
    const velocity = calculateKneeMotionVelocity(features, frame.timestamp, this.previousValid);
    const poseValid = motionPoseValid(features);
    if (poseValid) this.previousValid = { timestamp: frame.timestamp, features };
    const stage = this.metadata.sequence[this.stageIndex];
    if (stage.phase === 'PREPARE') return;
    this.samples.push({
      timestamp: frame.timestamp, videoTime: frame.videoTime, stageIndex: this.stageIndex,
      expectedMotion: stage.expectedMotion, phase: stage.phase, poseValid,
      landmarks: snapshotLandmarks(frame.landmarks), worldLandmarks: snapshotLandmarks(frame.worldLandmarks), features, velocity,
    });
  }

  getView(now: number): MotionView {
    this.advance(now);
    const stage = this.status === 'ACTIVE' ? this.metadata!.sequence[this.stageIndex] : null;
    return { status: this.status, phase: stage?.phase ?? (this.status === 'COMPLETED' ? 'COMPLETED' : 'IDLE'),
      expectedMotion: stage?.expectedMotion ?? null, remainingMs: this.remainingMs, recordedFrames: this.samples.length };
  }
  getAnalysis(): MotionAnalysis | null { return this.analysis; }
  exportJson(): string {
    if (this.status !== 'COMPLETED' || !this.metadata || !this.analysis) throw new Error('Knee Motion Validation 완료 후 다운로드할 수 있습니다.');
    const { neutralCorridor, ...summary } = this.analysis;
    const dataset: MotionDataset = { ...this.metadata, status: 'COMPLETED', neutralCorridor, samples: this.samples, summary };
    return JSON.stringify(dataset, null, 2);
  }
  reset(): void {
    this.status = 'IDLE'; this.metadata = null; this.samples = []; this.stageIndex = 0; this.remainingMs = 0;
    this.lastFrameAt = null; this.previousValid = null; this.analysis = null;
  }
}
