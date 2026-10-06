// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fullV3Trial, liveHarness, ORIGIN, TRIAL_AT } from '../replay/testFixtures';
import { motionFrame } from '../pose/motion/testFixtures';
import { prepareTwistInputs, type TwistRole } from './twistConfusionFeatures';
import { createTwistConfusionEvidence, analyzeTwistStrategy, createTwistReport } from './analyzeTwistConfusion';
import { twistGuardConfigs } from './twistEntryGuard';
import { prepareIntegrityInputs } from './integrityFeatures';
import { validateIntegrityHoldout } from './holdoutValidation';
import { replayKneeKickV3 } from '../replay/kneeKickV3Replay';
import { analyzeIntegrity, runIntegrityFixture } from './analyzeIntegrity';
import { PRE_REGISTERED_INTEGRITY_CONFIG } from './integrityGuard';

async function cleanCapture(falseTwist = false) {
  const live = liveHarness(true, 'Y_V3');
  for (let t = 20; t <= 22020; t += 40) {
    const f = motionFrame(ORIGIN + TRIAL_AT + t), scale = live.baseline.bodyScale;
    f.landmarks[27].visibility = f.landmarks[28].visibility = 0;
    const ramp = (start: number) => t < start || t > start + 360 ? 0 : Math.min(.6, (t - start + 40) / 40 * .2);
    let left = ramp(12060), right = ramp(17060);
    if (falseTwist && t >= 2020 && t <= 2500) {
      left = ramp(2060); right = Math.min(.45, left); f.worldLandmarks[23].z = .16;
    }
    f.landmarks[25].y += left * scale; f.landmarks[26].y += right * scale;
    live.frame(f); if (t % 160 === 20) live.clock(t + 8);
  }
  return live.finish();
}
describe('post-failure exploratory reporting', () => {
  it('keeps production replay and original HOLDOUT acceptance immutable and marks both role aliases exploratory', async () => {
    const session = (await fullV3Trial()).session!, input = { filename: 'holdout.json', role: 'REFERENCE_LIVE_3_HOLDOUT' as const, session };
    const before = JSON.stringify(session), production = replayKneeKickV3(session, 1), holdout = validateIntegrityHoldout(prepareIntegrityInputs([input]));
    const fixtures = prepareTwistInputs([input]), evidence = createTwistConfusionEvidence(fixtures);
    const report = createTwistReport(evidence, twistGuardConfigs().map((c) => analyzeTwistStrategy(fixtures, evidence, c)), 'fixed');
    expect(report.analysisStatus).toBe('POST_FAILURE_EXPLORATORY');
    expect(report.inputs[0]).toMatchObject({ role: 'REFERENCE_LIVE_3_HOLDOUT_FAILURE', sourceRole: 'REFERENCE_LIVE_3_HOLDOUT' });
    expect(report.strategyResults.every((s) => s.analysisStatus === 'POST_FAILURE_EXPLORATORY' && s.assessment === 'INSUFFICIENT_EVIDENCE')).toBe(true);
    expect(replayKneeKickV3(session, 1)).toEqual(production); expect(validateIntegrityHoldout(prepareIntegrityInputs([input]))).toEqual(holdout);
    expect(JSON.stringify(session)).toBe(before);
    const original = prepareIntegrityInputs([input])[0];
    expect(() => runIntegrityFixture(original, PRE_REGISTERED_INTEGRITY_CONFIG, 'FIXED_Y_OR_FLEXION', false, () => [])).toThrow('HOLDOUT_SWEEP_FORBIDDEN');
    expect(JSON.stringify(report)).not.toMatch(/"(landmarks|worldLandmarks|prototype|rawAction|stableAction|confidence|best)":/);
  });
  it('has deterministic reports and cannot run a strategy on unrelated or reordered evidence', async () => {
    const session = (await fullV3Trial()).session!;
    const fixtures = prepareTwistInputs([{ filename: 'x.json', role: 'REFERENCE_LIVE_1', session }]), evidence = createTwistConfusionEvidence(fixtures);
    const make = () => createTwistReport(evidence, twistGuardConfigs().map((c) => analyzeTwistStrategy(fixtures, evidence, c)), 'fixed');
    expect(JSON.stringify(make())).toBe(JSON.stringify(make()));
    expect(() => analyzeTwistStrategy([], evidence, twistGuardConfigs()[0])).toThrow('same assigned fixtures');
    expect(evidence).not.toHaveProperty('strategyResults');
  });
  it('requires all five roles and can report EXPLORATORY_VIABLE only when stage recall/false regressions pass', async () => {
    const clean = await cleanCapture(), falseCapture = await cleanCapture(true);
    const roles: TwistRole[] = ['REFERENCE_OLD_CLEAN', 'STRESS', 'REFERENCE_LIVE_1', 'REFERENCE_LIVE_2_INDEPENDENT', 'REFERENCE_LIVE_3_HOLDOUT_FAILURE'];
    const inputs = roles.map((role, i) => ({ filename: `${i}.json`, role, session: { ...(i === 4 ? falseCapture : clean), captureId: `capture-${i}` } }));
    const fixtures = prepareTwistInputs(inputs), evidence = createTwistConfusionEvidence(fixtures);
    expect(evidence.references[4].fixedFlexionIntegrity12.falseEvents).toBe(1);
    const config = twistGuardConfigs().find((c) => c.guardType === 'HIP_DEPTH_AND_BILATERAL_Y' && c.hipThreshold === .75 && c.symmetryThreshold === .5)!;
    const result = analyzeTwistStrategy(fixtures, evidence, config);
    expect(result).toMatchObject({ assessment: 'EXPLORATORY_VIABLE', falseRemoved: 1, falseAdded: 0, trueEventsLost: 0, trueEventsPreserved: 10, wrong: 0, duplicates: 0 });
    expect(result.perFixture[4].guardActivationsDuringTwist).toBeGreaterThan(0);
    expect(result.perFixture[4].guardActivationsDuringExpectedLimbKick).toBe(0);
    const partial = fixtures.slice(1);
    expect(analyzeTwistStrategy(partial, createTwistConfusionEvidence(partial), config).assessment).toBe('INSUFFICIENT_EVIDENCE');
    const oldFixtures = prepareIntegrityInputs(inputs.slice(0, 4).map((i) => ({ ...i, role: i.role as 'REFERENCE_LIVE_1' })));
    const previous = analyzeIntegrity(oldFixtures, undefined, 'fixed');
    analyzeTwistStrategy(fixtures, evidence, config);
    expect(analyzeIntegrity(oldFixtures, undefined, 'fixed')).toEqual(previous);
  });
  it('halts on LIVE parity mismatch before measuring distributions or new rule evaluation', async () => {
    const session = (await fullV3Trial()).session!; session.liveResult.trials[0].result.events[0].tMs++;
    expect(() => prepareTwistInputs([{ filename: 'bad.json', role: 'REFERENCE_LIVE_3_HOLDOUT_FAILURE', session }])).toThrow('LIVE_V3_PARITY_MISMATCH');
  });
  it('preserves a missed expected kick as a labelled diagnostic peak, never fabricates a confirmed event', async () => {
    // A real miss is recorded LIVE as well as replayed: disable RIGHT only in a fresh live run.
    const live = liveHarness(true, 'Y_V3');
    for (let t = 20; t <= 22020; t += 40) live.send(t);
    const missed = await live.finish();
    const [fixture] = prepareTwistInputs([{ filename: 'miss.json', role: 'REFERENCE_LIVE_1', session: missed }]);
    const evidence = createTwistConfusionEvidence([fixture]);
    expect(evidence.references[0].yOnly.events).toEqual([]);
    const traces = evidence.twistConfusionEvidence.perFixture[0].eventTraces;
    expect(traces.filter((t) => t.kind === 'EXPECTED_STAGE_PEAK').map((t) => t.side)).toEqual(['LEFT', 'RIGHT']);
    expect(traces.every((t) => t.kickConfirm === null)).toBe(true);
  });
});
