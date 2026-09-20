import { calibratePoseFeatures } from './calibratePoseFeatures';
import { extractPoseFeatures } from './extractPoseFeatures';
import {
  CALIBRATION_FEATURES, type CalibratedPoseFeatures, type CalibrationGroup, type CalibrationReadiness, type CalibrationSampleCounts,
  type FeatureLandmarks, type NeutralCalibration, type PoseFeatures, type PoseFeatureView,
} from './poseFeatureTypes';

export const CALIBRATION_WINDOW_MS = 1000;
export const CALIBRATION_MIN_SAMPLES = 20;
export const HIP_CALIBRATION_VISIBILITY = 0.7;
export const KNEE_CALIBRATION_VISIBILITY = 0.5;
export const SMOOTHING_WINDOW_MS = 400;
export const FEATURE_UI_INTERVAL_MS = 250;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const emptyCounts = (): CalibrationSampleCounts => Object.fromEntries(
  CALIBRATION_FEATURES.map(({ raw }) => [raw, 0]),
) as CalibrationSampleCounts;

/** Filter individual feature values, never a whole raw pose or dataset frame. */
function validFeatures(features: PoseFeatures): PoseFeatures {
  const result = { ...features };
  const visible = (visibility: number | null, minimum: number) => visibility !== null && visibility >= minimum;
  const leftHip = visible(features.leftHipVisibility, HIP_CALIBRATION_VISIBILITY);
  const rightHip = visible(features.rightHipVisibility, HIP_CALIBRATION_VISIBILITY);
  const validGroups = {
    hips: leftHip && rightHip,
    leftKnee: leftHip && visible(features.leftKneeVisibility, KNEE_CALIBRATION_VISIBILITY),
    rightKnee: rightHip && visible(features.rightKneeVisibility, KNEE_CALIBRATION_VISIBILITY),
  };
  for (const { raw, group } of CALIBRATION_FEATURES) {
    if (!validGroups[group]) result[raw] = null;
  }
  return result;
}

/** Time-based rolling median. Missing values cannot turn into zeros or extend old sample lifetimes. */
export class PoseFeatureSmoother {
  private samples: { timestamp: number; values: CalibratedPoseFeatures }[] = [];

  add(values: CalibratedPoseFeatures, timestamp: number): void {
    this.samples.push({ timestamp, values: { ...values } });
    this.prune(timestamp);
  }

  private prune(now: number) {
    this.samples = this.samples.filter((sample) => sample.timestamp > now - SMOOTHING_WINDOW_MS);
  }

  get(now: number): CalibratedPoseFeatures {
    this.prune(now);
    return Object.fromEntries(CALIBRATION_FEATURES.map(({ delta }) => [delta, median(
      this.samples.flatMap(({ values }) => values[delta] === null ? [] : [values[delta]]),
    )])) as CalibratedPoseFeatures;
  }

  reset(): void { this.samples = []; }
}

/** Per-inference numeric snapshots and bounded buffers. Independent of React, recorder labels, and Mirror. */
export class PoseFeatureAnalysis {
  private raw = extractPoseFeatures([]);
  private lastFrameAt: number | null = null;
  private status: PoseFeatureView['status'] = 'NOT CALIBRATED';
  private baseline: NeutralCalibration | null = null;
  private calibrationStartedAt = 0;
  private calibrationSamples: { timestamp: number; features: PoseFeatures }[] = [];
  private sampleCounts = emptyCounts();
  private smoother = new PoseFeatureSmoother();
  private lastValidAt: number | null = null;

  startCalibration(now: number): void {
    this.status = 'CALIBRATING';
    this.baseline = null;
    this.calibrationStartedAt = now;
    this.calibrationSamples = [];
    this.sampleCounts = emptyCounts();
    this.smoother.reset();
    this.lastValidAt = null;
  }

  processFrame(landmarks: FeatureLandmarks, worldLandmarks: FeatureLandmarks, timestamp: number): void {
    this.raw = extractPoseFeatures(landmarks, worldLandmarks);
    this.lastFrameAt = timestamp;
    const valid = validFeatures(this.raw);
    if (this.isCollecting() && timestamp >= this.calibrationStartedAt) {
      this.calibrationSamples.push({ timestamp, features: valid });
      this.pruneCalibration(timestamp);
      if (timestamp - this.calibrationStartedAt >= CALIBRATION_WINDOW_MS) {
        // Freeze each baseline once ready. Pending knees keep collecting after HIP is ready.
        // The user must continue holding Neutral while those samples are collected.
        for (const { raw } of CALIBRATION_FEATURES) {
          if (this.baseline?.[raw] != null || this.sampleCounts[raw] < CALIBRATION_MIN_SAMPLES) continue;
          this.baseline ??= Object.fromEntries(CALIBRATION_FEATURES.map(({ raw }) => [raw, null])) as NeutralCalibration;
          this.baseline[raw] = median(this.calibrationSamples.flatMap(({ features }) => features[raw] === null ? [] : [features[raw]]));
        }
        if (this.groupReadiness('hips').ready) this.status = 'CALIBRATED';
        if (!this.isCollecting()) this.calibrationSamples = [];
      }
    }
    this.expireSmoothing(timestamp);
    const calibrated = calibratePoseFeatures(valid, this.baseline);
    if (this.hasRequiredFeatures(calibrated)) {
      this.smoother.add(calibrated, timestamp);
      this.lastValidAt = timestamp;
    }
  }

  private isCollecting(): boolean {
    return this.status !== 'NOT CALIBRATED' && CALIBRATION_FEATURES.some(({ raw }) => this.baseline?.[raw] == null);
  }

  private pruneCalibration(now: number) {
    this.calibrationSamples = this.calibrationSamples.filter(({ timestamp }) => timestamp > now - CALIBRATION_WINDOW_MS);
    for (const { raw } of CALIBRATION_FEATURES) {
      // Keep the counts used by completed baselines; expire only pending samples.
      if (this.baseline?.[raw] != null) continue;
      this.sampleCounts[raw] = this.calibrationSamples.filter(({ features }) => features[raw] !== null).length;
    }
  }

  private groupReadiness(group: CalibrationGroup): CalibrationReadiness {
    const features = CALIBRATION_FEATURES.filter((feature) => feature.group === group);
    return {
      ready: features.every(({ raw }) => this.baseline?.[raw] != null),
      sampleCount: Math.min(...features.map(({ raw }) => this.sampleCounts[raw])),
    };
  }

  private hasRequiredFeatures(calibrated: CalibratedPoseFeatures): boolean {
    return this.status === 'CALIBRATED' && CALIBRATION_FEATURES
      .filter(({ group }) => group === 'hips')
      .every(({ delta }) => calibrated[delta] !== null);
  }

  private expireSmoothing(now: number): void {
    if (this.lastValidAt !== null && now - this.lastValidAt >= SMOOTHING_WINDOW_MS) this.smoother.reset();
  }

  getView(now: number): PoseFeatureView {
    if (this.isCollecting()) this.pruneCalibration(now);
    // Also expire the displayed raw/delta values if video delivery stalls entirely.
    const raw = this.lastFrameAt !== null && now - this.lastFrameAt < CALIBRATION_WINDOW_MS
      ? { ...this.raw } : extractPoseFeatures([]);
    const eligible = calibratePoseFeatures(validFeatures(raw), this.baseline);
    const validNow = this.lastFrameAt !== null && now - this.lastFrameAt < SMOOTHING_WINDOW_MS && this.hasRequiredFeatures(eligible);
    this.expireSmoothing(now);
    const smoothed = this.smoother.get(now);
    for (const { delta } of CALIBRATION_FEATURES) {
      // Even within the median window, never expose old values as usable current data.
      if (!validNow || eligible[delta] === null) smoothed[delta] = null;
    }
    const readiness = {
      hips: this.groupReadiness('hips'), leftKnee: this.groupReadiness('leftKnee'), rightKnee: this.groupReadiness('rightKnee'),
    };
    return {
      raw, status: this.status, sampleCount: readiness.hips.sampleCount, readiness,
      sampleCounts: { ...this.sampleCounts },
      baseline: this.baseline ? { ...this.baseline } : null,
      calibrated: calibratePoseFeatures(raw, this.baseline),
      smoothed: { values: smoothed, validNow, lastValidAt: this.lastValidAt },
    };
  }

  reset(): void {
    this.raw = extractPoseFeatures([]);
    this.lastFrameAt = null;
    this.status = 'NOT CALIBRATED';
    this.baseline = null;
    this.calibrationStartedAt = 0;
    this.calibrationSamples = [];
    this.sampleCounts = emptyCounts();
    this.smoother.reset();
    this.lastValidAt = null;
  }
}
