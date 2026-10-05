// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fullV3Trial } from '../replay/testFixtures';
import { prepareIntegrityInputs } from './integrityFeatures';
import { analyzeIntegrity, createIntegrityEvidence, integrityTracesCsv, analyzeIntegrityConfig } from './analyzeIntegrity';
import { NO_INTEGRITY_GUARD } from './integrityGuard';

describe('integrity evidence / exact traces / reference regression', () => {
  it('keeps NONE event/time/final parity, +/-500ms primitive traces and deterministic local exports', async () => {
    const { session } = await fullV3Trial(), inputs = [{ filename: 'a.json', role: 'REFERENCE_LIVE_2_INDEPENDENT' as const, session: session! }];
    const before = JSON.stringify(inputs), fixtures = prepareIntegrityInputs(inputs);
    const r = analyzeIntegrity(fixtures, [NO_INTEGRITY_GUARD], 'fixed');
    expect(analyzeIntegrity(fixtures, [NO_INTEGRITY_GUARD], 'fixed')).toEqual(r); expect(JSON.stringify(inputs)).toBe(before);
    expect(r.references[0].yOnly).toMatchObject({ left: 1, right: 1, falseEvents: 0, finalState: 'ARMED' });
    expect(r.perFixture[0].traces).toHaveLength(2);
    for (const t of r.perFixture[0].traces) {
      expect(t.rows.some((row) => row.isCandidateEntry)).toBe(true);
      expect(t.rows.every((row) => row.timestamp >= t.startMs && row.timestamp <= t.endMs)).toBe(true);
      expect(t.endMs - t.startMs).toBe(1000);
      expect(t.rows[0]).toHaveProperty('worldKneeAngle'); expect(t.rows[0]).toHaveProperty('visibility');
    }
    expect(r.perFixture[0].distributions.length).toBeGreaterThan(10);
    expect(r.viableIntegrityConfigs).toEqual([]); expect(r.strategies[0].yOnly.assessment).toBe('INSUFFICIENT_EVIDENCE');
    const csv = integrityTracesCsv(r); expect(csv).toContain('YCandidateRunMs'); expect(csv).toContain('kneeAnkleRatio');
    expect(csv.split('\r\n')).toHaveLength(1 + r.perFixture[0].traces.reduce((n, t) => n + t.rows.length, 0));
    expect(JSON.stringify(r)).not.toMatch(/"(landmarks|worldLandmarks|best)":/);
  });
  it('requires all four explicit roles and all references rather than filename inference or an automatic BEST', async () => {
    const { session } = await fullV3Trial();
    const roles = ['REFERENCE_OLD_CLEAN', 'STRESS', 'REFERENCE_LIVE_1', 'REFERENCE_LIVE_2_INDEPENDENT'] as const;
    const fixtures = prepareIntegrityInputs(roles.map((role, i) => ({ filename: 'clean.json', role, session: { ...session!, captureId: `fixture-${i}` } })));
    const e = createIntegrityEvidence(fixtures), noGuard = analyzeIntegrityConfig(fixtures, e, NO_INTEGRITY_GUARD);
    expect(noGuard.yOnly.assessment).toBe('VIABLE');
    expect(analyzeIntegrityConfig(fixtures.slice(1), createIntegrityEvidence(fixtures.slice(1)), NO_INTEGRITY_GUARD).yOnly.assessment).toBe('INSUFFICIENT_EVIDENCE');
    const guarded = analyzeIntegrityConfig(fixtures, e, { guardType: 'Y_VELOCITY', velocity: 10, minRatio: null });
    // Synthetic fixture has 15/s step kicks: losing them must fail acceptance.
    expect(guarded.yOnly.assessment).toBe('REJECTED');
    expect(guarded.yOnly.perFixture[3].regression.trueEventsLost).toBe(2);
  });
  it('rejects mismatched LIVE before exporting feature results and rejects duplicate capture/trial weighting', async () => {
    const { session } = await fullV3Trial(), input = { filename: 'a.json', role: 'REFERENCE_LIVE_1' as const, session: session! };
    expect(() => prepareIntegrityInputs([input, input])).toThrow('중복');
    session!.liveResult.trials[0].result.events[0].tMs += 1;
    expect(() => prepareIntegrityInputs([input])).toThrow('LIVE_V3_PARITY_MISMATCH');
  });
  it('retains fixed Guided stage times and first-Neutral evaluation exclusion under guard', async () => {
    const { session } = await fullV3Trial(), s = session!;
    delete s.detectorMode; delete s.liveResult.trials[0].baselineV3;
    s.markers = s.markers.filter((m) => m.type !== 'NEUTRAL_CALIBRATION_START' && m.type !== 'NEUTRAL_FROZEN');
    const f = prepareIntegrityInputs([{ filename: 'legacy.json', role: 'REFERENCE_OLD_CLEAN', session: s }]);
    const r = analyzeIntegrity(f, [NO_INTEGRITY_GUARD, { guardType: 'Y_VELOCITY', velocity: 10, minRatio: null }]);
    const base = r.strategies[0].yOnly.perFixture[0], guarded = r.strategies[1].yOnly.perFixture[0];
    expect(guarded.stageOutcomes.map((s) => [s.startMs, s.endMs])).toEqual(base.stageOutcomes.map((s) => [s.startMs, s.endMs]));
    expect(guarded.stageOutcomes[0]).toMatchObject({ calibrationOnly: true, outcome: 'NOT_EVALUATED' });
  });
});
