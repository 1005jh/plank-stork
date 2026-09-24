import { POSE_ACTIONS, type PoseActionView } from '../actions/poseActionTypes';
import * as config from '../actions/poseActionConstants';
import { HIP_CALIBRATION_VISIBILITY, KNEE_CALIBRATION_VISIBILITY, SMOOTHING_WINDOW_MS } from '../features/poseFeatureAnalysis';
import { CALIBRATION_FEATURES, type PoseFeatureView } from '../features/poseFeatureTypes';
import type { PoseFrame } from '../../recorder/poseRecorderTypes';
import type { ValidationDataset, ValidationMetadata, ValidationSample, ValidationStage, ValidationStart, ValidationSummary, ValidationView } from './validationTypes';
import { summarizeValidation } from './validationAnalyzer';

export const VALIDATION_SEQUENCE: readonly ValidationStage[] = [
  { phase: 'PREPARE', expectedAction: 'NONE', durationMs: 2000 },
  { phase: 'RECORD_NEUTRAL', expectedAction: 'NONE', durationMs: 1500 },
  ...POSE_ACTIONS.flatMap((expectedAction): ValidationStage[] => [
    { phase: 'MOVE', expectedAction, durationMs: 1000 },
    { phase: 'RECORD_ACTION', expectedAction, durationMs: 1500 },
    { phase: 'RETURN_NEUTRAL', expectedAction: 'NONE', durationMs: 1000 },
    { phase: 'RECORD_NEUTRAL', expectedAction: 'NONE', durationMs: 1000 },
  ]),
];
const emptyCounts = (): ValidationView['sampleCounts'] => ({ NONE: 0, TWIST_LEFT: 0, TWIST_RIGHT: 0, KNEE_LEFT: 0, KNEE_RIGHT: 0 });

export function validationReady(cameraRunning: boolean, features: PoseFeatureView, actions: PoseActionView): boolean {
  return cameraRunning && features.collectionState === 'FROZEN' && features.baseline !== null &&
    actions.calibration.status === 'READY' && POSE_ACTIONS.every((action) => actions.calibration.prototypes[action] !== null);
}

/** Independent Controller performance.now() sequence; owns samples outside React. */
export class ActionValidation {
  private status: ValidationView['status'] = 'IDLE';
  private metadata: ValidationMetadata | null = null;
  private samples: ValidationSample[] = [];
  private counts = emptyCounts();
  private stageIndex = 0;
  private remainingMs = 0;
  private lastFrameAt: number | null = null;
  private summary: ValidationSummary | null = null;

  start(context: ValidationStart, now: number): boolean {
    if (this.status === 'ACTIVE' || !validationReady(context.cameraRunning, context.features, context.actions) || !context.delegate) return false;
    this.reset();
    const calibration = context.actions.calibration;
    this.metadata = {
      version: 1, createdAt: context.createdAt, model: 'pose_landmarker_full', delegate: context.delegate,
      videoWidth: context.videoWidth, videoHeight: context.videoHeight, previewMirrored: context.previewMirrored,
      timeOrigin: context.timeOrigin, startedAt: now, neutralBaseline: { ...context.features.baseline! },
      actionPrototypes: Object.fromEntries(POSE_ACTIONS.map((action) => [action, { action, features: { ...calibration.prototypes[action]!.features } }])) as ValidationMetadata['actionPrototypes'],
      actionCalibrationSampleCounts: Object.fromEntries(POSE_ACTIONS.map((action) => [action, { ...calibration.sampleCounts[action] }])) as ValidationMetadata['actionCalibrationSampleCounts'],
      classifierConfig: {
        featureScales: { ...config.ACTION_FEATURE_SCALES }, neutralExitScore: config.NEUTRAL_EXIT_SCORE, neutralEnterScore: config.NEUTRAL_ENTER_SCORE,
        maxDistance: config.ACTION_MAX_DISTANCE, minMargin: config.ACTION_MIN_MARGIN, minConfidence: config.ACTION_MIN_CONFIDENCE,
        enterMs: config.ACTION_ENTER_MS, releaseMs: config.ACTION_RELEASE_MS, maxFrameGapMs: config.ACTION_MAX_FRAME_GAP_MS,
        smoothingWindowMs: SMOOTHING_WINDOW_MS, actionMinSamples: config.ACTION_MIN_SAMPLES,
        hipCalibrationVisibility: HIP_CALIBRATION_VISIBILITY, kneeCalibrationVisibility: KNEE_CALIBRATION_VISIBILITY,
      },
      sequence: VALIDATION_SEQUENCE.map((stage) => ({ ...stage })),
    };
    this.status = 'ACTIVE';
    this.remainingMs = VALIDATION_SEQUENCE[0].durationMs;
    return true;
  }

  private advance(now: number): void {
    if (this.status !== 'ACTIVE' || !this.metadata) return;
    let elapsed = Math.max(0, now - this.metadata.startedAt);
    for (const [index, stage] of this.metadata.sequence.entries()) {
      if (elapsed < stage.durationMs) {
        this.stageIndex = index; this.remainingMs = stage.durationMs - elapsed; return;
      }
      elapsed -= stage.durationMs;
    }
    this.status = 'COMPLETED'; this.remainingMs = 0;
    this.summary = summarizeValidation(this.samples, this.metadata.actionPrototypes, this.metadata.classifierConfig.featureScales);
  }

  recordFrame(frame: PoseFrame, features: PoseFeatureView, actions: PoseActionView): void {
    if (this.status !== 'ACTIVE' || !this.metadata || frame.timestamp < this.metadata.startedAt) return;
    // Defensive invalidation as well as explicit UI/reset lifecycle guards: never mix references.
    if (!validationReady(true, features, actions) ||
      CALIBRATION_FEATURES.some(({ raw }) => features.baseline?.[raw] !== this.metadata!.neutralBaseline[raw]) ||
      POSE_ACTIONS.some((action) => config.ACTION_FEATURE_KEYS.some((key) =>
        actions.calibration.prototypes[action]?.features[key] !== this.metadata!.actionPrototypes[action]!.features[key]))) {
      this.reset(); return;
    }
    if (this.lastFrameAt !== null && frame.timestamp <= this.lastFrameAt) return;
    this.lastFrameAt = frame.timestamp;
    this.advance(frame.timestamp);
    if (this.status !== 'ACTIVE') return;
    const stage = this.metadata.sequence[this.stageIndex];
    if (stage.phase !== 'RECORD_ACTION' && stage.phase !== 'RECORD_NEUTRAL') return;
    const snapshot = (points: PoseFrame['landmarks']) => points.map(({ x, y, z, visibility }, index) => ({ index, x, y, z, visibility: visibility ?? null }));
    // Synchronous primitive copies, before the caller closes the MediaPipe result.
    this.samples.push({
      timestamp: frame.timestamp, videoTime: frame.videoTime, stageIndex: this.stageIndex, expectedAction: stage.expectedAction,
      poseValid: frame.landmarks.length > 0 && features.smoothed.validNow,
      landmarks: snapshot(frame.landmarks), worldLandmarks: snapshot(frame.worldLandmarks),
      rawFeatures: { ...features.raw }, calibratedFeatures: { ...features.calibrated },
      smoothedFeatures: { values: { ...features.smoothed.values }, validNow: features.smoothed.validNow, lastValidAt: features.smoothed.lastValidAt },
      classification: { ...actions.classification, actionDistances: { ...actions.classification.actionDistances } },
    });
    this.counts[stage.expectedAction]++;
  }

  getView(now: number): ValidationView {
    this.advance(now);
    const stage = this.status === 'ACTIVE' ? this.metadata!.sequence[this.stageIndex] : null;
    return { status: this.status, phase: stage?.phase ?? (this.status === 'COMPLETED' ? 'COMPLETED' : 'IDLE'), expectedAction: stage?.expectedAction ?? null,
      remainingMs: this.remainingMs, recordedFrames: this.samples.length, sampleCounts: { ...this.counts } };
  }

  getSummary(): ValidationSummary | null { return this.summary; }

  exportJson(): string {
    if (this.status !== 'COMPLETED' || !this.metadata || !this.summary) throw new Error('Validation 완료 후 다운로드할 수 있습니다.');
    const dataset: ValidationDataset = { ...this.metadata, status: 'COMPLETED', summary: this.summary, samples: this.samples };
    return JSON.stringify(dataset, null, 2);
  }

  reset(): void {
    this.status = 'IDLE'; this.metadata = null; this.samples = []; this.counts = emptyCounts();
    this.stageIndex = 0; this.remainingMs = 0; this.lastFrameAt = null; this.summary = null;
  }
}
