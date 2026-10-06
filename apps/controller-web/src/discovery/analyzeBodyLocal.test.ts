// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fullV3Trial } from '../replay/testFixtures';
import { replayKneeKickV3 } from '../replay/kneeKickV3Replay';
import { validateIntegrityHoldout } from './holdoutValidation';
import { prepareIntegrityInputs } from './integrityFeatures';
import { prepareTwistInputs } from './twistConfusionFeatures';
import { createTwistConfusionEvidence, createTwistReport, analyzeTwistStrategy } from './analyzeTwistConfusion';
import { twistGuardConfigs } from './twistEntryGuard';
import { prepareBodyInputs } from './bodyLocalFeatures';
import { createBodyEvidence, analyzeFeatureConfig, createBodyReport, featureNeighborhood, type FeatureResult } from './analyzeBodyLocal';
import { directFeatureConfigs } from './featureKickShadow';

describe('STEP4M evidence, provenance and regression boundaries', () => {
  it('is deterministic and leaves production Y, preregistered 4K.2 and the entire 4L report unchanged', async () => {
    const session = (await fullV3Trial()).session!, original = JSON.stringify(session);
    const input = { filename: 'live.json', role: 'REFERENCE_LIVE_3_HOLDOUT' as const, session };
    const production = replayKneeKickV3(session, 1), holdout = validateIntegrityHoldout(prepareIntegrityInputs([input]));
    const old = () => { const fixtures = prepareTwistInputs([input]), evidence = createTwistConfusionEvidence(fixtures);
      return createTwistReport(evidence, twistGuardConfigs().map((c) => analyzeTwistStrategy(fixtures, evidence, c)), 'fixed'); };
    const before = old();
    const make = () => { const fixtures = prepareBodyInputs([{ ...input, role: 'REFERENCE_LIVE_3' }]), evidence = createBodyEvidence(fixtures);
      return createBodyReport(evidence, directFeatureConfigs().map((c) => analyzeFeatureConfig(fixtures, evidence, c)), 'fixed'); };
    const r = make(); expect(JSON.stringify(make())).toBe(JSON.stringify(r));
    expect(r.analysisStatus).toBe('POST_FAILURE_EXPLORATORY'); expect(r.exploratoryViableConfigs).toEqual([]);
    expect(r.candidateFamilyResults.every((c) => c.assessment === 'INSUFFICIENT_EVIDENCE')).toBe(true);
    expect(replayKneeKickV3(session, 1)).toEqual(production); expect(validateIntegrityHoldout(prepareIntegrityInputs([input]))).toEqual(holdout);
    expect(old()).toEqual(before); expect(JSON.stringify(session)).toBe(original);
    expect(JSON.stringify(r)).not.toMatch(/"(landmarks|worldLandmarks|best|prototype|confidence)":/);
  }, 15000);
  it('stops before new feature extraction when live event/time parity fails', async () => {
    const session = (await fullV3Trial()).session!; session.liveResult.trials[0].result.events[0].tMs++;
    expect(() => prepareBodyInputs([{ filename: 'bad.json', role: 'REFERENCE_LIVE_1', session }])).toThrow('LIVE_V3_PARITY_MISMATCH');
  });
  it('allows first-Neutral compatibility only for OLD CLEAN and excludes that stage', async () => {
    const session = (await fullV3Trial()).session!;
    delete session.detectorMode; delete session.liveResult.trials[0].baselineV3;
    session.markers = session.markers.filter((m) => m.type !== 'NEUTRAL_CALIBRATION_START' && m.type !== 'NEUTRAL_FROZEN');
    const input = { filename: 'legacy.json', role: 'REFERENCE_OLD_CLEAN' as const, session }, fixtures = prepareBodyInputs([input]);
    const e = createBodyEvidence(fixtures), r = analyzeFeatureConfig(fixtures, e, directFeatureConfigs()[0]);
    expect(fixtures[0].baseline.source).toBe('FIRST_NEUTRAL_COMPATIBILITY'); expect(r.perFixture[0].stageOutcomes[0]).toMatchObject({ calibrationOnly: true, frameCount: 0 });
    expect(() => prepareBodyInputs([{ ...input, role: 'STRESS' }])).toThrow();
    expect(() => prepareBodyInputs([{ ...input, role: 'REFERENCE_LIVE_1' }])).toThrow();
  });
  it('keeps distributions/anchors before strategies and rejects unrelated evidence', async () => {
    const session = (await fullV3Trial()).session!, f = prepareBodyInputs([{ filename: 'live.json', role: 'REFERENCE_LIVE_1', session }]), e = createBodyEvidence(f);
    expect(e).not.toHaveProperty('candidateFamilyResults'); expect(e.bodyLocalEvidence.perFixture[0].perStageDistributions).toHaveLength(9);
    expect(e.bodyLocalEvidence.perFixture[0].temporalSummaries[0].signals[0].windows).toHaveLength(8);
    expect(e.bodyLocalEvidence.perFixture[0].anchorTraces.some((a) => a.kind === 'TRUE_EVENT')).toBe(true);
    expect(() => analyzeFeatureConfig([], e, directFeatureConfigs()[0])).toThrow('same assigned');
  });
  it('calls an isolated threshold fragile and requires adjacent threshold and dwell support for broad neighborhoods', () => {
    const result = (threshold: number, dwell: number) => ({ id: `${threshold}/${dwell}`, featureFamily: 'SAME_HIP_Y', threshold, dwell, temporalRule: null, assessment: 'EXPLORATORY_VIABLE' }) as FeatureResult;
    const isolated = featureNeighborhood([result(.3, 67)], 'SAME_HIP_Y'); expect(isolated.configs[0].neighborhood).toBe('FRAGILE');
    const broad = featureNeighborhood([result(.25, 67), result(.3, 67), result(.4, 67), result(.3, 100)], 'SAME_HIP_Y');
    expect(broad.configs.find((c) => c.id === '0.3/67')?.neighborhood).toBe('BROAD_NEIGHBORHOOD');
  });
});
