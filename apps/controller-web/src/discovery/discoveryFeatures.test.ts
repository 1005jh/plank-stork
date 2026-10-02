import { describe, expect, it } from 'vitest';
import { motionFrame } from '../pose/motion/testFixtures';
import { copyPoseFrame } from '../replay/replayTypes';
import { buildNeutralReference, discoveryFeatures, rawDiscoveryFrame, recordedVelocity } from './discoveryFeatures';

const frame = (tMs = 0) => copyPoseFrame(motionFrame(tMs), 0, 1);
const baseline = { leftMedian: -0.15, rightMedian: 0.15, leftDistanceMedian: Math.hypot(0.05, 0.3), rightDistanceMedian: Math.hypot(0.05, 0.3), bodyScale: 0.3 };
const reference = () => buildNeutralReference([frame()]);
describe('limb-relative feature discovery geometry (no detector)', () => {
  it('removes whole-body XY translation while retaining hip-center diagnostics', () => {
    const current = frame();
    current.landmarks.forEach((p) => { p.x += 0.22; p.y -= 0.12; });
    const values = discoveryFeatures(current, reference(), baseline);
    for (const side of ['LEFT', 'RIGHT'] as const) {
      expect(values.hipCenterRelative2DDisplacement[side]).toBeCloseTo(0);
      expect(values.sameHip2DDisplacementNorm[side]).toBeCloseTo(0);
      expect(values.absoluteDistanceChange[side]).toBeCloseTo(0);
    }
    expect(values.hipCenterXChange.GLOBAL).toBeCloseTo(0.22);
    expect(values.hipCenterYChange.GLOBAL).toBeCloseTo(-0.12);
  });
  it('captures vertical knee motion when existing lateral X stays zero', () => {
    const current = frame(); current.landmarks[26].y += 0.24;
    const values = discoveryFeatures(current, reference(), baseline);
    expect(values.normalizedXDisplacement.RIGHT).toBeCloseTo(0);
    expect(values.deltaDyNorm.RIGHT).toBeCloseTo(0.8);
    expect(values.hipCenterRelative2DDisplacement.RIGHT).toBeCloseTo(0.8);
    expect(values.sameHip2DDisplacementNorm.RIGHT).toBeCloseTo(0.8);
    expect(values.absoluteDistanceChange.RIGHT).toBeGreaterThan(0.2);
  });
  it('detects depth-only world motion independently from image XY', () => {
    const current = frame(); current.worldLandmarks[26].z += 0.4;
    const values = discoveryFeatures(current, reference(), baseline);
    expect(values.hipCenterRelative2DDisplacement.RIGHT).toBe(0);
    expect(values.world3DDisplacement.RIGHT).toBeCloseTo(0.4);
    expect(values.absDeltaWorldZ.RIGHT).toBeCloseTo(0.4);
    expect(values.world3DDisplacementNorm.RIGHT).toBeCloseTo(0.4 / Math.hypot(0.1, 0.6));
    expect(values.world3DDisplacement.LEFT).toBe(0);
  });
  it.each(['LEFT', 'RIGHT'] as const)('keeps %s evidence limb-specific regardless of motion sign', (side) => {
    const current = frame(), other = side === 'LEFT' ? 'RIGHT' : 'LEFT';
    current.landmarks[side === 'LEFT' ? 25 : 26].x -= 0.18;
    const values = discoveryFeatures(current, reference(), baseline);
    expect(values.hipCenterRelative2DDisplacement[side]).toBeCloseTo(0.6);
    expect(values.hipCenterRelative2DDisplacement[other]).toBe(0);
    expect(values.normalizedXDisplacement[side]).toBeCloseTo(-0.6);
  });
  it('normalizes equivalent skeletons with different image/world scales', () => {
    const measure = (scale: number) => {
      const neutral = frame();
      for (const points of [neutral.landmarks, neutral.worldLandmarks]) points.forEach((p) => { p.x *= scale; p.y *= scale; p.z *= scale; });
      const moved = structuredClone(neutral); moved.landmarks[25].y += 0.15 * scale; moved.worldLandmarks[25].z += 0.2 * scale;
      return discoveryFeatures(moved, buildNeutralReference([neutral]), { ...baseline, bodyScale: baseline.bodyScale * scale });
    };
    const small = measure(0.5), large = measure(1.5);
    for (const key of ['hipCenterRelative2DDisplacement', 'sameHip2DDisplacementNorm', 'distanceChangeNorm', 'world3DDisplacementNorm'] as const) {
      expect(small[key].LEFT).toBeCloseTo(large[key].LEFT!);
    }
  });
  it('isolates low ankle visibility from image/world candidate validity', () => {
    const current = frame(); current.landmarks[27].visibility = 0.1;
    const values = discoveryFeatures(current, reference(), baseline);
    expect(values.kneeFlexionAngle.LEFT).toBeNull(); expect(values.kneeFlexionAngleChange.LEFT).toBeNull();
    expect(values.hipCenterRelative2DDisplacement.LEFT).toBe(0); expect(values.world3DDisplacement.LEFT).toBe(0);
    expect(values.kneeFlexionAngle.RIGHT).not.toBeNull();
  });
  it('isolates absent world landmarks and accepts omitted world visibility', () => {
    const current = frame(); current.worldLandmarks = [];
    expect(discoveryFeatures(current, reference(), baseline).world3DDisplacement.LEFT).toBeNull();
    expect(discoveryFeatures(current, reference(), baseline).sameHip2DDisplacementNorm.LEFT).toBe(0);
    expect(discoveryFeatures(frame(), reference(), baseline).world3DDisplacement.LEFT).toBe(0);
  });
  it('keeps same-side features usable with the opposite hip occluded', () => {
    const current = frame(); current.landmarks[24].visibility = 0.2;
    const values = discoveryFeatures(current, reference(), baseline);
    expect(values.hipCenterRelative2DDisplacement.LEFT).toBeNull();
    expect(values.sameHip2DDisplacementNorm.LEFT).toBe(0); expect(values.sameHip2DDisplacementNorm.RIGHT).toBeNull();
  });
  it('applies independent hip/knee/world visibility guards and no zero imputation', () => {
    const current = frame(); current.landmarks[25].visibility = 0.49; current.worldLandmarks[26].visibility = 0.49;
    const values = discoveryFeatures(current, reference(), baseline);
    expect(values.deltaDy.LEFT).toBeNull(); expect(values.world3DDisplacement.RIGHT).toBeNull();
    expect(values.deltaDy.RIGHT).toBe(0);
    const empty = buildNeutralReference([]);
    expect(discoveryFeatures(frame(), empty, baseline).deltaDx.LEFT).toBeNull();
    expect(discoveryFeatures(frame(), empty, baseline).dx.LEFT).not.toBeNull();
  });
  it('uses robust component/distance/angle medians with per-component valid counts', () => {
    const outlier = frame(); outlier.landmarks[25].x += 10; outlier.worldLandmarks = [];
    const neutral = buildNeutralReference([frame(), outlier, frame()]);
    expect(neutral.LEFT.dx).toBeCloseTo(-0.15); expect(neutral.LEFT.distance).toBeCloseTo(baseline.leftDistanceMedian);
    expect(neutral.usableCounts.LEFT.worldDx).toBe(2); expect(neutral.usableCounts.LEFT.dx).toBe(3);
  });
  it('reports a known 90-degree image knee angle and protects zero geometry', () => {
    const current = frame(); current.landmarks[23] = { x: 0.3, y: 0.5, z: 0, visibility: 1 };
    current.landmarks[25] = { x: 0.3, y: 0.7, z: 0, visibility: 1 };
    current.landmarks[27] = { x: 0.5, y: 0.7, z: 0, visibility: 1 };
    expect(rawDiscoveryFrame(current).LEFT.angle).toBeCloseTo(90);
    current.landmarks[27] = { ...current.landmarks[25] };
    expect(rawDiscoveryFrame(current).LEFT.angle).toBeNull();
  });
  it('matches existing signed X/dominant behavior using the recorded baseline', () => {
    const current = frame(); current.landmarks[25].x -= 0.15; current.landmarks[26].x += 0.09;
    const values = discoveryFeatures(current, reference(), baseline);
    expect(values.kneeCenterOffsetX.LEFT).toBeCloseTo(-0.3);
    expect(values.normalizedXDisplacement.LEFT).toBeCloseTo(-0.5); expect(values.normalizedXDisplacement.RIGHT).toBeCloseTo(0.3);
    expect(values.dominantNormalizedXDisplacement.GLOBAL).toBeCloseTo(-0.5);
  });
});

describe('recorded timestamp velocity', () => {
  it('uses irregular recorded tMs, expressed per second', () => {
    expect(recordedVelocity(0.5, 130, { value: 0.2, tMs: 100 })).toBeCloseTo(10);
    expect(recordedVelocity(0.2, 250, { value: 0.5, tMs: 130 })).toBeCloseTo(-2.5);
  });
  it.each([400, 401, 0, -1])('rejects a %sms gap instead of inventing velocity', (dt) => {
    expect(recordedVelocity(1, 100 + dt, { value: 0, tMs: 100 })).toBeNull();
  });
  it('does not bridge missing observations', () => {
    expect(recordedVelocity(null, 130, { value: 0, tMs: 100 })).toBeNull();
    expect(recordedVelocity(1, 160, { value: null, tMs: 130 })).toBeNull();
    expect(recordedVelocity(1, 160, null)).toBeNull();
  });
});
