import type { FeatureLandmarks } from '../features/poseFeatureTypes';

// Numerical/measurement guards, not KICK classification thresholds.
export const MIN_PELVIS_AXIS_LENGTH = 0.0001;
export const MAX_VELOCITY_GAP_MS = 400;
export const CORRIDOR_FEATURES = [
  'leftKneeCenterOffsetX', 'rightKneeCenterOffsetX', 'maxAbsKneeCenterOffsetX',
  'leftKneeHipOffsetX', 'rightKneeHipOffsetX', 'leftKneeHipDistance', 'rightKneeHipDistance',
  'leftKneePelvisProjection', 'rightKneePelvisProjection',
] as const;
export type CorridorFeature = typeof CORRIDOR_FEATURES[number];
export type KneeMotionFeatures = Record<CorridorFeature, number | null> & {
  hipCenterX: number | null;
  hipWidth: number | null;
  leftKneeX: number | null;
  rightKneeX: number | null;
  leftHipVisibility: number | null;
  rightHipVisibility: number | null;
  leftKneeVisibility: number | null;
  rightKneeVisibility: number | null;
};
export interface KneeMotionVelocity {
  deltaTimeMs: number | null;
  leftKneeCenterOffsetVelocityX: number | null;
  rightKneeCenterOffsetVelocityX: number | null;
  leftKneeHipOffsetVelocityX: number | null;
  rightKneeHipOffsetVelocityX: number | null;
  leftKneeHipDistanceVelocity: number | null;
  rightKneeHipDistanceVelocity: number | null;
  hipCenterVelocityX: number | null;
  leftKneeVelocityX: number | null;
  rightKneeVelocityX: number | null;
  leftKneeRelativeVelocityX: number | null;
  rightKneeRelativeVelocityX: number | null;
}
export const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

/** Image-space 2D candidates. No visibility cutoff, smoothing, or body-side remapping. */
export function extractKneeMotionFeatures(landmarks: FeatureLandmarks): KneeMotionFeatures {
  const point = (index: number) => {
    const value = landmarks[index];
    return value && finite(value.x) && finite(value.y) ? value : null;
  };
  const lh = point(23), rh = point(24), lk = point(25), rk = point(26);
  const center = lh && rh ? { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 } : null;
  const dx = lh && rh ? rh.x - lh.x : null, dy = lh && rh ? rh.y - lh.y : null;
  const width = dx !== null && dy !== null ? Math.hypot(dx, dy) : null;
  const leftOffset = lk && center ? lk.x - center.x : null;
  const rightOffset = rk && center ? rk.x - center.x : null;
  const projection = (knee: typeof lk) => knee && center && width !== null && width >= MIN_PELVIS_AXIS_LENGTH && dx !== null && dy !== null
    ? ((knee.x - center.x) * dx + (knee.y - center.y) * dy) / width : null;
  const visibility = (index: number) => finite(landmarks[index]?.visibility) ? landmarks[index]!.visibility! : null;
  return {
    hipCenterX: center?.x ?? null, hipWidth: width, leftKneeX: lk?.x ?? null, rightKneeX: rk?.x ?? null,
    leftKneeCenterOffsetX: leftOffset, rightKneeCenterOffsetX: rightOffset,
    maxAbsKneeCenterOffsetX: leftOffset !== null && rightOffset !== null ? Math.max(Math.abs(leftOffset), Math.abs(rightOffset)) : null,
    leftKneeHipOffsetX: lk && lh ? lk.x - lh.x : null, rightKneeHipOffsetX: rk && rh ? rk.x - rh.x : null,
    leftKneeHipDistance: lk && lh ? Math.hypot(lk.x - lh.x, lk.y - lh.y) : null,
    rightKneeHipDistance: rk && rh ? Math.hypot(rk.x - rh.x, rk.y - rh.y) : null,
    leftKneePelvisProjection: projection(lk), rightKneePelvisProjection: projection(rk),
    leftHipVisibility: visibility(23), rightHipVisibility: visibility(24),
    leftKneeVisibility: visibility(25), rightKneeVisibility: visibility(26),
  };
}

export function motionPoseValid(features: KneeMotionFeatures): boolean {
  return features.hipCenterX !== null && features.leftKneeHipDistance !== null && features.rightKneeHipDistance !== null;
}

/** Normalized image coordinates per second. Each missing coordinate produces null, never zero. */
export function calculateKneeMotionVelocity(current: KneeMotionFeatures, timestamp: number,
  previous: { features: KneeMotionFeatures; timestamp: number } | null): KneeMotionVelocity {
  const dt = previous ? timestamp - previous.timestamp : null;
  const validTime = dt !== null && finite(dt) && dt > 0 && dt < MAX_VELOCITY_GAP_MS;
  const derivative = (key: keyof KneeMotionFeatures) => {
    const before = previous?.features[key], after = current[key];
    return validTime && finite(before) && finite(after) ? (after - before) * 1000 / dt! : null;
  };
  const hip = derivative('hipCenterX'), left = derivative('leftKneeX'), right = derivative('rightKneeX');
  return {
    deltaTimeMs: dt,
    leftKneeCenterOffsetVelocityX: derivative('leftKneeCenterOffsetX'), rightKneeCenterOffsetVelocityX: derivative('rightKneeCenterOffsetX'),
    leftKneeHipOffsetVelocityX: derivative('leftKneeHipOffsetX'), rightKneeHipOffsetVelocityX: derivative('rightKneeHipOffsetX'),
    leftKneeHipDistanceVelocity: derivative('leftKneeHipDistance'), rightKneeHipDistanceVelocity: derivative('rightKneeHipDistance'),
    hipCenterVelocityX: hip, leftKneeVelocityX: left, rightKneeVelocityX: right,
    leftKneeRelativeVelocityX: left !== null && hip !== null ? left - hip : null,
    rightKneeRelativeVelocityX: right !== null && hip !== null ? right - hip : null,
  };
}
