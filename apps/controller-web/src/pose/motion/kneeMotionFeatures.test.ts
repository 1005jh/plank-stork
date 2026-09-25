// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { calculateKneeMotionVelocity, extractKneeMotionFeatures, MAX_VELOCITY_GAP_MS, motionPoseValid } from './kneeMotionFeatures';
import { motionFrame } from './testFixtures';

describe('pure knee motion geometry', () => {
  it('measures hip center, center/same-side offsets, 2D distances, projection and visibility', () => {
    const features = extractKneeMotionFeatures(motionFrame(0).landmarks);
    expect(features.hipCenterX).toBe(0.5); expect(features.hipWidth).toBeCloseTo(0.2);
    expect(features.leftKneeCenterOffsetX).toBeCloseTo(-0.15); expect(features.rightKneeCenterOffsetX).toBeCloseTo(0.15);
    expect(features.maxAbsKneeCenterOffsetX).toBeCloseTo(0.15);
    expect(features.leftKneeHipOffsetX).toBeCloseTo(-0.05); expect(features.rightKneeHipOffsetX).toBeCloseTo(0.05);
    expect(features.leftKneeHipDistance).toBeCloseTo(Math.hypot(0.05, 0.3));
    expect(features.rightKneeHipDistance).toBeCloseTo(Math.hypot(0.05, 0.3));
    expect(features.leftKneePelvisProjection).toBeCloseTo(-0.15);
    expect(features.rightKneePelvisProjection).toBeCloseTo(0.15);
    expect(features).toMatchObject({ leftHipVisibility: 0.95, rightHipVisibility: 0.95, leftKneeVisibility: 0.7, rightKneeVisibility: 0.6 });
    expect(motionPoseValid(features)).toBe(true);
  });

  it('uses the signed 2D pelvis axis rather than assuming screen X', () => {
    const { landmarks } = motionFrame(0);
    landmarks[23] = { x: 0.5, y: 0.4, z: 0 }; landmarks[24] = { x: 0.5, y: 0.6, z: 0 };
    landmarks[25] = { x: 0.2, y: 0.8, z: 0 }; landmarks[26] = { x: 0.8, y: 0.7, z: 0 };
    const result = extractKneeMotionFeatures(landmarks);
    expect(result.leftKneeCenterOffsetX).toBeCloseTo(-0.3);
    expect(result.leftKneePelvisProjection).toBeCloseTo(0.3);
    expect(result.rightKneePelvisProjection).toBeCloseTo(0.2);
    [landmarks[23], landmarks[24]] = [landmarks[24], landmarks[23]];
    expect(extractKneeMotionFeatures(landmarks).leftKneePelvisProjection).toBeCloseTo(-0.3);
  });

  it.each([0, 0.00001, NaN])('returns null projection for degenerate/invalid hip width %s', (width) => {
    const { landmarks } = motionFrame(0); landmarks[24] = { ...landmarks[23], x: landmarks[23].x + width };
    expect(extractKneeMotionFeatures(landmarks)).toMatchObject({ leftKneePelvisProjection: null, rightKneePelvisProjection: null });
  });

  it('keeps partial/missing data null and records low visibility without inventing a detection cutoff', () => {
    const { landmarks } = motionFrame(0); landmarks[25].x = NaN; landmarks[26].visibility = 0.1;
    const features = extractKneeMotionFeatures(landmarks);
    expect(features.leftKneeCenterOffsetX).toBeNull(); expect(features.maxAbsKneeCenterOffsetX).toBeNull();
    expect(features.rightKneeCenterOffsetX).toBeCloseTo(0.15); expect(features.rightKneeVisibility).toBe(0.1);
    expect(motionPoseValid(features)).toBe(false);
    expect(Object.values(extractKneeMotionFeatures([])).every((value) => value === null)).toBe(true);
  });
});

describe('temporal velocities', () => {
  it('compensates common body translation and preserves only relative knee motion', () => {
    const frame = motionFrame(0); const before = extractKneeMotionFeatures(frame.landmarks);
    frame.landmarks.forEach((point) => { point.x += 0.02; });
    frame.landmarks[25].x += 0.1;
    const after = extractKneeMotionFeatures(frame.landmarks);
    const velocity = calculateKneeMotionVelocity(after, 200, { timestamp: 100, features: before });
    expect(velocity.deltaTimeMs).toBe(100);
    expect(velocity.hipCenterVelocityX).toBeCloseTo(0.2);
    expect(velocity.leftKneeVelocityX).toBeCloseTo(1.2); expect(velocity.rightKneeVelocityX).toBeCloseTo(0.2);
    expect(velocity.leftKneeRelativeVelocityX).toBeCloseTo(1); expect(velocity.rightKneeRelativeVelocityX).toBeCloseTo(0);
    expect(velocity.leftKneeCenterOffsetVelocityX).toBeCloseTo(1); expect(velocity.leftKneeHipOffsetVelocityX).toBeCloseTo(1);
    expect(velocity.leftKneeHipDistanceVelocity).toBeCloseTo((after.leftKneeHipDistance! - before.leftKneeHipDistance!) / 0.1);
  });

  it.each([0, -10, MAX_VELOCITY_GAP_MS, 1000])('rejects unsafe dt=%s without infinities or zero placeholders', (dt) => {
    const features = extractKneeMotionFeatures(motionFrame(0).landmarks);
    const velocity = calculateKneeMotionVelocity(features, 100 + dt, { features, timestamp: 100 });
    expect(velocity.deltaTimeMs).toBe(dt);
    expect(Object.entries(velocity).filter(([key]) => key !== 'deltaTimeMs').every(([, value]) => value === null)).toBe(true);
  });

  it('requires a previous frame and masks only the unavailable derivative coordinates', () => {
    const { landmarks } = motionFrame(0); const before = extractKneeMotionFeatures(landmarks);
    expect(calculateKneeMotionVelocity(before, 100, null).deltaTimeMs).toBeNull();
    landmarks[25].x = NaN;
    const after = extractKneeMotionFeatures(landmarks);
    expect(calculateKneeMotionVelocity(after, 200, { timestamp: 100, features: before })).toMatchObject({ leftKneeRelativeVelocityX: null, leftKneeHipDistanceVelocity: null, rightKneeRelativeVelocityX: 0 });
  });
});
