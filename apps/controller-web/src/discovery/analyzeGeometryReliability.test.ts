// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fullV3Trial } from '../replay/testFixtures';
import { replayKneeKickV3 } from '../replay/kneeKickV3Replay';
import { prepareIntegrityInputs } from './integrityFeatures';
import { validateIntegrityHoldout } from './holdoutValidation';
import { prepareBodyInputs, BODY_ROLES } from './bodyLocalFeatures';
import { prepareGeometryInputs } from './geometryReliabilityFeatures';
import { createGeometryEvidence, compareReliabilityMarkers, analyzeQualityGate, createGeometryReport, geometryTracesCsv, groupRows } from './analyzeGeometryReliability';
import { qualityGateConfigs } from './geometryReliabilityMarkers';
import { createTwistConfusionEvidence, analyzeTwistStrategy, createTwistReport } from './analyzeTwistConfusion';
import { twistGuardConfigs } from './twistEntryGuard';
import { createBodyEvidence, analyzeFeatureConfig, createBodyReport } from './analyzeBodyLocal';
import { directFeatureConfigs, temporalFeatureConfigs } from './featureKickShadow';

describe('geometry evidence and immutable previous analyses', () => {
  it('keeps production Y, 4K.2, full 4L and all 436 STEP4M configurations unchanged; 4N is deterministic', async () => {
    const session = (await fullV3Trial()).session!, original = JSON.stringify(session), input = { filename: 'live.json', role: 'REFERENCE_LIVE_3' as const, session };
    const production = replayKneeKickV3(session, 1), holdout = () => validateIntegrityHoldout(prepareIntegrityInputs([{ ...input, role: 'REFERENCE_LIVE_3_HOLDOUT' }]));
    const h = holdout(), bf = prepareBodyInputs([input]);
    const l = () => { const f = bf.map((b) => b.reference), e = createTwistConfusionEvidence(f); return createTwistReport(e, twistGuardConfigs().map((c) => analyzeTwistStrategy(f, e, c)), 'fixed'); };
    const m = () => { const e = createBodyEvidence(bf); return createBodyReport(e, [...directFeatureConfigs(), ...temporalFeatureConfigs()].map((c) => analyzeFeatureConfig(bf, e, c)), 'fixed'); };
    const beforeL = JSON.stringify(l()), beforeM = JSON.stringify(m());
    const make = () => { const f = prepareGeometryInputs([input]), e = createGeometryEvidence(f), markers = compareReliabilityMarkers(f, e);
      return createGeometryReport(e, markers, qualityGateConfigs().map((c) => analyzeQualityGate(f, e, markers, c)), 'fixed'); };
    const report = make(); expect(JSON.stringify(make())).toBe(JSON.stringify(report));
    expect(report.analysisStatus).toBe('POST_FAILURE_EXPLORATORY'); expect(report.qualityGateExperiments.every((q) => q.assessment === 'INSUFFICIENT_EVIDENCE')).toBe(true);
    expect(replayKneeKickV3(session, 1)).toEqual(production); expect(holdout()).toEqual(h); expect(JSON.stringify(l())).toBe(beforeL); expect(JSON.stringify(m())).toBe(beforeM);
    expect(JSON.stringify(session)).toBe(original); expect(JSON.stringify(report)).not.toMatch(/"(landmarks|worldLandmarks|best|prototype)":/);
  }, 15000);
  it('halts all geometry work on LIVE timestamp parity mismatch', async () => {
    const session = (await fullV3Trial()).session!; session.liveResult.trials[0].result.events[0].tMs++;
    expect(() => prepareGeometryInputs([{ filename: 'bad.json', role: 'REFERENCE_LIVE_1', session }])).toThrow('LIVE_V3_PARITY_MISMATCH');
  });
  it('allows compatibility calibration only for OLD and excludes that stage from geometry distributions', async () => {
    const session = (await fullV3Trial()).session!; delete session.detectorMode; delete session.liveResult.trials[0].baselineV3;
    session.markers = session.markers.filter((m) => m.type !== 'NEUTRAL_CALIBRATION_START' && m.type !== 'NEUTRAL_FROZEN');
    const input = { filename: 'legacy.json', role: 'REFERENCE_OLD_CLEAN' as const, session }, f = prepareGeometryInputs([input]), e = createGeometryEvidence(f);
    expect(e.geometryReliabilityEvidence.perFixture[0].baseline.source).toBe('FIRST_NEUTRAL_COMPATIBILITY');
    expect(Object.values(e.geometryReliabilityEvidence.perFixture[0].perStageDistributions[0].features).every((v) => v.frames === 0 && v.usable === 0)).toBe(true);
    expect(() => prepareGeometryInputs([{ ...input, role: 'STRESS' }])).toThrow();
  });
  it('measures distributions first and requires matching evidence and markers for a gate', async () => {
    const session = (await fullV3Trial()).session!, f = prepareGeometryInputs([{ filename: 'live.json', role: 'REFERENCE_LIVE_1', session }]), e = createGeometryEvidence(f);
    expect(e).not.toHaveProperty('qualityGateExperiments'); expect(e).not.toHaveProperty('reliabilityMarkers');
    const markers = compareReliabilityMarkers(f, e);
    expect(() => compareReliabilityMarkers([], e)).toThrow('same assigned');
    expect(() => analyzeQualityGate(f, e, { ...markers, perFixture: [] }, qualityGateConfigs()[0])).toThrow('Compare reliability');
    expect(() => analyzeQualityGate(f, e, markers, { id: 'invented', markers: [] })).toThrow('bounded');
    const csv = geometryTracesCsv(e); expect(csv).toContain('world.leftHipKneeRatioVelocityPerSec'); expect(csv).toContain('LEFT.deltaWorldDepthNorm');
    expect(csv).toContain('leftFixedIntegrity12Activation'); expect(csv).toContain('relativeToAnchorMs');
  });
  it('unions overlapping windows without duplicate frame or candidate-side weighting', async () => {
    const session = (await fullV3Trial()).session!, [f] = prepareGeometryInputs([{ filename: 'live.json', role: 'REFERENCE_LIVE_1', session }]);
    const start = f.stages[0].startMs, anchor = { startMs: start, endMs: start + 500, side: 'LEFT' as const, kind: 'TRUE_EVENT', expected: 'KNEE_LEFT' };
    const single = groupRows(f, [anchor], 'TRUE_KICK'), duplicate = groupRows(f, [anchor, anchor], 'TRUE_KICK');
    expect(duplicate.rows).toEqual(single.rows); expect(duplicate.sideRows).toEqual(single.sideRows); expect(single.sideRows.length).toBeGreaterThan(0);
  });
  it('cannot call a no-false configuration viable when reference kicks are absent', async () => {
    const session = (await fullV3Trial()).session!;
    const f = prepareGeometryInputs(BODY_ROLES.slice(1).map((role, i) => ({ filename: `${i}.json`, role, session: { ...session, captureId: `test-${i}` } }))), e = createGeometryEvidence(f), m = compareReliabilityMarkers(f, e);
    const result = analyzeQualityGate(f, e, m, qualityGateConfigs().find((c) => c.id === 'IDENTITY_CONTINUITY/0')!);
    expect(result.perFixture.some((v) => !v.checks.completeReferenceKicks)).toBe(true); expect(result.assessment).toBe('REJECTED');
  });
});
