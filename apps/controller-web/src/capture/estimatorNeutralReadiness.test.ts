// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EstimatorNeutralReadiness, frameEligibility } from './estimatorNeutralReadiness';
import { motionFrame } from '../pose/motion/testFixtures';
import { REQUIRED_JOINTS, ESTIMATOR_VALIDATION_PROTOCOL_V1 as P } from './estimatorValidationProtocol';

function fill(r: EstimatorNeutralReadiness, n = 60, frozen = true, change = (_f: ReturnType<typeof motionFrame>) => {}) {
  for (let i = 1; i <= n; i++) { const f = motionFrame(i * 50); change(f); r.process(f, i * 50, frozen); }
}
describe('passive estimator neutral reference, independent of production readiness', () => {
  it('requires calibration, 3s elapsed, 60 all-eight frames and production FROZEN', () => {
    const r = new EstimatorNeutralReadiness(); fill(r); expect(r.getView(3000).status).toBe('NOT_STARTED');
    r.reset(0); fill(r, 59); expect(r.getView(3000).status).toBe('COLLECTING');
    r.process(motionFrame(3000), 3000, false); expect(r.getView(3000).status).toBe('COLLECTING');
    r.process(motionFrame(3050), 3050, true);
    expect(r.getView(3050).reference).toMatchObject({ protocolId: P.id, startMs: 50, endMs: 3050, durationMs: 3000, poseFrameCount: 61, analysisReadyFrameCount: 61 });
  });
  it('does not become ready early even with 60 usable frames', () => {
    const r = new EstimatorNeutralReadiness(); r.reset(0);
    for (let t = 1; t <= 60; t++) r.process(motionFrame(t), t, true);
    expect(r.getView(2999).status).toBe('COLLECTING');
  });
  it.each(REQUIRED_JOINTS)('uses exact threshold for $name and reports the missing joint', ({ name, index, threshold }) => {
    const r = new EstimatorNeutralReadiness(); r.reset(0);
    fill(r, 60, true, (f) => { f.landmarks[index].visibility = threshold - .01; });
    expect(r.getView(3000).status).toBe('COLLECTING');
    expect(r.getView(3000).current.filter((j) => !j.usable).map((j) => j.name)).toEqual([name]);
    expect(r.getView(3000).perJointUsableFrames[name]).toBe(0);
    r.reset(0); fill(r, 60, true, (f) => { f.landmarks[index].visibility = threshold; });
    expect(r.getView(3000).status).toBe('READY');
  });
  it('requires finite image XY/world XYZ and validates world visibility only when present', () => {
    const f = motionFrame(0); expect(frameEligibility(f).every((j) => j.usable)).toBe(true);
    f.worldLandmarks = []; expect(frameEligibility(f).every((j) => !j.usable)).toBe(true);
    for (const space of ['landmarks', 'worldLandmarks'] as const) for (const key of space === 'landmarks' ? ['x', 'y'] as const : ['x', 'y', 'z'] as const) {
      const invalid = motionFrame(0); invalid[space][27][key] = NaN;
      expect(frameEligibility(invalid).find((j) => j.name === 'LEFT_ANKLE')?.usable).toBe(false);
    }
    for (const visibility of [null, NaN, .49, .50] as const) {
      const f = motionFrame(0); Object.assign(f.worldLandmarks[27], { visibility });
      expect(frameEligibility(f).find((j) => j.name === 'LEFT_ANKLE')?.usable).toBe(visibility === .50);
    }
    const missing = frameEligibility({ landmarks: [], worldLandmarks: [] })[0]; expect(missing.visibility).toBeNull();
  });
  it('expires old good frames instead of accumulating them forever', () => {
    const r = new EstimatorNeutralReadiness(); r.reset(0); fill(r, 60, false);
    r.process(motionFrame(6100), 6100, true);
    expect(r.getView(6100)).toMatchObject({ status: 'COLLECTING', analysisReadyFrameCount: 1, poseFrameCount: 1 });
  });
  it('freezes an immutable range, consumes it once, and resets on new calibration', () => {
    const r = new EstimatorNeutralReadiness(); r.reset(0); fill(r);
    const ref = r.getView(3000).reference; expect(r.canStart(3000)).toBe(true);
    const copy = r.takeReference(3200)!; copy.startMs = -999;
    r.process({ ...motionFrame(7000), landmarks: [] }, 7000, true);
    expect(r.getView(7000).reference).toEqual(ref); expect(r.getView(7000).analysisReadyFrameCount).toBe(0);
    expect(r.canStart(7000)).toBe(false); expect(r.takeReference(7000)).toBeNull();
    r.reset(7100); expect(r.getView(7100)).toMatchObject({ status: 'COLLECTING', reference: null, analysisReadyFrameCount: 0, consumed: false, allReadyNow: false });
  });
  it('does not mutate raw points or respond to preview mirroring', () => {
    const f = motionFrame(50), before = structuredClone(f), r = new EstimatorNeutralReadiness(); r.reset(0); r.process(f, 50, true);
    expect(f).toEqual(before); expect(P.thresholdTuningAllowed).toBe(false); expect(Object.isFrozen(P.visibility)).toBe(true);
  });
});
