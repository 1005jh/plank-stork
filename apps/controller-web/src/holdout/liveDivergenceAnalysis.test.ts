// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readyCapture } from '../replay/v2TestFixtures';
import { readReplaySession } from '../replay/readReplaySession';
import { replayKneeKickV3 } from '../replay/kneeKickV3Replay';
import { REPLAY_TIMESTAMP_TOLERANCE_MS } from '../replay/landmarkReplay';
import type { ReplayPoseFrame, ReplaySession } from '../replay/replayTypes';
import { frameSequence, type EstimatorRun, type FramePlan } from '../estimator/estimatorInference';
import { estimatorConfig, ESTIMATOR_VARIANTS } from '../estimator/estimatorConfig';
import { createV2HoldoutReport } from './v2HoldoutAnalysis';
import { baselineDifference, classifyAttribution, counterfactualReplay, createLiveDivergenceReport, originalParity, productionBaselineAudit } from './liveDivergenceAnalysis';
import { ALIGNMENT_TOLERANCE_MS, alignFrames, frameCoverage, observedDistribution } from './divergenceTimeline';

let session: ReplaySession, runs: EstimatorRun[], plan: FramePlan;
beforeAll(async () => {
  const c = readyCapture(); c.kick.startTest(3101); c.capture.observe({ kind: 'START', timestamp: 3101 }, c.read);
  for (let t = 3150; t <= 26000; t += 50) c.frame(t);
  await c.capture.stop(26050); session = readReplaySession(c.capture.getFiles().json);
  const timestamps = session.poseFrames.map((f) => f.tMs), sequence = await frameSequence(timestamps); plan = { timestamps, sequence };
  Object.assign(session.video.integrity!, { decodedFrameCount: sequence.decodedFrameCount, firstPtsMs: sequence.firstTimestamp,
    lastPtsMs: sequence.lastTimestamp, timestampHash: sequence.timestampHash });
  runs = ESTIMATOR_VARIANTS.map((variant) => ({ variant, config: estimatorConfig(variant), sequence, frameSequenceParity: true,
    mediaIdentity: { captureId: session.captureId, validation: 'CRYPTOGRAPHIC_MEDIA_MATCH', sha256: session.video.integrity!.sha256,
      inspectionComplete: true, renamed: false, expectedFilename: session.video.filename, selected: { filename: session.video.filename, sourceCaptureId: session.captureId } },
    frames: session.poseFrames.map((f) => ({ ...structuredClone(f), posePresent: !!f.landmarks.length, inferenceMs: 10 })),
    clock: 'decoded media PTS * 1000 = existing VIDEO replay capture tMs mapping' }));
});

describe('LIVE parity is an independent prerequisite', () => {
  it('reproduces original frames/baseline/stages and real clock reads without altering inputs', () => {
    const changed = structuredClone(session), trial = changed.liveResult.trials[0];
    changed.clockSamples.push({ tMs: trial.startMs + 10, order: 10000, trialId: trial.id });
    const before = structuredClone(changed), p = originalParity(changed);
    expect(p.status).toBe('PASS'); expect(p.frameCountsEqual).toBe(true);
    expect(p.stageComparison).toHaveLength(9); expect(p.stageComparison.every((s) => s.equal)).toBe(true);
    expect(p.comparison).toMatchObject({ eventsEqual: true, guidedSummaryEqual: true, finalStateEqual: true });
    expect(changed).toEqual(before);
  });
  it.each(['events', 'finalState', 'guidedSummary', 'poseFrameCount'] as const)('reports stored %s mismatch as parity failure', (key) => {
    const changed = structuredClone(session), result = changed.liveResult.trials[0].result;
    if (key === 'events') result.events.push({ id: 900, direction: 'KNEE_LEFT', tMs: 16000 });
    if (key === 'finalState') result.finalState = 'WAIT_RETURN';
    if (key === 'guidedSummary') result.guidedSummary!.NEUTRAL.falseKickCount++;
    if (key === 'poseFrameCount') result.poseFrameCount++;
    expect(originalParity(changed).status).toBe('FAIL');
    expect(createLiveDivergenceReport(changed, runs).attribution.category).toBe('REPLAY_PARITY_FAILURE');
  });
  it('uses the existing microsecond tolerance, not the frame-alignment tolerance, for event parity', () => {
    const changed = structuredClone(session), trial = changed.liveResult.trials[0];
    for (const f of changed.poseFrames) if (f.tMs >= 15500 && f.tMs < 16000) f.landmarks[25].y += .5;
    const replay = replayKneeKickV3(changed, trial.id); expect(replay.events).toHaveLength(1);
    trial.result = structuredClone(replay.result);
    changed.liveResult.events = trial.result.events.map((e) => ({ ...e, trialId: trial.id }));
    expect(originalParity(changed).status).toBe('PASS');
    trial.result.events[0].tMs += REPLAY_TIMESTAMP_TOLERANCE_MS / 2;
    expect(originalParity(changed).status).toBe('PASS');
    trial.result.events[0].tMs += REPLAY_TIMESTAMP_TOLERANCE_MS * 2;
    expect(originalParity(changed).status).toBe('FAIL');
  });
  it('preserves replay start/end order boundaries instead of treating same timestamps as identical operations', () => {
    const trial = session.liveResult.trials[0], f = session.poseFrames[0];
    const frames = [
      { ...f, tMs: trial.startMs, order: trial.startOrder },
      { ...f, tMs: trial.startMs + 1, order: trial.startOrder + 1 },
      { ...f, tMs: trial.endMs!, order: trial.endOrder! },
      { ...f, tMs: trial.endMs! + 1, order: trial.endOrder! + 1 },
    ];
    expect(counterfactualReplay(session, frames, trial.baselineV3!, true)!.result.poseFrameCount).toBe(2);
    frames[0].order++;
    expect(counterfactualReplay(session, frames, trial.baselineV3!, true)!.result.poseFrameCount).toBe(3);
    frames[2].order++;
    expect(counterfactualReplay(session, frames, trial.baselineV3!, true)!.result.poseFrameCount).toBe(2);
  });
  it('excludes post-Guided events, including a real post-Guided replay pulse, from scored parity', () => {
    const changed = structuredClone(session);
    for (const f of changed.poseFrames) if (f.tMs >= 25400 && f.tMs < 25900) f.landmarks[26].y += .5;
    changed.liveResult.events.push({ id: 999, direction: 'KNEE_RIGHT', tMs: 25450, trialId: null });
    const p = originalParity(changed);
    expect(p.status).toBe('PASS'); expect(p.counts.falseEvents).toBe(0); expect(p.replay.events).toEqual([]);
    expect(p.postGuided).toMatchObject({ includedInScores: false, events: [{ id: 999 }] });
  });
});

describe('baseline and stream counterfactual boundaries', () => {
  it('audits stored production baseline independently of both own-landmark 3s reconstructions', () => {
    expect(productionBaselineAudit(session)).toMatchObject({ status: 'PASS', coverage: { frameCount: 20 } });
    const changed = structuredClone(runs);
    changed[0].frames.forEach((f) => f.landmarks.forEach((p) => { p.x *= 2; p.y *= 2; }));
    const r = createLiveDivergenceReport(session, changed);
    expect(r.baselines.A.value).toEqual(session.liveResult.trials[0].baselineV3);
    expect(r.baselines.B.coverage.frameCount).toBe(60); expect(r.baselines.C.coverage.frameCount).toBe(60);
    expect(r.baselines.C.value!.bodyScale).toBeCloseTo(r.baselines.B.value!.bodyScale * 2);
    expect(r.baselines.B.window.startMs).toBe(r.baselines.C.window.startMs);
    expect(r.baselines.B.window.endMs).toBe(r.baselines.C.window.endMs);
    expect(r.counterfactuals.map((c) => [c.id, c.baseline, c.clocks])).toEqual([
      ['LIVE_A', 'A_PRODUCTION', 'ACTUAL_LIVE'], ['LIVE_B', 'B_LIVE_3S', 'ACTUAL_LIVE'],
      ['VIDEO_A', 'A_PRODUCTION', 'NONE_DECODED_PTS'], ['VIDEO_C', 'C_VIDEO_3S', 'NONE_DECODED_PTS'],
    ]);
    for (const c of r.counterfactuals) expect(c.status).toBe('COMPARABLE');
  });
  it('keeps absent/invalid baselines NOT_COMPARABLE and never borrows production for an insufficient variant', () => {
    const changed = structuredClone(runs);
    for (const f of changed[0].frames) if (f.tMs <= 3100) { f.landmarks = []; f.worldLandmarks = []; f.posePresent = false; }
    const r = createLiveDivergenceReport(session, changed);
    expect(r.baselines.C.value).toBeNull(); expect(r.counterfactuals[2].status).toBe('COMPARABLE');
    expect(r.counterfactuals[3].status).toBe('NOT_COMPARABLE');
    expect(counterfactualReplay(session, session.poseFrames, null, false)).toBeNull();
    expect(counterfactualReplay(session, session.poseFrames, { ...session.liveResult.trials[0].baselineV3!, bodyScale: NaN }, false)).toBeNull();
    expect(Object.values(baselineDifference(r.baselines.A.value, null)).every((v) => v === null)).toBe(true);
  });
  it('actually replays the four combinations: a VIDEO-only constant offset is false with A and neutral with its own C', () => {
    const changed = structuredClone(runs);
    for (const f of changed[0].frames) f.landmarks[25].y += .2;
    const r = createLiveDivergenceReport(session, changed);
    expect(r.counterfactuals.map((c) => c.counts?.falseEvents)).toEqual([0, 0, 1, 0]);
    expect(r.comparisons.baselineOnLive.outcomeChanged).toBe(false);
    expect(r.comparisons.baselineOnVideo.outcomeChanged).toBe(true);
    expect(r.comparisons.inputWithProductionBaseline.outcomeChanged).toBe(true);
  });
  it('does not evaluate HEAVY detector performance when knees are unusable even with a present pose', () => {
    const changed = structuredClone(runs);
    for (const f of changed[2].frames) { f.landmarks[25].visibility = .01; f.landmarks[26].visibility = .02; }
    const h = createLiveDivergenceReport(session, changed).auxiliary.find((v) => v.variant === 'HEAVY_VIDEO')!;
    expect(h).toMatchObject({ baseline: null, baselineStatus: 'INSUFFICIENT_VARIANT_NEUTRAL', detectorAssessment: 'NOT_EVALUATED',
      neutralCoverage: { poseMissing: 0, leftUsable: 0, rightUsable: 0 }, replay: { status: 'NOT_COMPARABLE' } });
  });
  it('produces deterministic results, leaves all inputs intact and reproduces the unchanged 4Q report', async () => {
    const before = structuredClone({ session, runs }), date = '2026-10-12T00:00:00.000Z';
    const oldReport = await createV2HoldoutReport(session, runs, plan, date);
    expect(createLiveDivergenceReport(session, runs)).toEqual(createLiveDivergenceReport(session, runs));
    expect({ session, runs }).toEqual(before);
    expect(await createV2HoldoutReport(session, runs, plan, date)).toEqual(oldReport);
  });
  it('rejects duplicate/non-finite timestamps rather than dropping frames silently', () => {
    const changed = structuredClone(runs); changed[0].frames[1].tMs = changed[0].frames[0].tMs;
    expect(() => createLiveDivergenceReport(session, changed)).toThrow('NON_MONOTONIC');
    changed[0].frames[1].tMs = NaN;
    expect(() => createLiveDivergenceReport(session, changed)).toThrow('NON_MONOTONIC');
  });
});

describe('fixed timeline alignment and missingness', () => {
  const frame = (tMs: number, order = 0): ReplayPoseFrame => ({ tMs, order, landmarks: [], worldLandmarks: [] });
  const stages = [{ stageIndex: 0, expected: 'NEUTRAL' as const, startMs: 100, endMs: 200 },
    { stageIndex: 1, expected: 'KNEE_LEFT' as const, startMs: 200, endMs: 300 }];
  it('keeps missing poses in one-to-one nearest matches and retains every unmatched frame', () => {
    const a = alignFrames([frame(110), frame(120), frame(160), frame(NaN)], [frame(105), frame(115), frame(250)], stages);
    expect(a.matches.map((m) => [m.liveIndex, m.videoIndex])).toEqual([[0, 0], [1, 1]]);
    expect(a.unmatchedLive.map((m) => m.index)).toEqual([2, 3]); expect(a.unmatchedVideo.map((m) => m.index)).toEqual([2]);
    expect(a.unmatchedLive[1].reason).toBe('NON_FINITE_TIMESTAMP');
    expect(a.matches.length + a.unmatchedLive.length).toBe(4); expect(a.matches.length + a.unmatchedVideo.length).toBe(3);
  });
  it('does not fit a time offset, reuse a frame, or match across Guided stage boundaries', () => {
    expect(alignFrames([frame(199)], [frame(201)], stages).matches).toHaveLength(0);
    expect(alignFrames([frame(120)], [frame(120 + ALIGNMENT_TOLERANCE_MS + .01)], stages).matches).toHaveLength(0);
    const a = alignFrames([frame(110), frame(111)], [frame(110)], stages);
    expect(a.matches).toHaveLength(1); expect(a.unmatchedLive).toHaveLength(1);
  });
  it('keeps NaN/null/missing observations unknown and distinct from a measured zero', () => {
    expect(observedDistribution([NaN, null, undefined, 0, Infinity])).toMatchObject({ frames: 5, usable: 1, missing: 2, nonFinite: 2, median: 0 });
    const f = structuredClone(session.poseFrames[0]); f.landmarks[25].visibility = NaN; f.landmarks[26].y = NaN;
    const c = frameCoverage([f, frame(200)]);
    expect(c).toMatchObject({ poseMissing: 1, leftUsable: 0, rightUsable: 0, posePresentLeftUnusable: 1, posePresentRightUnusable: 1 });
    expect(c.joints.leftKnee.visibility).toMatchObject({ nonFinite: 1, missing: 1, median: null });
    expect(Number.isNaN(f.landmarks[25].visibility)).toBe(true);
  });
});

describe('attribution is bounded by observed contrasts', () => {
  it('prioritizes parity failure and distinguishes single sensitivities from mixed/insufficient evidence', () => {
    expect(classifyAttribution('FAIL', true, true, true)).toBe('REPLAY_PARITY_FAILURE');
    expect(classifyAttribution('PASS', true, false, false)).toBe('BASELINE_SENSITIVE');
    expect(classifyAttribution('PASS', false, true, false)).toBe('INPUT_STREAM_SENSITIVE');
    expect(classifyAttribution('PASS', false, false, true)).toBe('TIMING_OR_SAMPLING_SENSITIVE');
    expect(classifyAttribution('PASS', false, true, true)).toBe('MIXED');
    expect(classifyAttribution('PASS', false, false, false)).toBe('INSUFFICIENT_EVIDENCE');
  });
});
