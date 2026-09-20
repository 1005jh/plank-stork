import type { FeatureLandmark, FeatureLandmarks, PoseFeatures } from './poseFeatureTypes';

function value(point: FeatureLandmark | null | undefined, axis: keyof FeatureLandmark): number | null {
  const number = point?.[axis];
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

function difference(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a - b;
}

function average(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : (a + b) / 2;
}

function distance(x: number | null, y: number | null): number | null {
  return x === null || y === null ? null : Math.hypot(x, y);
}

/** Raw features only: no visibility filter, preview transform, calibration, or classification. */
export function extractPoseFeatures(landmarks: FeatureLandmarks, worldLandmarks: FeatureLandmarks = []): PoseFeatures {
  const leftHip = landmarks[23];
  const rightHip = landmarks[24];
  const leftKnee = landmarks[25];
  const rightKnee = landmarks[26];
  const leftKneeRelativeX = difference(value(leftKnee, 'x'), value(leftHip, 'x'));
  const rightKneeRelativeX = difference(value(rightKnee, 'x'), value(rightHip, 'x'));
  const leftKneeRelativeY = difference(value(leftKnee, 'y'), value(leftHip, 'y'));
  const rightKneeRelativeY = difference(value(rightKnee, 'y'), value(rightHip, 'y'));
  const hipXDifference = difference(value(leftHip, 'x'), value(rightHip, 'x'));

  return {
    hipCenterX: average(value(leftHip, 'x'), value(rightHip, 'x')),
    hipCenterY: average(value(leftHip, 'y'), value(rightHip, 'y')),
    hipWidth: hipXDifference === null ? null : Math.abs(hipXDifference),
    hipDepthDifference: difference(value(worldLandmarks[23], 'z'), value(worldLandmarks[24], 'z')),
    leftKneeRelativeX, rightKneeRelativeX, leftKneeRelativeY, rightKneeRelativeY,
    leftKneeDistanceFromHip: distance(leftKneeRelativeX, leftKneeRelativeY),
    rightKneeDistanceFromHip: distance(rightKneeRelativeX, rightKneeRelativeY),
    leftHipVisibility: value(leftHip, 'visibility'),
    rightHipVisibility: value(rightHip, 'visibility'),
    leftKneeVisibility: value(leftKnee, 'visibility'),
    rightKneeVisibility: value(rightKnee, 'visibility'),
  };
}
