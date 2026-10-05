// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fullV3Trial } from '../replay/testFixtures';
import { analyzeMultiSignals, analyzeMultiConfig, analyzeMultiFixture, prepareMultiInputs, signalStats } from './analyzeMultiSignal';
import { MULTI_DEFAULT } from './multiSignalShadow';

async function prepared() {
  const { session } = await fullV3Trial();
  const [fixture] = prepareMultiInputs([{ filename: 'arbitrary.json', role: 'REFERENCE_LIVE', session: session! }]);
  return fixture;
}
describe('multi-signal report / evidence acceptance', () => {
  it('verifies primary LIVE parity before analysis, including event times and latest baseline', async () => {
    const { session } = await fullV3Trial(), s = session!;
    const input = { filename: 'renamed.json', role: 'REFERENCE_LIVE' as const, session: s };
    const result = analyzeMultiSignals([input], [MULTI_DEFAULT], 'fixed');
    expect(result.liveReplayParity[0]).toMatchObject({ required: true, matched: true,
      comparison: { eventsEqual: true, guidedSummaryEqual: true, finalStateEqual: true }, calibration: { kickBaselineV3Equal: true } });
    s.liveResult.trials[0].result.events[0].tMs += 1;
    expect(() => analyzeMultiSignals([input])).toThrow('LIVE_V3_PARITY_MISMATCH');
  });
  it('keeps repeat runs byte-deterministic, raw input immutable and JSON summary structure complete', async () => {
    const { session } = await fullV3Trial(), input = { filename: 'x.json', role: 'UNASSIGNED' as const, session: session! };
    const before = JSON.stringify(session);
    const config = { ...MULTI_DEFAULT, strategy: 'Y_OR_FLEXION' as const, flexEnter: 15 };
    const one = analyzeMultiSignals([input], [MULTI_DEFAULT, config], 'fixed');
    expect(JSON.stringify(analyzeMultiSignals([input], [MULTI_DEFAULT, config], 'fixed'))).toBe(JSON.stringify(one));
    expect(JSON.stringify(session)).toBe(before); expect(one.viableConfigs).toEqual([]);
    expect(one.strategies.every((r) => r.assessment === 'INSUFFICIENT_EVIDENCE')).toBe(true);
    const output = JSON.stringify(one); expect(output).not.toMatch(/"(landmarks|worldLandmarks|best|samples)":/);
    expect(Object.keys(one)).toEqual(expect.arrayContaining(['inputs', 'liveReplayParity', 'perFixture', 'strategies', 'viableConfigs']));
    expect(one.strategies[0].perFixture[0]).toMatchObject({ left: 1, right: 1, wrong: 0, duplicates: 0, crossGap: 0, reacquisitionFalse: 0 });
  });
  it('requires explicit complete roles and checks every reference, including additional captures', async () => {
    const f = await prepared(), old = { ...f, input: { ...f.input, role: 'REFERENCE_OLD_CLEAN' as const, captureId: 'old' } };
    const stress = { ...f, input: { ...f.input, role: 'STRESS' as const, captureId: 'stress' } };
    expect(analyzeMultiConfig([f, old], MULTI_DEFAULT).assessment).toBe('INSUFFICIENT_EVIDENCE');
    expect(analyzeMultiConfig([f, old, stress], MULTI_DEFAULT).assessment).toBe('VIABLE');
    const missing = structuredClone(f); missing.input.captureId = 'additional-reference';
    missing.frames.forEach((frame) => { frame.LEFT.Y = frame.RIGHT.Y = 0; });
    expect(analyzeMultiConfig([f, old, stress, missing], MULTI_DEFAULT).assessment).toBe('REJECTED');
  });
  it('excludes unobservable STRESS kick misses, while observable false and wrong events fail', async () => {
    const f = await prepared(); f.input.role = 'STRESS';
    f.frames.filter((frame) => frame.stageIndex === 5 || frame.stageIndex === 7).forEach((frame) => {
      frame.LEFT.Y = frame.RIGHT.Y = null;
    });
    expect(analyzeMultiFixture(f, MULTI_DEFAULT)).toMatchObject({ stressAccepted: true, left: 0, right: 0 });
    f.frames.filter((frame) => frame.stageIndex === 1).forEach((frame) => { frame.RIGHT.Y = .6; });
    expect(analyzeMultiFixture(f, MULTI_DEFAULT)).toMatchObject({ stressAccepted: false, observableFalseEvents: 1 });
  });
  it('ignores post-trial global events even if a historic capture incorrectly contains trialId 1', async () => {
    const { session } = await fullV3Trial(), s = session!, trial = s.liveResult.trials[0];
    s.liveResult.events.push({ id: 99, direction: 'KNEE_RIGHT', tMs: trial.endMs! + 2000, trialId: 1 });
    const report = analyzeMultiSignals([{ filename: 'live.json', role: 'REFERENCE_LIVE', session: s }], [MULTI_DEFAULT]);
    expect(report.strategies[0].perFixture[0].events).toHaveLength(2);
    expect(report.liveReplayParity[0].postTrialEventsExcluded).toHaveLength(1);
  });
  it('requires Guided markers and rejects duplicate capture/trial inputs instead of inferring labels or weight', async () => {
    const { session } = await fullV3Trial(), input = { filename: 'live.json', role: 'REFERENCE_LIVE' as const, session: session! };
    expect(() => prepareMultiInputs([input, input])).toThrow('중복');
    session!.markers = session!.markers.filter((m) => m.type !== 'GUIDED_STAGE_CHANGE');
    expect(() => prepareMultiInputs([input])).toThrow('GUIDED_STAGE_CHANGE');
  });
  it('excludes compatibility Neutral from false-event evaluation and never adjusts its baseline later', async () => {
    const { session } = await fullV3Trial(), s = session!;
    delete s.detectorMode; delete s.liveResult.trials[0].baselineV3;
    s.markers = s.markers.filter((m) => m.type !== 'NEUTRAL_CALIBRATION_START' && m.type !== 'NEUTRAL_FROZEN');
    const report = analyzeMultiSignals([{ filename: 'old.json', role: 'REFERENCE_OLD_CLEAN', session: s }], [MULTI_DEFAULT]);
    expect(report.perFixture[0].baseline.source).toBe('FIRST_NEUTRAL_COMPATIBILITY');
    expect(report.strategies[0].perFixture[0].stageOutcomes[0]).toMatchObject({ calibrationOnly: true, outcome: 'NOT_EVALUATED', falseEvents: 0 });
  });
  it('does not bridge missing or >=400ms observations in longest-above evidence metrics', () => {
    const stats = signalStats([{ timestamp: 0, value: 20 }, { timestamp: 33, value: 20 }, { timestamp: 50, value: null },
      { timestamp: 80, value: 20 }, { timestamp: 120, value: 20 }, { timestamp: 520, value: 20 }, { timestamp: 550, value: 20 }], 0, 560, [10]);
    expect(stats.thresholds[0].longestAboveMs).toBe(40); expect(stats.observable).toBe(false); expect(stats.maxGapMs).toBe(400);
  });
});
