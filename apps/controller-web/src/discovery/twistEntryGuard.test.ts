import { describe, expect, it } from 'vitest';
import { TwistEntryGuard, twistEntryDecision, twistGuardConfigs, type TwistGuardConfig } from './twistEntryGuard';
import { IntegrityShadow, PRE_REGISTERED_INTEGRITY_CONFIG, FIXED_FLEXION_CONFIG } from './integrityGuard';
import { integrityGeometry, type IntegrityMeasurement } from './integrityFeatures';
import { bilateralValues, type TwistFrame, type TwistValues } from './twistConfusionFeatures';
import { TWIST_NUMERIC_FEATURES } from './analyzeTwistConfusion';

const combined: TwistGuardConfig = { guardType: 'HIP_DEPTH_AND_BILATERAL_Y', hipThreshold: .75, symmetryThreshold: .5 };
const depth: TwistGuardConfig = { guardType: 'HIP_DEPTH', hipThreshold: .75, symmetryThreshold: null };
const bilateral: TwistGuardConfig = { guardType: 'BILATERAL_Y', hipThreshold: null, symmetryThreshold: .5 };
function values(leftY: number | null, rightY: number | null, hip = 0): TwistValues {
  const y = bilateralValues(leftY, rightY);
  return { ...Object.fromEntries(TWIST_NUMERIC_FEATURES.map((k) => [k, 0])) as Omit<TwistValues, 'sameSignY'>,
    leftY, rightY, absNormalizedHipDepthDifference: hip, hipMotionScore: hip,
    yMax: y.max, yMin: y.min, yDominanceAbs: y.dominanceAbs, ySymmetryRatio: y.symmetryRatio, sameSignY: null };
}
function measurement(y: number | null, velocity: number): IntegrityMeasurement {
  return { ...integrityGeometry([], [], 'LEFT'), deltaDyNorm: y, deltaDyNormVelocity: velocity,
    kneeRelativeX: 0, kneeRelativeY: 0, kneeRelativeXNorm: 0, kneeRelativeYNorm: y, kneeCenterRelative2DVelocity: Math.abs(velocity),
    hipKneeRatio: 1, kneeAnkleRatio: 1, kneeAngleVelocity: 0, trackingState: 'READY', candidateRunMs: 0 };
}
function frame(timestamp: number, left: number | null, right: number | null, hip = 0, velocity = 0): TwistFrame {
  return { timestamp, stageIndex: 0, calibrationOnly: false, ankleVisible: { LEFT: true, RIGHT: true },
    LEFT: { Y: left, X: 0, FLEXION: 0 }, RIGHT: { Y: right, X: 0, FLEXION: 0 },
    measurements: { LEFT: measurement(left, velocity), RIGHT: measurement(right, 0) }, twist: values(left, right, hip) };
}
function runner(config: TwistGuardConfig) {
  const guard = new TwistEntryGuard(config), detector = new IntegrityShadow(PRE_REGISTERED_INTEGRITY_CONFIG, FIXED_FLEXION_CONFIG, guard.evaluate);
  return { guard, detector };
}
describe('entry-only exploratory suppression', () => {
  it('keeps neutral hips + unilateral kick and declares combined behavior for strong hips + unilateral movement', () => {
    expect(twistEntryDecision(values(.6, .1), combined)).toBe(false);
    expect(twistEntryDecision(values(.6, .1), depth)).toBe(false);
    expect(twistEntryDecision(values(.6, .1, 2), depth)).toBe(true);
    expect(twistEntryDecision(values(.6, .1, 2), combined)).toBe(false);
  });
  it('vetoes strong hip depth + active bilateral Y at entry', () => {
    expect(twistEntryDecision(values(.6, .5, 2), combined)).toBe(true);
    const { guard, detector } = runner(combined); detector.processFrame(frame(0, 0, 0));
    expect(detector.processFrame(frame(50, .6, .5, 2))).toBeNull(); expect(detector.processFrame(frame(150, .6, .5, 2))).toBeNull();
    expect(guard.observations.filter((o) => o.activation)).toHaveLength(2); // one per limb, not per blocked frame
    expect(detector.getSoftEpisodes()).toEqual([]);
  });
  it('treats one missing limb as bilateral unavailable, never automatic veto', () => {
    expect(twistEntryDecision(values(.6, null, 2), bilateral)).toBeNull();
    expect(twistEntryDecision(values(.6, null, 2), combined)).toBeNull();
    const { detector } = runner(combined); detector.processFrame(frame(0, 0, null));
    detector.processFrame(frame(50, .6, null, 2)); expect(detector.processFrame(frame(100, .6, null, 2))?.direction).toBe('KNEE_LEFT');
  });
  it('requires both Y values >= existing0.4: similarity of two small values cannot veto flexion entry', () => {
    expect(twistEntryDecision(values(.3, .29, 2), bilateral)).toBe(false);
    expect(twistEntryDecision(values(.4, .4, 2), bilateral)).toBe(true);
    expect(twistEntryDecision(values(0, 0, 2), bilateral)).toBe(false);
  });
  it('ignores a strong past hip peak when the actual entry frame is clear', () => {
    const { guard, detector } = runner(depth);
    detector.processFrame(frame(0, 0, 0, 5)); detector.processFrame(frame(50, .6, 0, 0));
    expect(detector.processFrame(frame(100, .6, 0, 0))?.direction).toBe('KNEE_LEFT');
    expect(guard.observations.filter((o) => o.decision)).toEqual([]);
  });
  it('does not cancel an ongoing side run when hip proxy rises later or a second channel enters', () => {
    const { guard, detector } = runner(depth); detector.processFrame(frame(0, 0, 0)); detector.processFrame(frame(50, .6, 0));
    const late = frame(100, .6, 0, 5); late.LEFT.FLEXION = 30;
    expect(detector.processFrame(late)?.direction).toBe('KNEE_LEFT');
    expect(guard.observations).toHaveLength(1); expect(guard.observations[0].timestamp).toBe(50);
  });
  it('retries a denied entry with current data; never latches a past twist decision or waits for a new invented clear dwell', () => {
    const { detector } = runner(depth); detector.processFrame(frame(0, 0, 0)); detector.processFrame(frame(50, .6, 0, 5));
    detector.processFrame(frame(100, .6, 0, 0));
    expect(detector.processFrame(frame(150, .6, 0, 0))).toMatchObject({ direction: 'KNEE_LEFT', candidateStartedAt: 100 });
  });
  it('checks a new flexion entry when the previous Y run ends on this frame', () => {
    const { guard, detector } = runner(depth); detector.processFrame(frame(0, 0, 0)); detector.processFrame(frame(50, .6, 0));
    const next = frame(100, 0, 0, 5); next.LEFT.FLEXION = 30;
    detector.processFrame(next);
    expect(guard.observations.at(-1)).toMatchObject({ timestamp: 100, side: 'LEFT', decision: true });
    expect(detector.getView().sides.LEFT.FLEXION.runAt).toBeNull();
  });
  it('leaves integrity12 and its recovery independent of hip veto', () => {
    const { detector, guard } = runner(depth); detector.processFrame(frame(0, 0, 0)); detector.processFrame(frame(50, .6, 0, 0, 13));
    expect(detector.getSoftEpisodes()[0].reasons[0]).toMatchObject({ feature: 'Y_VELOCITY', threshold: 12 });
    expect(guard.observations).toEqual([]);
    detector.processFrame(frame(100, 0, 0)); detector.processFrame(frame(200, 0, 0));
    expect(detector.getSoftView().LEFT.state).toBe('READY');
    detector.processFrame(frame(250, .6, 0)); expect(detector.processFrame(frame(300, .6, 0))?.direction).toBe('KNEE_LEFT');
  });
  it('uses a bounded28-config grid without altering registered velocity12 or flexion thresholds', () => {
    expect(twistGuardConfigs()).toHaveLength(28);
    expect(new Set(twistGuardConfigs().map((c) => JSON.stringify(c))).size).toBe(28);
    expect(PRE_REGISTERED_INTEGRITY_CONFIG).toEqual({ guardType: 'Y_VELOCITY', velocity: 12, minRatio: null });
    expect(FIXED_FLEXION_CONFIG).toMatchObject({ flexEnter: 15, flexDwellMs: 67, flexClear: 5, flexClearDwellMs: 150 });
    expect(() => new TwistEntryGuard({ ...depth, hipThreshold: .123 })).toThrow('bounded');
  });
});
