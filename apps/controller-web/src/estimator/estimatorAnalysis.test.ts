// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { fullV3Trial } from '../replay/testFixtures';
import type { ReplaySession } from '../replay/replayTypes';
import type { BodyInput } from '../discovery/bodyLocalFeatures';
import { rawReliabilityGeometry, freezeGeometryBaseline, measureReliabilityFrame } from '../discovery/geometryReliabilityFeatures';
import { replayKneeKickV3 } from '../replay/kneeKickV3Replay';
import { estimatorAnchors, rebuildEstimatorBaseline, analyzeEstimator, compareEstimators, continuitySummary, type EstimatorAnchors } from './estimatorAnalysis';
import { compareEstimatorRepetition } from './estimatorRepeatability';
import { estimatorConfig } from './estimatorConfig';
import type { EstimatorRun } from './estimatorInference';
let session: ReplaySession, input: BodyInput, run: EstimatorRun, anchors: EstimatorAnchors;
beforeAll(async () => {
  session = (await fullV3Trial()).session!; input = { session, filename: 'test.json', role: 'REFERENCE_LIVE_1' };
  run = { variant: 'FULL_VIDEO_CONTROL', config: estimatorConfig('FULL_VIDEO_CONTROL'), mediaIdentity: {} as never,
    sequence: { decodedFrameCount: session.poseFrames.length, firstTimestamp: session.poseFrames[0].tMs,
      lastTimestamp: session.poseFrames.at(-1)!.tMs, timestampHash: 'synthetic', timestampUnit: 'media PTS milliseconds' },
    frames: session.poseFrames.map((f) => ({ ...structuredClone(f), posePresent: f.landmarks.length > 0, inferenceMs: 12 })),
    frameSequenceParity: true, clock: 'decoded media PTS * 1000 = existing VIDEO replay capture tMs mapping' };
  anchors = estimatorAnchors(input);
});
describe('independent estimator measurement with frozen recorded intervals', () => {
  it('uses the same interval but recomputes numeric baselines without mutating original or other variants', () => {
    const before = JSON.stringify(session), a = rebuildEstimatorBaseline(session, session.liveResult.trials[0], run, input.role);
    const altered = structuredClone(run); altered.variant = 'FULL_IMAGE';
    altered.frames.forEach((f) => { for (const points of [f.landmarks, f.worldLandmarks]) for (const p of points) { p.x *= 2; p.y *= 2; p.z *= 2; } });
    const b = rebuildEstimatorBaseline(session, session.liveResult.trials[0], altered, input.role);
    expect(a.window).toEqual(b.window); expect(b.y!.bodyScale).toBeCloseTo(a.y!.bodyScale * 2);
    expect(b.geometry.image.segments.leftHipKnee.median).toBeCloseTo(a.geometry.image.segments.leftHipKnee.median! * 2);
    expect(JSON.stringify(session)).toBe(before); expect(run.frames[0].landmarks[23].x).toBe(session.poseFrames[0].landmarks[23].x);
  });
  it('never uses action frames or stored baseline as a fallback for missing neutral', () => {
    const b = rebuildEstimatorBaseline(session, session.liveResult.trials[0], run, input.role);
    const altered = structuredClone(run);
    altered.frames = altered.frames.map((f) => f.tMs > b.window.startMs && f.tMs <= b.window.endMs ? { ...f, landmarks: [], worldLandmarks: [], posePresent: false } : f);
    const rebuilt = rebuildEstimatorBaseline(session, session.liveResult.trials[0], altered, input.role);
    expect(rebuilt.y).toBeNull(); expect(rebuilt.geometry.worldLegScale).toBeNull();
    const result = analyzeEstimator(input, altered, anchors); expect(result.trials[0].detectorReplay).toBeNull();
    expect(result.trials[0].baselineStatus).toBe('INSUFFICIENT_NEUTRAL_SAMPLES');
  });
  it('allows first Neutral only for explicitly assigned OLD CLEAN and excludes it from measurement', () => {
    const old = structuredClone(session); old.detectorMode = 'LEGACY_X'; old.markers = old.markers.filter((m) => !m.type.startsWith('NEUTRAL_'));
    expect(() => rebuildEstimatorBaseline(old, old.liveResult.trials[0], run, 'REFERENCE_LIVE_1')).toThrow();
    const baseline = rebuildEstimatorBaseline(old, old.liveResult.trials[0], run, 'REFERENCE_OLD_CLEAN');
    expect(baseline.window.source).toBe('FIRST_NEUTRAL_COMPATIBILITY'); expect(baseline.window.excludedStageIndex).toBe(0);
  });
  it('reuses the exact STEP4N formulas, including missing and continuity null semantics', () => {
    const b = rebuildEstimatorBaseline(session, session.liveResult.trials[0], run, input.role);
    const frames = run.frames.filter((f) => f.tMs > b.window.startMs && f.tMs <= b.window.endMs);
    const expected = freezeGeometryBaseline(frames.map((f) => rawReliabilityGeometry(f.landmarks, f.worldLandmarks)), b.y!.bodyScale);
    expect(b.geometry).toEqual(expected);
    const missing = measureReliabilityFrame(rawReliabilityGeometry([], []), b.geometry, null, 100);
    expect(missing.values['image.leftHipKneeRatio']).toBeNull(); expect(missing.values['world.swapAdvantage']).toBeNull();
    const summary = continuitySummary([{ ...missing, stageIndex: 0, calibrationOnly: false, posePresent: false, jointMissing: 16 }]);
    expect(summary.poseMissingCount).toBe(1); expect(summary.jointMissingCount).toBe(1);
    expect(summary.distributions['world.leftHipKneeRatio']).toMatchObject({ usable: 0, max: null });
  });
  it('treats original anchors as windows and recalculates detector events from current poses', () => {
    const altered = structuredClone(run); altered.frames.forEach((f) => { f.landmarks = structuredClone(run.frames[0].landmarks); f.worldLandmarks = structuredClone(run.frames[0].worldLandmarks); f.posePresent = true; });
    const a = analyzeEstimator(input, altered, anchors).trials[0];
    expect(a.anchorComparisons.map((t) => t.candidateStart)).toEqual(anchors[0].anchors.map((t) => t.candidateStart));
    expect(a.detectorReplay!.PRODUCTION_Y_V3.events).toEqual([]); expect(a.detectorReplay!.FIXED_REFERENCE.events).toEqual([]);
    expect(a.detectorReplay!.geometryQualityGate).toBe('NONE'); expect(a.detectorReplay!.controlLiveParityRequired).toBe(false);
  });
  it('ignores inference wall clock for baseline, geometry and all detector states/events', () => {
    const altered = structuredClone(run); altered.frames.forEach((f, i) => { f.inferenceMs = 10000 + i * 13; });
    expect(analyzeEstimator(input, run, anchors).trials).toEqual(analyzeEstimator(input, altered, anchors).trials);
  });
  it('preserves original LANDMARK oracle and has deterministic same-pose analysis', () => {
    const before = replayKneeKickV3(session, 1), a = analyzeEstimator(input, run, anchors), b = analyzeEstimator(input, run, anchors);
    expect(a).toEqual(b); expect(replayKneeKickV3(session, 1)).toEqual(before);
    expect(a.trials[0].detectorReplay!.PRODUCTION_Y_V3.counts).toEqual(before.counts);
    expect(a.trials[0].detectorReplay!.PRODUCTION_Y_V3.finalState).toEqual(before.result.finalState);
  });
  it('requires five manual roles, all variants, matching sequences and usable baselines before attribution', () => {
    const result = analyzeEstimator(input, run, anchors), report = compareEstimators([result], 'fixed');
    expect(report.analysisStatus).toBe('POST_FAILURE_EXPLORATORY'); expect(report.attribution).toBe('INSUFFICIENT_EVIDENCE');
    expect(report.perVariant.map((p) => p.assessment)).toEqual(['CONTROL', 'INSUFFICIENT_EVIDENCE', 'INSUFFICIENT_EVIDENCE']);
    expect(report).not.toHaveProperty('best'); expect(report.frameSequenceParity.every((p) => !p.identical)).toBe(true);
  });
  it('requires role assignment even if filenames resemble fixture roles', () => {
    expect(() => estimatorAnchors({ ...input, filename: 'REFERENCE_LIVE_1.json', role: 'UNASSIGNED' })).toThrow('manually');
  });
  it('exports local analysis fields and explicit diagnostic performance', () => {
    const result = analyzeEstimator(input, run, anchors), report = compareEstimators([result], 'fixed');
    expect(result.performance).toMatchObject({ medianMs: 12, p95Ms: 12, maxMs: 12, estimatedSustainableFps: 1000 / 12 });
    for (const key of ['estimatorContinuityEvidence', 'mediaIdentity', 'variantConfigs', 'frameSequenceParity', 'perVariant', 'perFixture', 'anchorComparisons', 'geometryContinuity', 'detectorReplay', 'performance', 'attribution']) expect(report).toHaveProperty(key);
  });
});


describe('repeatability and conservative estimator assessment', () => {
  it('reports GPU tolerance and does not mask changed event timing or availability', () => {
    const a = analyzeEstimator(input, run, anchors), changed = structuredClone(run), b = structuredClone(a);
    changed.frames[0].landmarks[23].x += 1e-6;
    let check = compareEstimatorRepetition(run, changed, a, b);
    expect(check.maxCoordinateDelta).toBeGreaterThan(0); expect(check.coordinateDifferencesAboveTolerance).toBe(0);
    changed.frames[1].landmarks = [];
    b.trials[0].detectorReplay!.PRODUCTION_Y_V3.events[0].timestamp += 1;
    check = compareEstimatorRepetition(run, changed, a, b);
    expect(check.missingnessDifferences).toBeGreaterThan(0); expect(check.eventComparison[0].modes[0].eventsEqual).toBe(false);
    expect(() => compareEstimatorRepetition(run, { ...changed, variant: 'FULL_IMAGE' }, a, b)).toThrow('same variant');
  });
  it('requires event/stage preservation plus geometry support; false-free output alone is insufficient', () => {
    const base = analyzeEstimator(input, run, anchors);
    const roles = ['REFERENCE_OLD_CLEAN', 'STRESS', 'REFERENCE_LIVE_1', 'REFERENCE_LIVE_2', 'REFERENCE_LIVE_3'] as const;
    const results = (['FULL_VIDEO_CONTROL', 'FULL_IMAGE', 'HEAVY_VIDEO'] as const).flatMap((variant) => roles.map((role) => {
      const r = structuredClone(base); r.variant = variant; r.input.role = role; r.input.captureId = role;
      for (const t of r.trials) {
        const fixed = t.detectorReplay!.FIXED_REFERENCE;
        Object.assign(fixed, { left: 1, right: 1, falseEvents: 0, observableFalseEvents: 0, wrong: 0, duplicates: 0, crossGap: 0, reacquisitionFalse: 0 });
        fixed.stageOutcomes.forEach((s) => { if (s.expected.startsWith('KNEE_')) { s.correct = 1; s.eventCount = 1; s.expectedObservable = true; } });
        // Identical geometry, so event success alone must never establish estimator improvement.
      }
      return r;
    }));
    let report = compareEstimators(results);
    expect(report.perVariant[1].assessment).toBe('EVENT_ONLY_IMPROVEMENT');
    const image = results.find((r) => r.variant === 'FULL_IMAGE' && r.input.role === 'REFERENCE_LIVE_3')!;
    image.trials[0].geometryContinuity.poseMissingCount += 100;
    report = compareEstimators(results); expect(report.perVariant[1].assessment).toBe('REJECTED');
    image.trials[0].geometryContinuity.poseMissingCount -= 100;
    image.trials[0].detectorReplay!.FIXED_REFERENCE.stageOutcomes.find((s) => s.expected === 'KNEE_RIGHT')!.correct = 0;
    expect(compareEstimators(results).perVariant[1].assessment).toBe('REJECTED');
    image.sequence.timestampHash = 'different'; expect(compareEstimators(results).perVariant[1].assessment).toBe('INSUFFICIENT_EVIDENCE');
  });
});
