// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ReplayPoint } from '../replay/replayTypes';
import { rawReliabilityGeometry, freezeGeometryBaseline, measureReliabilityFrame, assignmentContinuity, continuityDelta, geometryRatio, vectorDot, vectorLength, type RawReliabilityGeometry } from './geometryReliabilityFeatures';
import { markerDecision } from './geometryReliabilityMarkers';

function points(): ReplayPoint[] {
  const p = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: .99 }));
  p[23] = { x: -.2, y: 0, z: 0, visibility: .99 }; p[24] = { x: .2, y: 0, z: 0, visibility: .99 };
  p[11] = { x: -.3, y: -.4, z: .1, visibility: .99 }; p[12] = { x: .3, y: -.4, z: .1, visibility: .99 };
  p[25] = { x: -.25, y: .35, z: .1, visibility: .99 }; p[26] = { x: .25, y: .35, z: .1, visibility: .99 };
  p[27] = { x: -.25, y: .7, z: .2, visibility: .99 }; p[28] = { x: .25, y: .7, z: .2, visibility: .99 };
  return p;
}
const raw = () => rawReliabilityGeometry(points(), points());
const baseline = () => freezeGeometryBaseline([raw()], .4);
const measure = (g: RawReliabilityGeometry, before: ReturnType<typeof measureReliabilityFrame> | null = null, t = 50) => measureReliabilityFrame(g, baseline(), before, t);
const collapse = (p: ReplayPoint[]) => { p[25] = { ...p[23] }; };
describe('image versus world geometry diagnostics', () => {
  it('detects image collapse against stable world geometry without hiding high visibility', () => {
    const image = points(); collapse(image); const m = measure(rawReliabilityGeometry(image, points()));
    expect(m.values).toMatchObject({ 'image.leftHipKneeRatio': 0, 'world.leftHipKneeRatio': 1, 'projection.leftHipKneeDeviation': 1, leftKneeVisibility: .99 });
    expect(markerDecision({ ...m, stageIndex: 0, calibrationOnly: false }, 'LEFT', { family: 'IMAGE_WORLD_PROJECTION_DISAGREEMENT', threshold: .5 }).decision).toBe(true);
  });
  it('detects world bone instability when image and world both collapse, without a fake ratio', () => {
    const p = points(); collapse(p); const m = measure(rawReliabilityGeometry(p, p));
    expect(m.values['world.leftHipKneeRatioDeviation']).toBe(1); expect(m.values['projection.leftHipKneeRelativeRatio']).toBeNull();
  });
  it('removes whole-body translation from image and world assignment costs', () => {
    const translated = points().map((p) => ({ ...p, x: p.x + 3, y: p.y - 2, z: p.z + 1 }));
    const current = rawReliabilityGeometry(translated, translated), b = baseline();
    for (const space of ['image', 'world'] as const) {
      const cost = assignmentContinuity(current[space], raw()[space], space === 'image' ? b.bodyScale : b.worldLegScale, 33);
      expect(cost.same).toBeCloseTo(0); expect(cost.advantage!).toBeLessThan(0);
    }
  });
  it('makes swapped assignment cheaper for a synthetic left/right knee swap', () => {
    const p = points(); [p[25], p[26]] = [p[26], p[25]];
    const current = rawReliabilityGeometry(p, p), b = baseline();
    for (const space of ['image', 'world'] as const) {
      const c = assignmentContinuity(current[space], raw()[space], space === 'image' ? b.bodyScale : b.worldLegScale, 33);
      expect(c.swapped).toBe(0); expect(c.advantage!).toBeGreaterThan(0);
    }
    expect(measure(current).flags['image.orderingSignInverted']).toBe(true);
  });
  it('keeps same assignment cheaper for modest unilateral movement', () => {
    const p = points(); p[25].y += .05; const c = assignmentContinuity(rawReliabilityGeometry(p, p).world, raw().world, baseline().worldLegScale, 33);
    expect(c.same!).toBeLessThan(c.swapped!);
  });
  it('leaves angles unavailable for a numerically degenerate pelvis axis', () => {
    const p = points(); p[24] = { ...p[23], x: p[23].x + 1e-10 }; const m = measure(rawReliabilityGeometry(p, points()));
    expect(m.values['image.pelvisAxisDeg']).toBeNull(); expect(m.values['image.pelvisAxisAngularVelocity']).toBeNull();
    expect(m.flags['image.pelvisNumericDegeneracy']).toBe(true);
  });
  it('only disables the 3D torso frame when a shoulder is unavailable', () => {
    const p = points(); p[11].visibility = .49; const m = measure(rawReliabilityGeometry(p, p));
    expect(m.values['LEFT.worldLocal3DMagnitude']).toBeNull(); expect(m.values['LEFT.worldMovementMagnitude']).toBe(0);
    expect(m.values['world.leftHipKneeRatio']).toBe(1); expect(m.values['projection.leftHipKneeRelativeRatio']).toBe(1);
  });
  it('retains knee diagnostics with a missing ankle', () => {
    const p = points(); p[27].visibility = .49; const m = measure(rawReliabilityGeometry(p, p));
    expect(m.values['world.leftKneeAnkleRatio']).toBeNull(); expect(m.values['projection.leftKneeAnkleDeviation']).toBeNull();
    expect(m.values['LEFT.worldLocal3DMagnitude']).toBe(0); expect(m.values['world.leftHipKneeRatio']).toBe(1);
  });
  it('invalid or zero denominators are unavailable, including a zero worldLegScale', () => {
    for (const denominator of [0, -1, NaN, Infinity, null, 1e-10]) expect(geometryRatio(1, denominator)).toBeNull();
    const p = points(); p[25] = { ...p[23] }; p[26] = { ...p[24] }; const g = rawReliabilityGeometry(p, p), b = freezeGeometryBaseline([g], .4);
    expect(b.worldLegScale).toBeNull(); expect(b.world.segments.leftHipKnee.median).toBeNull();
    expect(measureReliabilityFrame(g, b, null, 0).values['LEFT.worldMovementMagnitude']).toBeNull();
  });
  it.each([0, -10, 400, 1000])('breaks continuity for dt=%ims', (dt) => {
    const previous = measure(raw(), null, 100), p = points(); p[25].y += .1;
    const m = measure(rawReliabilityGeometry(p, p), previous, 100 + dt);
    expect(m.values['world.leftHipKneeDeltaRatio']).toBeNull(); expect(m.values['world.leftHipKneeRatioVelocityPerSec']).toBeNull();
    expect(m.values['image.swapAdvantage']).toBeNull(); expect(m.values['image.pelvisAxisAngularVelocity']).toBeNull();
  });
  it('does not bridge a missing intermediate observation', () => {
    const p = points(); p[25].visibility = 0;
    const missing = measure(rawReliabilityGeometry(p, p)); const m = measure(raw(), missing, 100);
    expect(m.values['world.leftHipKneeRatioVelocityPerSec']).toBeNull(); expect(m.values['world.swapAdvantage']).toBeNull();
  });
  it('uses shortest angular delta at +179/-179 degrees', () => {
    const angled = (deg: number) => { const p = points(), a = deg * Math.PI / 180; p[23].x = 0; p[24].x = .4 * Math.cos(a); p[24].y = .4 * Math.sin(a); return rawReliabilityGeometry(p, points()); };
    const before = measure(angled(179), null, 0), after = measure(angled(-179), before, 100);
    expect(after.values['image.pelvisAxisAngularVelocity']).toBeCloseTo(20);
  });
  it('keeps missing geometry null, not a no-anomaly observation', () => {
    const m = measure(rawReliabilityGeometry([], []));
    expect(m.values['world.leftHipKneeRatioDeviation']).toBeNull(); expect(m.values['image.leftKneeAnkleRatioDeviation']).toBeNull();
    expect(m.values['LEFT.worldMovementMagnitude']).toBeNull(); expect(m.values['world.kneeDepthDifference']).toBeNull();
  });
  it('uses a deterministic orthonormal right-handed 3D frame and frozen scale', () => {
    const g = raw(), axes = g.world.axes!, b = baseline(), saved = JSON.stringify(b);
    expect(vectorLength(axes.eLat)).toBeCloseTo(1); expect(vectorLength(axes.eLong)).toBeCloseTo(1); expect(vectorLength(axes.eDepth)).toBeCloseTo(1);
    expect(vectorDot(axes.eLat, axes.eLong)).toBeCloseTo(0); expect(vectorDot(axes.eDepth, axes.eLong)).toBeCloseTo(0);
    const p = points(); p[25].z += .3;
    const m = measureReliabilityFrame(rawReliabilityGeometry(points(), p), b, null, 10);
    expect(m.values['LEFT.worldSameHipDeltaMagnitude']).toBeCloseTo(.3 / b.worldLegScale!);
    expect(m.values['LEFT.worldLocal3DMagnitude']).toBeCloseTo(.3 / b.worldLegScale!);
    expect(JSON.stringify(b)).toBe(saved);
  });
  it('requires image visibility and honors optional recorded world visibility independently', () => {
    const p = points(), w = points(); w[25].visibility = null;
    expect(rawReliabilityGeometry(p, w).world.LEFT.vector).not.toBeNull(); w[25].visibility = .49;
    expect(rawReliabilityGeometry(p, w).world.LEFT.vector).toBeNull(); expect(rawReliabilityGeometry(p, w).image.LEFT.vector).not.toBeNull();
    w[25].visibility = .99; p[23].visibility = .69; expect(rawReliabilityGeometry(p, w).world.LEFT.vector).toBeNull();
    expect(continuityDelta(1, null, 33)).toBeNull();
  });
});
