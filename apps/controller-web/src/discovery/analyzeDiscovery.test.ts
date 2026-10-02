import { describe, expect, it, vi } from 'vitest';
import { analyzeDiscovery, createDiscoveryReport } from './analyzeDiscovery';
import { discoveryStages, stageForTime } from './discoveryStages';
import { discoveryFixture, discoveryFrame, STAGE_OFFSETS } from './testFixtures';
import { replayLandmarks } from '../replay/landmarkReplay';
import { readReplaySession } from '../replay/readReplaySession';
import { fullTrial, TRIAL_AT } from '../replay/testFixtures';
import type { FeatureId } from './discoveryFeatures';
import { analyzeTemporal, createTemporalReport } from './analyzeTemporal';

const main: FeatureId = 'hipCenterRelative2DDisplacement';
describe('Guided stage mapping', () => {
  it('maps just before/exactly/after every boundary to recorded expected stages', async () => {
    const session = await discoveryFixture(), trial = session.liveResult.trials[0];
    const { stages, source } = discoveryStages(session, trial);
    expect(source).toBe('GUIDED_STAGE_CHANGE');
    expect(stages.map((s) => s.expected)).toEqual(['NEUTRAL', 'TWIST_LEFT', 'NEUTRAL', 'TWIST_RIGHT', 'NEUTRAL', 'KNEE_LEFT', 'NEUTRAL', 'KNEE_RIGHT', 'NEUTRAL']);
    expect(stageForTime(stages, TRIAL_AT - 0.001)).toBeNull();
    for (const [index, start] of STAGE_OFFSETS.entries()) {
      if (index) expect(stageForTime(stages, TRIAL_AT + start - 0.001)?.stageIndex).toBe(index - 1);
      expect(stageForTime(stages, TRIAL_AT + start)?.stageIndex).toBe(index);
      expect(stageForTime(stages, TRIAL_AT + start + 0.001)?.stageIndex).toBe(index);
    }
    expect(stageForTime(stages, TRIAL_AT + 22000)).toBeNull();
  });
  it('uses marker timestamps rather than reconstructing stage times when markers exist', async () => {
    const session = await discoveryFixture();
    session.markers.find((m) => m.type === 'GUIDED_STAGE_CHANGE' && m.stageIndex === 1)!.tMs += 123;
    const { stages } = discoveryStages(session, session.liveResult.trials[0]);
    expect(stageForTime(stages, TRIAL_AT + 2050)?.expected).toBe('NEUTRAL');
    expect(stageForTime(stages, TRIAL_AT + 2123)?.expected).toBe('TWIST_LEFT');
  });
  it('does not attribute completion/after-stop frames and reports truncated trial coverage', async () => {
    const session = await discoveryFixture();
    session.liveResult.trials[0].endMs = TRIAL_AT + 12100;
    const result = analyzeDiscovery(session, 'interrupted.json')[0].summary;
    expect(result.frameCount).toBe(12);
    expect(result.features.find((f) => f.feature === main)?.kneeRightCoverage).toBeNull();
    expect(result.features.find((f) => f.feature === main)?.directionConsistentAcrossObservedKicks).toBeNull();
  });
  it('rejects missing/ambiguous marker stages instead of borrowing a detector event label', async () => {
    const session = await discoveryFixture();
    session.markers = session.markers.filter((m) => !(m.type === 'GUIDED_STAGE_CHANGE' && m.stageIndex === 2));
    expect(() => analyzeDiscovery(session, 'bad.json')).toThrow(/marker/);
  });
  it('explicitly flags the fixed sequence fallback only when all stage markers are absent', async () => {
    const session = await discoveryFixture(); session.markers = session.markers.filter((m) => m.type !== 'GUIDED_STAGE_CHANGE');
    const result = analyzeDiscovery(session, 'legacy.json')[0].summary;
    expect(result.stageSource).toBe('FIXED_SEQUENCE_FALLBACK'); expect(result.warnings.join()).toContain('추정');
  });
});

describe('per-dataset and aggregate discovery summaries', () => {
  it('uses ONLY first Neutral median; later neutrals and detector results do not change reference/ground truth', async () => {
    const session = await discoveryFixture();
    session.poseFrames.push(discoveryFrame(5100, 5, 5), discoveryFrame(10100, 6, 6));
    session.liveResult.events = []; session.liveResult.trials[0].result.events = [];
    const result = analyzeDiscovery(session, 'clean.json')[0].summary;
    expect(result.neutralReference.frameCount).toBe(2); expect(result.neutralReference.LEFT.dy).toBeCloseTo(0.3);
    expect(result.features.find((f) => f.feature === main)?.kneeRightPeak).toBeCloseTo(0.5);
  });
  it('reports exact counts, signed statistics, separation and independent limb evidence', async () => {
    const [analysis] = analyzeDiscovery(await discoveryFixture(), 'clean.json');
    const f = analysis.summary.features.find((f) => f.feature === main)!;
    expect(f.overallCoverage).toBe(1); expect(f.nonKickMax).toBeCloseTo(0.1); expect(f.nonKickP95).toBeCloseTo(0.1);
    expect(f.kneeLeftPeak).toBeCloseTo(0.6); expect(f.kneeRightPeak).toBeCloseTo(0.5);
    expect(f.minKickPeak).toBeCloseTo(0.5); expect(f.sampleSeparationMargin).toBeCloseTo(0.4); expect(f.robustSeparationMargin).toBeCloseTo(0.4);
    expect(f.directions[0].leftPeak).toBeCloseTo(0.6); expect(f.directions[0].rightPeak).toBe(0);
    expect(f.directions[1].rightPeak).toBeCloseTo(0.5); expect(f.directions[1].leftPeak).toBe(0);
    expect(f.directionConsistentAcrossObservedKicks).toBe(true);
    const stage = analysis.summary.stageSummaries.find((s) => s.feature === main && s.stageIndex === 5 && s.side === 'LEFT')!;
    expect(stage).toMatchObject({ frameCount: 2, usableFrameCount: 2, coverage: 1, velocitySampleCount: 1 });
    expect(stage.median).toBeCloseTo(0.6); expect(stage.p90).toBeCloseTo(0.6); expect(stage.p95).toBeCloseTo(0.6);
    expect(stage.max).toBeCloseTo(0.6); expect(stage.peakAbsVelocity).toBe(0);
  });
  it('keeps absent-world/ankle and missing-pose coverage separate without dropping recorded missing frames', async () => {
    const session = await discoveryFixture();
    session.poseFrames.forEach((f) => { f.worldLandmarks = []; f.landmarks[27].visibility = 0; f.landmarks[28].visibility = 0; });
    session.poseFrames[10].landmarks = [];
    const [analysis] = analyzeDiscovery(session, 'stress.json');
    const byId = (id: FeatureId) => analysis.summary.features.find((f) => f.feature === id)!;
    expect(byId(main).overallCoverage).toBeCloseTo(17 / 18); expect(byId(main).kneeLeftCoverage).toBe(0.5);
    expect(byId('world3DDisplacement').overallCoverage).toBe(0); expect(byId('world3DDisplacement').nonKickMax).toBeNull();
    expect(byId('kneeFlexionAngleChange').overallCoverage).toBe(0); expect(byId('kneeFlexionAngleChange').lowCoverage).toBe(true);
  });
  it('keeps signed quantiles but uses magnitude for negative-motion separation', async () => {
    const session = await discoveryFixture();
    session.poseFrames[10].landmarks[25].y -= 0.8;
    const [analysis] = analyzeDiscovery(session, 'negative.json');
    const summary = analysis.summary.stageSummaries.find((f) => f.feature === 'deltaDy' && f.stageIndex === 5 && f.side === 'LEFT')!;
    expect(summary.median).toBeLessThan(0); expect(summary.max).toBeGreaterThan(0); expect(summary.peak).toBeGreaterThan(summary.max!);
    const feature = analysis.summary.features.find((f) => f.feature === 'deltaDy')!;
    expect(feature.kneeLeftPeak).toBe(summary.peak);
  });
  it('never lets an aggregate hide a wrong limb direction in STRESS', async () => {
    const clean = await discoveryFixture(), stress = structuredClone(clean);
    stress.captureId = 'stress';
    for (const f of stress.poseFrames.filter((f) => f.tMs >= TRIAL_AT + 17000 && f.tMs < TRIAL_AT + 20000)) f.landmarks[25].y += 0.7;
    const report = createDiscoveryReport([...analyzeDiscovery(clean, 'clean인가요.json'), ...analyzeDiscovery(stress, '3차검증2.json')]);
    expect(report.perDataset[0].features.find((f) => f.feature === main)?.directionConsistentAcrossObservedKicks).toBe(true);
    expect(report.perDataset[1].features.find((f) => f.feature === main)?.directionConsistentAcrossObservedKicks).toBe(false);
    const combined = report.aggregate.find((f) => f.feature === main)!;
    expect(combined.directions).toHaveLength(4); expect(combined.directionRightMargin).toBeLessThan(0);
    expect(combined.directionConsistentAcrossObservedKicks).toBe(false);
  });
  it('keeps tracking-collapse coverage and missing direction unknown instead of zero evidence', async () => {
    const clean = await discoveryFixture(), stress = structuredClone(clean);
    stress.poseFrames.forEach((f) => { if (f.tMs >= TRIAL_AT + 17000 && f.tMs < TRIAL_AT + 20000) { f.landmarks = []; f.worldLandmarks = []; } });
    const report = createDiscoveryReport([...analyzeDiscovery(clean, 'clean.json'), ...analyzeDiscovery(stress, 'stress.json')]);
    expect(report.perDataset[1].features.find((f) => f.feature === main)?.kneeRightCoverage).toBe(0);
    expect(report.aggregate.find((f) => f.feature === main)?.directionConsistentAcrossObservedKicks).toBeNull();
    expect(report.aggregate.find((f) => f.feature === main)?.directions.at(-1)?.rightPeak).toBeNull();
  });
  it('only computes velocity across usable adjacent samples of the same stage with recorded gaps', async () => {
    const session = await discoveryFixture(), scale = session.liveResult.trials[0].baseline.bodyScale;
    const missing = discoveryFrame(12150); missing.landmarks = []; missing.worldLandmarks = [];
    session.poseFrames = [discoveryFrame(10), discoveryFrame(50), discoveryFrame(12010), discoveryFrame(12050, 0.2 * scale),
      missing, discoveryFrame(12180, 5 * scale), discoveryFrame(12600, 20 * scale), discoveryFrame(15000, 30 * scale)];
    const [analysis] = analyzeDiscovery(session, 'gaps.json');
    const stage = analysis.summary.stageSummaries.find((s) => s.feature === main && s.stageIndex === 5 && s.side === 'LEFT')!;
    expect(stage.velocitySampleCount).toBe(1); expect(stage.peakAbsVelocity).toBeCloseTo(5);
    expect(analysis.summary.stageSummaries.find((s) => s.feature === main && s.stageIndex === 6 && s.side === 'LEFT')?.velocitySampleCount).toBe(0);
  });
  it('exports only summary primitives/definitions and groups every trial by filename/captureId/trialId', async () => {
    const session = await discoveryFixture();
    const second = structuredClone(session.liveResult.trials[0]); second.id = 2;
    const offset = 25000; second.startMs += offset; second.endMs! += offset;
    session.liveResult.trials.push(second); session.timing.durationMs += offset;
    session.poseFrames.push(...session.poseFrames.map((f) => ({ ...f, tMs: f.tMs + offset })));
    session.markers.push(...session.markers.filter((m) => m.trialId === 1).map((m) => ({ ...m, tMs: m.tMs + offset, trialId: 2 })));
    const report = createDiscoveryReport(analyzeDiscovery(readReplaySession(JSON.stringify(session)), 'capture.json'), '2026-09-30T00:00:00Z');
    expect(report.inputs.map((i) => i.trialId)).toEqual([1, 2]); expect(report.version).toBe(1);
    const json = JSON.stringify(report), parsed = JSON.parse(json);
    expect(parsed.features.settings.bodyScaleSource).toContain('recorded'); expect(parsed.perDataset).toHaveLength(2);
    expect(json).not.toMatch(/"(landmarks|worldLandmarks|poseFrames|buckets|values)":/);
  });
  it('is mirror-independent and deterministic without wall-clock sampling', async () => {
    const session = await discoveryFixture(), now = vi.spyOn(performance, 'now').mockImplementation(() => { throw new Error('wall clock'); });
    try {
      const original = analyzeDiscovery(session, 'capture.json')[0].summary;
      session.display.mirrorEnabled = !session.display.mirrorEnabled;
      expect(analyzeDiscovery(session, 'capture.json')[0].summary).toEqual(original);
    } finally { now.mockRestore(); }
  });
  it('rejects Diagnostic v3 input', () => {
    expect(() => readReplaySession(JSON.stringify({ version: 3, frames: [] }))).toThrow(/STEP 4F version 1/);
  });
  it('leaves the live detector, input and LANDMARK LIVE parity unchanged', async () => {
    const live = await fullTrial(), before = JSON.stringify(live.session), detectorBefore = live.kick.getReplaySnapshot();
    const replayBefore = replayLandmarks(live.session, 1);
    createDiscoveryReport(analyzeDiscovery(live.session, 'parity.json'));
    createTemporalReport(analyzeTemporal(live.session, 'parity.json'));
    expect(JSON.stringify(live.session)).toBe(before); expect(live.kick.getReplaySnapshot()).toEqual(detectorBefore);
    const replayAfter = replayLandmarks(live.session, 1);
    expect(replayAfter).toEqual(replayBefore);
    expect(replayAfter.comparison).toMatchObject({ eventsEqual: true, finalStateEqual: true, guidedSummaryEqual: true });
  });
});
