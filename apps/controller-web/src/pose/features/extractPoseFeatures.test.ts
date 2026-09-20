// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { extractPoseFeatures } from './extractPoseFeatures';
import { calibratePoseFeatures } from './calibratePoseFeatures';
import { CALIBRATION_FEATURES, type FeatureLandmark, type NeutralCalibration } from './poseFeatureTypes';

function fixture() {
  const landmarks: (FeatureLandmark | null)[] = Array(33).fill(null);
  landmarks[23] = { x: 0.2, y: 0.4, z: 0, visibility: 0.9 };
  landmarks[24] = { x: 0.8, y: 0.6, z: 0, visibility: 0.95 };
  landmarks[25] = { x: 0.5, y: 0.8, z: 0, visibility: 0.2 };
  landmarks[26] = { x: 0.5, y: 1, z: 0, visibility: 0 };
  const worldLandmarks: (FeatureLandmark | null)[] = Array(33).fill(null);
  worldLandmarks[23] = { x: 0, y: 0, z: -0.25 };
  worldLandmarks[24] = { x: 0, y: 0, z: 0.5 };
  return { landmarks, worldLandmarks };
}

describe('pure pose feature extraction', () => {
  it('calculates hip center, width, world depth, knee offsets and 2D distances without visibility filtering', () => {
    const { landmarks, worldLandmarks } = fixture();
    const result = extractPoseFeatures(landmarks, worldLandmarks);
    const expected = {
      hipCenterX: 0.5, hipCenterY: 0.5, hipWidth: 0.6, hipDepthDifference: -0.75,
      leftKneeRelativeX: 0.3, rightKneeRelativeX: -0.3, leftKneeRelativeY: 0.4, rightKneeRelativeY: 0.4,
      leftKneeDistanceFromHip: 0.5, rightKneeDistanceFromHip: 0.5,
      leftHipVisibility: 0.9, rightHipVisibility: 0.95, leftKneeVisibility: 0.2, rightKneeVisibility: 0,
    };
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      expect(result[key], key).toBeCloseTo(expected[key]);
    }
  });

  it.each([23, 24, 25, 26])('propagates a missing landmark %i only to related image features', (index) => {
    const { landmarks, worldLandmarks } = fixture();
    landmarks[index] = null;
    const result = extractPoseFeatures(landmarks, worldLandmarks);
    const side = index === 23 || index === 25 ? 'left' : 'right';
    const other = side === 'left' ? 'right' : 'left';
    expect(result[`${side}KneeRelativeX`]).toBeNull();
    expect(result[`${side}KneeRelativeY`]).toBeNull();
    expect(result[`${side}KneeDistanceFromHip`]).toBeNull();
    expect(result[`${other}KneeDistanceFromHip`]).toBeCloseTo(0.5);
    expect(result.hipCenterX).toBe(index < 25 ? null : 0.5);
    expect(result.hipCenterY).toBe(index < 25 ? null : 0.5);
    expect(result.hipDepthDifference).toBe(-0.75);
  });

  it('keeps image features when world data or one world hip is missing', () => {
    const { landmarks, worldLandmarks } = fixture();
    const expected = { ...extractPoseFeatures(landmarks, worldLandmarks), hipDepthDifference: null };
    expect(extractPoseFeatures(landmarks)).toEqual(expected);
    worldLandmarks[24] = null;
    expect(extractPoseFeatures(landmarks, worldLandmarks)).toEqual(expected);
    expect(Object.values(extractPoseFeatures([]))).toEqual(Array(14).fill(null));
  });

  it('treats non-finite/missing values as null, preserving independent axes and visibility zero', () => {
    const { landmarks } = fixture();
    landmarks[23]!.x = NaN;
    landmarks[25]!.visibility = null;
    const result = extractPoseFeatures(landmarks);
    expect(result.hipCenterX).toBeNull();
    expect(result.leftKneeRelativeX).toBeNull();
    expect(result.hipCenterY).toBe(0.5);
    expect(result.leftKneeVisibility).toBeNull();
    expect(result.rightKneeVisibility).toBe(0);
  });

  it('accepts ordered JSON snapshots directly and never mutates live or offline input', () => {
    const { landmarks, worldLandmarks } = fixture();
    const snapshot = (points: typeof landmarks) => points.map((point, index) => point ? { ...point, index, visibility: point.visibility ?? null } : null);
    const jsonSample = JSON.parse(JSON.stringify({ landmarks: snapshot(landmarks), worldLandmarks: snapshot(worldLandmarks) }));
    const before = JSON.stringify(jsonSample);
    const expected = extractPoseFeatures(landmarks, worldLandmarks);
    expect(extractPoseFeatures(jsonSample.landmarks, jsonSample.worldLandmarks)).toEqual(expected);
    expect(JSON.stringify(jsonSample)).toBe(before);
    const saved = extractPoseFeatures(landmarks, worldLandmarks);
    landmarks[23]!.x = 999;
    expect(saved).toEqual(expected);
  });
});

describe('pure calibrated deltas', () => {
  it('subtracts each Neutral baseline without altering either input', () => {
    const { landmarks, worldLandmarks } = fixture();
    const current = extractPoseFeatures(landmarks, worldLandmarks);
    const baseline = Object.fromEntries(CALIBRATION_FEATURES.map(({ raw }) => [raw, current[raw]! - 0.125])) as NeutralCalibration;
    const before = JSON.stringify({ current, baseline });
    const deltas = calibratePoseFeatures(current, baseline);
    for (const value of Object.values(deltas)) expect(value).toBeCloseTo(0.125);
    expect(JSON.stringify({ current, baseline })).toBe(before);
  });

  it('propagates missing current values and baseline values independently, including no calibration', () => {
    const { landmarks, worldLandmarks } = fixture();
    const current = extractPoseFeatures(landmarks, worldLandmarks);
    const baseline = { ...current, hipDepthDifference: null };
    expect(Object.values(calibratePoseFeatures(current, null))).toEqual(Array(7).fill(null));
    const deltas = calibratePoseFeatures({ ...current, leftKneeRelativeX: null }, baseline);
    expect(deltas.deltaHipDepthDifference).toBeNull();
    expect(deltas.deltaLeftKneeRelativeX).toBeNull();
    expect(deltas.deltaHipCenterX).toBe(0);
    expect(deltas.deltaRightKneeRelativeX).toBe(0);
  });
});
