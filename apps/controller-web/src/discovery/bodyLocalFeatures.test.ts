// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { motionFrame } from '../pose/motion/testFixtures';
import { bodyGeometry, freezeBodyBaseline, calibrateBodyGeometry, decompose, familySignal } from './bodyLocalFeatures';
import { shortestAngleDeg } from './twistConfusionFeatures';
function points() {
  const p = motionFrame(0).landmarks.map((v) => ({ ...v, visibility: v.visibility ?? null }));
  p[11] = { x: .35, y: .1, z: 0, visibility: .9 }; p[12] = { x: .65, y: .1, z: 0, visibility: .9 };
  return p;
}
const calibrate = (p = points()) => calibrateBodyGeometry(bodyGeometry(p), freezeBodyBaseline([bodyGeometry(points())], .3), { LEFT: 0, RIGHT: 0 });
describe('frozen body-local geometry', () => {
  it('removes whole-body translation from same-side and pelvis projections', () => {
    const p = points(), a = bodyGeometry(p), b = bodyGeometry(p.map((v) => ({ ...v, x: v.x + .2, y: v.y - .1 })));
    for (const s of ['LEFT', 'RIGHT'] as const) for (const k of ['sameHipX', 'sameHipY', 'pelvisLat', 'pelvisNorm'] as const) expect(b[s][k]).toBeCloseTo(a[s][k]!);
  });
  it('removes whole-body image-plane rotation from pelvis/torso projections', () => {
    const p = points(), a = bodyGeometry(p), theta = .8;
    const b = bodyGeometry(p.map((v) => ({ ...v, x: v.x * Math.cos(theta) - v.y * Math.sin(theta), y: v.x * Math.sin(theta) + v.y * Math.cos(theta) })));
    for (const s of ['LEFT', 'RIGHT'] as const) for (const k of ['pelvisLat', 'pelvisNorm', 'torsoLong', 'torsoSide', 'pelvisRelativeAngle', 'torsoRelativeAngle'] as const) expect(b[s][k]).toBeCloseTo(a[s][k]!);
  });
  it('keeps unilateral movement on its landmark side and uses the frozen scale', () => {
    const p = points(); p[25].y += .15;
    const v = calibrate(p); expect(v.LEFT.sameHipDeltaYNorm).toBeCloseTo(.5); expect(v.RIGHT.sameHipDeltaYNorm).toBe(0);
    expect(v.LEFT.pelvisNormDeltaNorm).toBeCloseTo(.5); expect(v.RIGHT.pelvisNormDeltaNorm).toBe(0);
    const p2 = points(); p2[23].x -= .1; p2[24].x += .1; p2[25].y += .15;
    expect(calibrate(p2).LEFT.sameHipDeltaYNorm).toBeCloseTo(.5);
  });
  it('isolates each missing knee and requires both sides only for bilateral evidence', () => {
    const p = points(); p[25].visibility = .49; const v = calibrate(p);
    expect(v.LEFT.sameHipDeltaYNorm).toBeNull(); expect(v.RIGHT.sameHipDeltaYNorm).toBe(0);
    expect(v.bilateral.sameHip.common).toBeNull(); expect(v.bilateral.pelvis.rightResidual).toBeNull();
  });
  it('missing shoulder only removes torso features', () => {
    const p = points(); p[11].visibility = .49; const v = calibrate(p);
    expect(v.LEFT.torsoLongDeltaNorm).toBeNull(); expect(v.LEFT.pelvisNormDeltaNorm).toBe(0); expect(v.LEFT.sameHipDeltaYNorm).toBe(0);
  });
  it('degenerate pelvis invalidates local axes but preserves same-hip evidence', () => {
    const p = points(); p[24] = { ...p[23] }; const v = calibrate(p);
    expect(v.LEFT.pelvisNormDeltaNorm).toBeNull(); expect(v.LEFT.torsoLongDeltaNorm).toBeNull(); expect(v.LEFT.sameHipDeltaYNorm).toBe(0);
  });
  it('maintains hip .7 and knee/shoulder .5 visibility boundaries', () => {
    const p = points(); p[23].visibility = .699; expect(bodyGeometry(p).LEFT.sameHipY).toBeNull();
    p[23].visibility = .7; p[25].visibility = .5; p[11].visibility = .5; expect(bodyGeometry(p).LEFT.torsoLong).not.toBeNull();
  });
  it('does not replace missing baselines or zero-denominator ratios with zero', () => {
    const p = points(); p[25].visibility = 0;
    const b = freezeBodyBaseline([bodyGeometry(p)], .3), v = calibrateBodyGeometry(bodyGeometry(points()), b, { LEFT: null, RIGHT: 0 });
    expect(v.LEFT.sameHipDeltaYNorm).toBeNull(); expect(v.bilateral.oldY.differential).toBeNull(); expect(decompose(0, 0).commonToDiffRatio).toBeNull();
  });
  it('identical bilateral motion increases common and cancels differential/residual', () => {
    const p = points(); p[25].y += .15; p[26].y += .15; const v = calibrate(p);
    expect(v.bilateral.sameHip.common).toBeCloseTo(.5); expect(v.bilateral.sameHip.absDiff).toBe(0);
    expect(v.bilateral.sameHip.leftResidual).toBe(0);
  });
  it('residual magnitudes cannot identify the moved side', () => {
    const p = points(); p[25].y += .15; const v = calibrate(p);
    for (const f of ['PELVIS_DIFFERENTIAL', 'TORSO_DIFFERENTIAL', 'SAME_HIP_RESIDUAL'] as const)
      expect(Math.abs(familySignal(v, 'LEFT', f)!)).toBe(Math.abs(familySignal(v, 'RIGHT', f)!));
  });
  it('uses a circular frozen reference and shortest wrapped angle', () => {
    expect(shortestAngleDeg(-179, 179)).toBe(2); expect(shortestAngleDeg(179, -179)).toBe(-2);
    const base = bodyGeometry(points()), b = freezeBodyBaseline([{ ...base, LEFT: { ...base.LEFT, sameHipVectorAngle: 179 } }, { ...base, LEFT: { ...base.LEFT, sameHipVectorAngle: -179 } }], .3);
    expect(Math.abs(b.LEFT.sameHipVectorAngle.value!)).toBeCloseTo(180);
  });
});
