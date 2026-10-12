// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readyCapture } from '../replay/v2TestFixtures';
import { readReplaySession } from '../replay/readReplaySession';
import type { ReplaySession } from '../replay/replayTypes';
import { frameSequence, type EstimatorRun, type FramePlan } from '../estimator/estimatorInference';
import { estimatorConfig, ESTIMATOR_VARIANTS } from '../estimator/estimatorConfig';
import { assessHoldoutEvents, createV2HoldoutReport } from './v2HoldoutAnalysis';

let session: ReplaySession, runs: EstimatorRun[], plan: FramePlan;
const createdAt = '2026-10-12T00:00:00.000Z';
beforeAll(async () => {
  const c = readyCapture();
  c.kick.startTest(3101); c.capture.observe({ kind: 'START', timestamp: 3101 }, c.read);
  for (let t = 3150; t <= 26000; t += 50) c.frame(t);
  await c.capture.stop(26050); session = readReplaySession(c.capture.getFiles().json);
  const timestamps = session.poseFrames.map((f) => f.tMs), sequence = await frameSequence(timestamps);
  plan = { timestamps, sequence };
  Object.assign(session.video.integrity!, { decodedFrameCount: sequence.decodedFrameCount, firstPtsMs: sequence.firstTimestamp,
    lastPtsMs: sequence.lastTimestamp, timestampHash: sequence.timestampHash });
  runs = ESTIMATOR_VARIANTS.map((variant) => ({ variant, config: estimatorConfig(variant),
    mediaIdentity: { captureId: session.captureId, validation: 'CRYPTOGRAPHIC_MEDIA_MATCH', sha256: session.video.integrity!.sha256,
      inspectionComplete: true, renamed: false, expectedFilename: session.video.filename, selected: { filename: session.video.filename, sourceCaptureId: session.captureId } },
    sequence, frameSequenceParity: true,
    frames: session.poseFrames.map((f) => ({ ...structuredClone(f), posePresent: !!f.landmarks.length, inferenceMs: 10 })),
    clock: 'decoded media PTS * 1000 = existing VIDEO replay capture tMs mapping' }));
});
describe('single V2 holdout analysis boundaries', () => {
  it('uses all PTS, each own 3s baseline, all stages/coverage and offline-only timing without old roles or anchors', async () => {
    const input = JSON.stringify(session), changed = structuredClone(runs);
    changed[1].frames.forEach((f) => f.landmarks.forEach((p) => { p.x *= 2; p.y *= 2; }));
    const report = await createV2HoldoutReport(session, changed, plan, createdAt);
    expect(report).toMatchObject({ step: '4Q', integrityStatus: 'PASS', generalization: 'INSUFFICIENT', productionReplacement: false,
      policy: { historicalFalseAnchorsUsed: false, fiveRoleAcceptanceApplied: false, liveBitIdenticalRequired: false } });
    expect(report.variants).toHaveLength(3);
    for (const v of report.variants) {
      expect(v.baseline).toMatchObject({ baselineStatus: 'READY', neutralFrameCount: 60, leftUsableSamples: 60, rightUsableSamples: 60,
        window: { source: 'ESTIMATOR_NEUTRAL_REFERENCE', startMs: 100, endMs: 3100 } });
      expect(v.replay!.FIXED_REFERENCE.flexionBaseline).toMatchObject({ startMs: 100, endMs: 3100, frameCount: 60 });
      expect(v.replay!.FIXED_REFERENCE.segmentBaseline).toMatchObject({ startMs: 100, endMs: 3100, frameCount: 60 });
      expect(v.perStage).toHaveLength(9);
      expect(Object.keys(v.perStage[0].coverage.joints)).toHaveLength(8);
      expect(v.performance).toMatchObject({ totalInferenceFrames: plan.timestamps.length, meanMs: 10, inferenceOnlyFps: 100 });
      expect(v.sequence).toEqual(plan.sequence);
    }
    expect(report.variants[1].baseline.bodyScale).toBeCloseTo(report.variants[0].baseline.bodyScale! * 2);
    expect(JSON.stringify(session)).toBe(input);
    expect(report).toEqual(await createV2HoldoutReport(session, changed, plan, createdAt));
  });
  it('keeps an insufficient variant null rather than borrowing LIVE or another estimator baseline', async () => {
    const changed = structuredClone(runs), start = session.liveResult.trials[0].estimatorNeutralReference!.startMs;
    let usable = 0;
    for (const f of changed[1].frames) if (f.tMs >= start && f.tMs <= 3100 && ++usable > 19) {
      f.landmarks = []; f.worldLandmarks = []; f.posePresent = false;
    }
    const report = await createV2HoldoutReport(session, changed, plan, createdAt), v = report.variants[1];
    expect(v).toMatchObject({ baselineStatus: 'INSUFFICIENT_VARIANT_NEUTRAL', eventAssessment: 'INSUFFICIENT', replay: null,
      baseline: { y: null, leftUsableSamples: 19, rightUsableSamples: 19 } });
    expect(report.variants[0].baselineStatus).toBe('READY');
  });
  it('does not hide missing frames/joints or use LIVE bit parity as a gate', async () => {
    const changed = structuredClone(runs);
    for (const f of changed[0].frames) if (f.tMs >= 5101 && f.tMs < 8101) { f.landmarks = []; f.worldLandmarks = []; f.posePresent = false; }
    const report = await createV2HoldoutReport(session, changed, plan, createdAt);
    const stage = report.variants[0].perStage[1];
    expect(stage.coverage.pose).toEqual({ usableFrames: 0, coverage: 0 });
    expect(stage.geometry.poseMissingCount).toBe(stage.coverage.frameCount);
    expect(stage.geometry.missingJointObservations).toBe(stage.coverage.frameCount * 16);
    expect(stage.geometry.distributions['image.leftHipKneeRatio'].usable).toBe(0);
  });
  it('keeps post-Guided LIVE events separate without changing any trial count', async () => {
    const changed = structuredClone(session), trial = changed.liveResult.trials[0];
    changed.liveResult.events.push({ id: 999, direction: 'KNEE_RIGHT', tMs: trial.endMs! + 200, trialId: null });
    const a = await createV2HoldoutReport(session, runs, plan, createdAt), b = await createV2HoldoutReport(changed, runs, plan, createdAt);
    expect(b.recordedLive.postGuidedDiagnostic).toMatchObject({ includedInRecallOrFalse: false, events: [{ id: 999, trialId: null }] });
    expect(b.variants).toEqual(a.variants);
    for (const v of b.variants) expect(v.replay!.postGuidedDiagnostic).toMatchObject({ labelled: false, includedInRecallOrFalse: false });
  });
  it('rejects mismatching, missing and duplicate variant frames rather than silently subsampling', async () => {
    for (const mutation of ['pts', 'drop', 'duplicate'] as const) {
      const changed = structuredClone(runs);
      if (mutation === 'pts') changed[1].frames[3].tMs++;
      if (mutation === 'drop') changed[1].frames.pop();
      if (mutation === 'duplicate') changed[1].frames[3].tMs = changed[1].frames[2].tMs;
      await expect(createV2HoldoutReport(session, changed, plan)).rejects.toThrow('sequence mismatch');
    }
    await expect(createV2HoldoutReport(session, runs.slice(0, 2), plan)).rejects.toThrow('three registered variants');
    await expect(createV2HoldoutReport(session, [runs[0], runs[0], runs[2]], plan)).rejects.toThrow('three registered variants');
  });
  it('continues Y replay after Guided but excludes an actual post-Guided pulse from scored events', async () => {
    const changed = structuredClone(runs);
    for (const f of changed[0].frames) if (f.tMs >= 25300 && f.tMs < 25800) f.landmarks[25].y += .5;
    const report = await createV2HoldoutReport(session, changed, plan, createdAt), replay = report.variants[0].replay!;
    expect(replay.postGuidedDiagnostic.PRODUCTION_Y_V3).toHaveLength(1);
    expect(replay.postGuidedDiagnostic.PRODUCTION_Y_V3[0]).toMatchObject({ direction: 'KNEE_LEFT' });
    expect(replay.PRODUCTION_Y_V3.events).toEqual([]);
    expect(replay.PRODUCTION_Y_V3.counts.leftCorrectEvents).toBe(0);
    expect(replay.PRODUCTION_Y_V3.counts.falseEvents).toBe(0);
  });
  it('rejects an unverified hash, altered configuration and a tampered PTS plan', async () => {
    const changed = structuredClone(runs); Object.assign(changed[0].mediaIdentity, { sha256: '0'.repeat(64) });
    await expect(createV2HoldoutReport(session, changed, plan)).rejects.toThrow('UNVERIFIED_VARIANT_MEDIA');
    const config = structuredClone(runs); Object.assign(config[0].config.options, { minTrackingConfidence: .9 });
    await expect(createV2HoldoutReport(session, config, plan)).rejects.toThrow('CONFIG_OR_SEQUENCE');
    await expect(createV2HoldoutReport(session, runs, { ...plan, timestamps: plan.timestamps.slice(1) })).rejects.toThrow('INVALID_PTS_PLAN');
  });
});

describe('descriptive PASS / FAIL / INSUFFICIENT', () => {
  const stages = ['NEUTRAL', 'TWIST_LEFT', 'TWIST_RIGHT', 'KNEE_LEFT', 'KNEE_RIGHT'].map((expected) => ({
    expected, observable: true, correct: expected.startsWith('KNEE_') ? 1 : 0, wrong: 0, duplicates: 0, falseEvents: 0 }));
  const safety = { falseEvents: 0, wrong: 0, duplicates: 0, crossGap: 0, reacquisitionFalse: 0, softGapCross: 0, softRecoveryFalse: 0 };
  it('does not confuse positive recall counts with safety violations', () => {
    expect(assessHoldoutEvents(stages, { ...safety, ...{ leftCorrectEvents: 1, rightCorrectEvents: 1 } })).toBe('PASS');
  });
  it.each(Object.keys(safety))('reports %s violations independently', (key) => {
    expect(assessHoldoutEvents(stages, { ...safety, [key]: 1 })).toBe('FAIL');
  });
  it('distinguishes an observable miss from insufficient coverage', () => {
    const changed = structuredClone(stages); changed[3].correct = 0;
    expect(assessHoldoutEvents(changed, safety)).toBe('FAIL');
    changed[3].observable = false; expect(assessHoldoutEvents(changed, safety)).toBe('INSUFFICIENT');
    expect(assessHoldoutEvents(stages.slice(0, 3), safety)).toBe('INSUFFICIENT');
  });
});
