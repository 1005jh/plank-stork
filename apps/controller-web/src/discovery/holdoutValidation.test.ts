// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveHarness, fullV3Trial, ORIGIN, TRIAL_AT } from '../replay/testFixtures';
import { motionFrame } from '../pose/motion/testFixtures';
import { latestCalibrationStart, replayCalibration } from '../replay/landmarkReplay';
import { prepareIntegrityInputs, type IntegrityFixture } from './integrityFeatures';
import { HOLDOUT_ROLE, validateIntegrityHoldout } from './holdoutValidation';
import { PRE_REGISTERED_INTEGRITY_CONFIG, integrityConfigs, NO_INTEGRITY_GUARD } from './integrityGuard';
import * as analysis from './analyzeIntegrity';

// Synthetic raw landmark captures run through LIVE and replay; no new human data.
async function synthetic(kind: 'clean' | 'false11' | 'kick13' | 'flexion' | 'activation' = 'clean') {
  const live = liveHarness(true, 'Y_V3');
  for (let t = 20; t <= 22020; t += 40) {
    const f = motionFrame(ORIGIN + TRIAL_AT + t), scale = live.baseline.bodyScale;
    f.landmarks[27].visibility = 0;
    if (kind !== 'flexion') f.landmarks[28].visibility = 0;
    const ramp = (start: number) => t < start || t > start + 360 ? 0 : Math.min(.6, (t - start + 40) / 40 * .2);
    const leftStart = kind === 'activation' ? 12220 : 12060;
    let left = ramp(leftStart), right = kind === 'flexion' ? 0 : ramp(17060);
    if (kind === 'false11' && t >= 2020 && t <= 2300) left = .44; // 11/s: veto10 only.
    if (kind === 'kick13' && t >= 12060 && t <= 12420) left = .52; // 13/s: veto12, not15.
    if (kind === 'activation' && t === 12020) left = .52; // Too short to emit, but expected-limb veto.
    f.landmarks[25].y += left * scale; f.landmarks[26].y += right * scale;
    if (kind === 'flexion' && t >= 17060 && t <= 17420) {
      // Fold ankle onto the hip ray: angle 0, unchanged knee Y.
      f.landmarks[28].x = f.landmarks[24].x; f.landmarks[28].y = f.landmarks[24].y;
    }
    live.frame(f); if (t % 160 === 20) live.clock(t + 8);
  }
  const session = await live.finish();
  return { session, fixture: prepareIntegrityInputs([{ filename: 'arbitrary.json', role: HOLDOUT_ROLE, session }])[0] };
}
// Counterfactual thresholds belong to synthetic exploratory fixtures, never HOLDOUT APIs.
function exploratory(f: IntegrityFixture): IntegrityFixture { return { ...f, input: { ...f.input, role: 'REFERENCE_LIVE_2_INDEPENDENT' } }; }
afterEach(() => vi.restoreAllMocks());

describe('pre-registered independent holdout', () => {
  it('uses exactly one immutable guard12 for two separate modes, with deterministic report and no raw data mutation', async () => {
    const { fixture } = await synthetic(), before = JSON.stringify(fixture);
    const run = vi.spyOn(analysis, 'runIntegrityFixture');
    const r = validateIntegrityHoldout([fixture]);
    expect(run.mock.calls.map(([, c, mode]) => [c, mode])).toEqual([
      [PRE_REGISTERED_INTEGRITY_CONFIG, 'Y_ONLY'], [PRE_REGISTERED_INTEGRITY_CONFIG, 'FIXED_Y_OR_FLEXION']]);
    expect(Object.isFrozen(PRE_REGISTERED_INTEGRITY_CONFIG)).toBe(true);
    expect(r).toMatchObject({ role: HOLDOUT_ROLE, preRegisteredConfig: { guardType: 'Y_VELOCITY', velocity: 12, minRatio: null },
      acceptance: { yGuardSafetyPass: true, fullCandidatePass: true } });
    expect(r.fixedFlexionConfig).toMatchObject({ flexEnter: 15, flexDwellMs: 67, flexClear: 5, flexClearDwellMs: 150, returnPolicy: 'TRIGGER_CHANNEL_CLEAR' });
    expect(r.perFixture[0]).toHaveProperty('yProductionReference'); expect(r.perFixture[0]).toHaveProperty('yWithGuard12');
    expect(JSON.stringify(validateIntegrityHoldout([fixture]))).toBe(JSON.stringify(r));
    expect(JSON.stringify(fixture)).toBe(before); expect(r).not.toHaveProperty('viableIntegrityConfigs');
  });
  it('fails guard12 on a false11/s signal even though exploratory velocity10 passes; never falls back to10', async () => {
    const { fixture } = await synthetic('false11');
    const counterfactual = analysis.runIntegrityFixture(exploratory(fixture), { ...PRE_REGISTERED_INTEGRITY_CONFIG, velocity: 10 }, 'FIXED_Y_OR_FLEXION');
    expect(counterfactual).toMatchObject({ referenceAccepted: true, guardActivationsDuringExpectedLimbKick: 0, softRecoveryFalse: 0 });
    const r = validateIntegrityHoldout([fixture]);
    expect(r.acceptance.fullCandidatePass).toBe(false); expect(r.preRegisteredConfig.velocity).toBe(12);
    expect(r.perFixture[0].fixedFlexionWithGuard12.falseEvents).toBe(1);
    expect(r.perFixture[0].acceptance.fullFailureReasons).toContain('noTwistOrNeutralFalse');
  });
  it('fails guard12 when velocity15 preserves a13/s true kick; reports lost production event without fallback', async () => {
    const { fixture } = await synthetic('kick13');
    const counterfactual = analysis.runIntegrityFixture(exploratory(fixture), { ...PRE_REGISTERED_INTEGRITY_CONFIG, velocity: 15 }, 'FIXED_Y_OR_FLEXION');
    expect(counterfactual).toMatchObject({ referenceAccepted: true, guardActivationsDuringExpectedLimbKick: 0 });
    const r = validateIntegrityHoldout([fixture]);
    expect(r.acceptance).toEqual({ yGuardSafetyPass: false, fullCandidatePass: false });
    expect(r.perFixture[0].acceptance.lostProductionTrueEvents).toHaveLength(1);
    expect(r.perFixture[0].acceptance.yFailureReasons).toContain('productionTrueEventsPreserved');
    expect(r.preRegisteredConfig.velocity).toBe(12);
  });
  it('allows a known production Y miss while fixed flexion detects the missing kick exactly once', async () => {
    const { fixture } = await synthetic('flexion'), r = validateIntegrityHoldout([fixture]);
    expect(r.perFixture[0].yProductionReference.counts).toMatchObject({ leftDetected: 1, rightDetected: 0 });
    expect(r.perFixture[0].yWithGuard12).toMatchObject({ left: 1, right: 0 });
    expect(r.perFixture[0].fixedFlexionWithGuard12).toMatchObject({ left: 1, right: 1, falseEvents: 0 });
    expect(r.perFixture[0].fixedFlexionWithGuard12.events[1].triggerSource).toBe('FLEXION');
    expect(r.acceptance).toEqual({ yGuardSafetyPass: true, fullCandidatePass: true });
  });
  it('does not auto PASS expected-limb kick guard activation even when both true events survive', async () => {
    const { fixture } = await synthetic('activation'), r = validateIntegrityHoldout([fixture]);
    expect(r.perFixture[0].fixedFlexionWithGuard12).toMatchObject({ left: 1, right: 1, falseEvents: 0 });
    expect(r.perFixture[0].acceptance.expectedLimbKickActivations).toBe(1);
    expect(r.acceptance).toEqual({ yGuardSafetyPass: true, fullCandidatePass: false });
    expect(r.perFixture[0].acceptance.fullFailureReasons).toContain('noExpectedLimbKickActivation');
  });
  it('rejects all exploratory entry points and non12 low-level evaluation for HOLDOUT', async () => {
    const { fixture } = await synthetic(), other = exploratory(fixture), evidence = analysis.createIntegrityEvidence([other]);
    expect(() => analysis.createIntegrityEvidence([fixture])).toThrow('HOLDOUT_SWEEP_FORBIDDEN');
    expect(() => analysis.analyzeIntegrity([other, fixture])).toThrow('HOLDOUT_SWEEP_FORBIDDEN');
    expect(() => analysis.analyzeIntegrityConfig([fixture], evidence, PRE_REGISTERED_INTEGRITY_CONFIG)).toThrow('HOLDOUT_SWEEP_FORBIDDEN');
    for (const config of integrityConfigs().filter((c) => JSON.stringify(c) !== JSON.stringify(PRE_REGISTERED_INTEGRITY_CONFIG)))
      expect(() => analysis.runIntegrityFixture(fixture, config, 'Y_ONLY')).toThrow('HOLDOUT_SWEEP_FORBIDDEN');
    const strategy = analysis.analyzeIntegrityConfig([other], evidence, NO_INTEGRITY_GUARD);
    strategy.yOnly.perFixture[0].input.role = HOLDOUT_ROLE;
    expect(() => analysis.createIntegrityReport(evidence, [strategy])).toThrow('HOLDOUT_SWEEP_FORBIDDEN');
  });
  it.each(['events', 'summary', 'baseline', 'final'] as const)('stops before guarded evaluation on LIVE %s mismatch', async (part) => {
    const { session } = await synthetic(), trial = session.liveResult.trials[0];
    if (part === 'events') trial.result.events[0].tMs++;
    if (part === 'summary') trial.result.guidedSummary = null;
    if (part === 'baseline') trial.baselineV3!.bodyScale += .01;
    if (part === 'final') trial.result.finalState = 'WAIT_RETURN';
    const run = vi.spyOn(analysis, 'runIntegrityFixture');
    expect(() => validateIntegrityHoldout(prepareIntegrityInputs([{ filename: 'bad.json', role: HOLDOUT_ROLE, session }]))).toThrow('LIVE_V3_PARITY_MISMATCH');
    expect(run).not.toHaveBeenCalled();
  });
  it('checks every prepared trial before any guard execution, and rejects missing LIVE parity/legacy/empty evidence', async () => {
    const { fixture } = await synthetic(), bad = structuredClone(fixture);
    bad.input.captureId = 'second'; bad.liveReplayParity.matched = false;
    const run = vi.spyOn(analysis, 'runIntegrityFixture');
    expect(() => validateIntegrityHoldout([fixture, bad])).toThrow('LIVE_V3_PARITY_MISMATCH'); expect(run).not.toHaveBeenCalled();
    bad.liveReplayParity.matched = true; bad.liveReplayParity.required = false;
    expect(() => validateIntegrityHoldout([bad])).toThrow('LIVE_V3_PARITY_MISMATCH');
    expect(() => validateIntegrityHoldout([])).toThrow('직접 지정');
    expect(() => validateIntegrityHoldout([exploratory(fixture)])).toThrow('role');
    expect(() => validateIntegrityHoldout([fixture, fixture])).toThrow('중복');
  });
  it('uses the latest successful/frozen calibration, ignoring unfinished attempts and file array order', async () => {
    const { session } = await synthetic(), trial = session.liveResult.trials[0];
    const expected = replayCalibration(session, trial.id);
    session.markers.push({ type: 'NEUTRAL_CALIBRATION_START', tMs: 0, order: 0 }, { type: 'NEUTRAL_FROZEN', tMs: 50, order: 1 },
      { type: 'NEUTRAL_CALIBRATION_START', tMs: 1150, order: 999 });
    session.markers.reverse();
    expect(latestCalibrationStart(session, trial)?.tMs).toBe(1150); // Previous exploratory semantics retained.
    expect(latestCalibrationStart(session, trial, 'LATEST_FROZEN')?.tMs).toBe(100);
    expect(replayCalibration(session, trial.id, 'LATEST_FROZEN')).toEqual(expected);
    const [f] = prepareIntegrityInputs([{ filename: 'multi-calibration.json', role: HOLDOUT_ROLE, session }]);
    expect(f.segmentBaseline.calibrationStartMs).toBe(100); expect(f.baseline.calibrationStartMs).toBe(100);
    expect(validateIntegrityHoldout([f]).acceptance.fullCandidatePass).toBe(true);
  });
  it('requires an actual FROZEN marker and rejects stored baseline disagreement after selecting a successful calibration', async () => {
    const { session } = await synthetic();
    session.markers = session.markers.filter((m) => m.type !== 'NEUTRAL_FROZEN');
    expect(() => prepareIntegrityInputs([{ filename: 'no-frozen.json', role: HOLDOUT_ROLE, session }])).toThrow('LIVE_V3_PARITY_MISMATCH');
    const fresh = (await synthetic()).session;
    fresh.markers.push({ type: 'NEUTRAL_CALIBRATION_START', tMs: 1150, order: 999 });
    const baseline = fresh.liveResult.trials[0].neutralBaseline!;
    baseline.hipCenterX = baseline.hipCenterX! + .01;
    expect(() => prepareIntegrityInputs([{ filename: 'bad-baseline.json', role: HOLDOUT_ROLE, session: fresh }])).toThrow('LIVE_V3_PARITY_MISMATCH');
  });
  it('keeps all37 STEP4K.1 configs and four-role regression independent of holdout results', async () => {
    const { session } = await fullV3Trial();
    const roles = ['REFERENCE_OLD_CLEAN', 'STRESS', 'REFERENCE_LIVE_1', 'REFERENCE_LIVE_2_INDEPENDENT'] as const;
    const fixtures = prepareIntegrityInputs(roles.map((role, i) => ({ filename: `${i}.json`, role, session: { ...session!, captureId: `${i}` } })));
    const before = analysis.analyzeIntegrity(fixtures, undefined, 'fixed');
    validateIntegrityHoldout([(await synthetic('false11')).fixture]);
    expect(analysis.analyzeIntegrity(fixtures, undefined, 'fixed')).toEqual(before);
    expect(before.strategies).toHaveLength(37); expect(before.inputs.map((i) => i.role)).toEqual(roles);
  });
});
