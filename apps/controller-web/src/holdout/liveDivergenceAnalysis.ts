import { discoveryStages, stageForTime } from '../discovery/discoveryStages';
import { rebuildEstimatorBaseline } from '../estimator/estimatorAnalysis';
import type { EstimatorRun } from '../estimator/estimatorInference';
import { PoseFeatureAnalysis, CALIBRATION_WINDOW_MS, KNEE_CALIBRATION_GRACE_MS } from '../pose/features/poseFeatureAnalysis';
import { buildKneeKickBaselineV3 } from '../pose/kick/kneeKickBaselineV3';
import { Y_KICK_V3_CONFIG, validKneeKickBaselineV3, type KneeKickBaselineV3 } from '../pose/kick/kneeKickDetectorV3';
import { extractKneeMotionFeatures } from '../pose/motion/kneeMotionFeatures';
import { replayKneeKickV3, type KneeKickV3Replay } from '../replay/kneeKickV3Replay';
import { latestCalibrationStart, orderedFrames, REPLAY_TIMESTAMP_TOLERANCE_MS } from '../replay/landmarkReplay';
import { asPoseFrame, type ReplayPoseFrame, type ReplaySession } from '../replay/replayTypes';
import { alignFrames, diagnosticTrace, frameCoverage, frameTimeline, stageSignals } from './divergenceTimeline';

/** No model, media decoder, or mutable production configuration is used by this module. */
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const baselineKeys = ['bodyScale', 'leftXMedian', 'rightXMedian', 'leftYMedian', 'rightYMedian', 'leftDistanceMedian', 'rightDistanceMedian'] as const;
export function baselineDifference(a: KneeKickBaselineV3 | null, b: KneeKickBaselineV3 | null) {
  return Object.fromEntries(baselineKeys.map((k) => [k, a && b ? b[k] - a[k] : null]));
}
function equalBaseline(a: KneeKickBaselineV3 | null, b: KneeKickBaselineV3 | null) {
  return a && b ? baselineKeys.every((k) => Math.abs(a[k] - b[k]) <= 1e-9) : a === b;
}

/** Audit the actual bounded production collection, including its completing frame/grace rule.
 * This mirror only identifies admitted frame indices. The original calibration replay separately
 * verifies the baseline, so a changed collection implementation cannot silently become evidence.
 */
export function productionBaselineAudit(session: ReplaySession) {
  const trial = session.liveResult.trials[0], start = latestCalibrationStart(session, trial);
  if (!start) return { status: 'INSUFFICIENT' as const, reason: 'NO_PRODUCTION_CALIBRATION_START' };
  const neutral = new PoseFeatureAnalysis(); neutral.startCalibration(start.tMs);
  let collected: ReplayPoseFrame[] = [];
  for (const frame of orderedFrames(session.poseFrames)) {
    if (frame.tMs < start.tMs || frame.tMs === start.tMs && frame.order <= start.order || frame.tMs >= trial.startMs) continue;
    const f = asPoseFrame(frame); neutral.processFrame(f.landmarks, f.worldLandmarks, f.timestamp);
    const view = neutral.getView(f.timestamp);
    if (view.collectionState === 'IDLE') continue;
    if (view.collectionState !== 'FROZEN' || view.hipReadyAt !== null && f.timestamp < view.hipReadyAt + KNEE_CALIBRATION_GRACE_MS) collected.push(frame);
    collected = collected.filter((r) => r.tMs > frame.tMs - CALIBRATION_WINDOW_MS);
    if (view.collectionState === 'FROZEN') {
      const rebuilt = buildKneeKickBaselineV3(collected.map((r) => extractKneeMotionFeatures(r.landmarks)));
      return { status: equalBaseline(rebuilt, trial.baselineV3 ?? null) ? 'PASS' as const : 'FAIL' as const,
        calibrationStartMs: start.tMs, freezeFrameMs: frame.tMs, windowStartExclusiveMs: frame.tMs - CALIBRATION_WINDOW_MS,
        firstUsedMs: collected[0]?.tMs ?? null, lastUsedMs: collected.at(-1)?.tMs ?? null,
        frameIndices: collected.map((f) => session.poseFrames.indexOf(f)), coverage: frameCoverage(collected), rebuilt };
    }
  }
  return { status: 'INSUFFICIENT' as const, reason: 'NO_FROZEN_FRAME' };
}

export function originalParity(session: ReplaySession, replay = replayKneeKickV3(session, session.liveResult.trials[0].id)) {
  const trial = session.liveResult.trials[0], stages = discoveryStages(session, trial).stages;
  const liveEvents = session.liveResult.events.filter((e) => e.trialId === trial.id && stageForTime(stages, e.tMs));
  const trialEvents = trial.result.events;
  const eventEqual = liveEvents.length === trialEvents.length && trialEvents.every((e, i) => {
    const l = liveEvents[i]; return l.id === e.id && l.direction === e.direction && Math.abs(l.tMs - e.tMs) <= REPLAY_TIMESTAMP_TOLERANCE_MS;
  });
  const c = replay.comparison;
  const countsEqual = replay.result.poseFrameCount === trial.result.poseFrameCount && replay.result.poseUsableFrameCount === trial.result.poseUsableFrameCount;
  const stageComparison = stages.map((stage) => {
    const events = liveEvents.filter((e) => stageForTime(stages, e.tMs)?.stageIndex === stage.stageIndex);
    const kick = stage.expected.startsWith('KNEE_'), recorded = { correct: events.filter((e) => e.direction === stage.expected).length,
      wrongDirection: kick ? events.filter((e) => e.direction !== stage.expected).length : 0,
      duplicates: kick ? Math.max(0, events.length - 1) : 0, falseEvents: kick ? 0 : events.length };
    const actual = replay.stages.find((s) => s.stageIndex === stage.stageIndex);
    return { ...stage, recordedFromLiveEvents: recorded,
      equal: !!actual && Object.entries(recorded).every(([key, value]) => actual[key as keyof typeof recorded] === value) };
  });
  return { status: c?.available && c.eventsEqual && c.finalStateEqual && c.guidedSummaryEqual && eventEqual && countsEqual && stageComparison.every((s) => s.equal) ? 'PASS' as const : 'FAIL' as const,
    comparison: c, recordedEventListsAgree: eventEqual, frameCountsEqual: countsEqual,
    recorded: trial.result, replay: replay.result, counts: replay.counts, stages: replay.stages, stageComparison,
    eventTimestampDeltasMs: replay.result.events.map((e, i) => trialEvents[i] ? e.tMs - trialEvents[i].tMs : null),
    finalDiagnostics: replay.finalDiagnostics, calibrationParity: replay.calibrationParity,
    postGuided: { events: session.liveResult.events.filter((e) => e.tMs >= stages.at(-1)!.endMs), includedInScores: false } };
}

/** Null/invalid baselines are NOT_COMPARABLE; do not trigger replay's reconstruction fallback. */
export function counterfactualReplay(session: ReplaySession, frames: ReplayPoseFrame[], baseline: KneeKickBaselineV3 | null, useLiveClocks: boolean) {
  if (!validKneeKickBaselineV3(baseline)) return null;
  const trial = session.liveResult.trials[0];
  const copy: ReplaySession = { ...session, poseFrames: frames, clockSamples: useLiveClocks ? session.clockSamples : [],
    liveResult: { ...session.liveResult, trials: [{ ...trial, baselineV3: baseline }] } };
  return replayKneeKickV3(copy, trial.id);
}
function replaySummary(r: KneeKickV3Replay | null) {
  return r ? { status: 'COMPARABLE' as const, counts: r.counts, events: r.events, finalState: r.result.finalState,
    frameCount: r.result.poseFrameCount, usableFrameCount: r.result.poseUsableFrameCount, stages: r.stages,
    stageSignals: r.stages.map((s) => ({ stageIndex: s.stageIndex, expected: s.expected,
      signals: stageSignals(r.diagnostics.filter((d) => d.stageIndex === s.stageIndex)) })) } : { status: 'NOT_COMPARABLE' as const, reason: 'INVALID_OR_MISSING_BASELINE' };
}
/** Timestamp changes alone are recorded separately from event-count/direction/stage changes. */
function eventSignature(r: KneeKickV3Replay | null) {
  return r ? { counts: r.counts, events: r.events.map((e) => ({ direction: e.direction, stageIndex: e.stageIndex })), finalState: r.result.finalState } : null;
}
function contrast(a: KneeKickV3Replay | null, b: KneeKickV3Replay | null) {
  if (!a || !b) return { status: 'NOT_COMPARABLE' as const, outcomeChanged: null, eventTimesChanged: null };
  return { status: 'COMPARABLE' as const, outcomeChanged: !equal(eventSignature(a), eventSignature(b)),
    eventTimesChanged: !equal(a.result.events, b.result.events) };
}
export function classifyAttribution(parity: 'PASS' | 'FAIL', baseline: boolean, stream: boolean, timing: boolean) {
  if (parity === 'FAIL') return 'REPLAY_PARITY_FAILURE';
  if (Number(baseline) + Number(stream) + Number(timing) > 1) return 'MIXED';
  return baseline ? 'BASELINE_SENSITIVE' : stream ? 'INPUT_STREAM_SENSITIVE' : timing ? 'TIMING_OR_SAMPLING_SENSITIVE' : 'INSUFFICIENT_EVIDENCE';
}

export function createLiveDivergenceReport(session: ReplaySession, runs: readonly EstimatorRun[]) {
  const trial = session.liveResult.trials[0];
  if (session.version !== 2 || session.detectorMode !== 'Y_V3' || session.liveResult.trials.length !== 1 || !trial?.estimatorNeutralReference)
    throw new Error('STEP4R requires one V2 Y_V3 trial with its recorded reference.');
  if (!validKneeKickBaselineV3(trial.baselineV3)) throw new Error('Stored production V3 baseline required; no fallback.');
  const stages = discoveryStages(session, trial);
  if (stages.source !== 'GUIDED_STAGE_CHANGE' || stages.stages.length !== 9) throw new Error('Original complete Guided markers required.');
  for (const variant of ['FULL_VIDEO_CONTROL', 'FULL_IMAGE', 'HEAVY_VIDEO'])
    if (runs.filter((r) => r.variant === variant).length !== 1) throw new Error('Exactly one cached run per registered variant required.');
  // A timestamp defect must not be hidden by orderedFrames' production duplicate filter.
  for (const frames of [session.poseFrames, ...runs.map((r) => r.frames)])
    if (frames.some((f, i) => !Number.isFinite(f.tMs) || i > 0 && f.tMs <= frames[i - 1].tMs)) throw new Error('NON_MONOTONIC_SOURCE_TIMELINE');

  const original = replayKneeKickV3(session, trial.id), parity = originalParity(session, original);
  const video = runs.find((r) => r.variant === 'FULL_VIDEO_CONTROL')!;
  const liveFrames = session.poseFrames.map((f) => ({ ...f, posePresent: f.landmarks.length > 0, inferenceMs: 0 }));
  const b = rebuildEstimatorBaseline(session, trial, { frames: liveFrames }, 'UNASSIGNED');
  const c = rebuildEstimatorBaseline(session, trial, video, 'UNASSIGNED');
  const a = trial.baselineV3;
  const liveB = counterfactualReplay(session, session.poseFrames, b.y, true);
  const videoA = counterfactualReplay(session, video.frames, a, false);
  const videoC = counterfactualReplay(session, video.frames, c.y, false);
  const cases = [
    { id: 'LIVE_A', stream: 'LIVE', baseline: 'A_PRODUCTION', clocks: 'ACTUAL_LIVE', replay: original },
    { id: 'LIVE_B', stream: 'LIVE', baseline: 'B_LIVE_3S', clocks: 'ACTUAL_LIVE', replay: liveB },
    { id: 'VIDEO_A', stream: 'FULL_VIDEO_CONTROL', baseline: 'A_PRODUCTION', clocks: 'NONE_DECODED_PTS', replay: videoA },
    { id: 'VIDEO_C', stream: 'FULL_VIDEO_CONTROL', baseline: 'C_VIDEO_3S', clocks: 'NONE_DECODED_PTS', replay: videoC },
  ];
  const noClocks = counterfactualReplay(session, session.poseFrames, a, false);
  const alignment = alignFrames(session.poseFrames, video.frames, stages.stages);
  const guidedMatches = alignment.matches.filter((m) => m.stageIndex !== null);
  const matchedVideo = guidedMatches.map((m) => video.frames[m.videoIndex]);
  const retimedVideo = guidedMatches.map((m) => ({ ...video.frames[m.videoIndex], tMs: m.liveMs, order: session.poseFrames[m.liveIndex].order }));
  const subset = guidedMatches.length ? counterfactualReplay(session, matchedVideo, a, false) : null;
  const retimed = guidedMatches.length ? counterfactualReplay(session, retimedVideo, a, false) : null;
  const comparisons = { baselineOnLive: contrast(original, liveB), baselineOnVideo: contrast(videoA, videoC),
    inputWithProductionBaseline: contrast(original, videoA), liveClocksRemoved: contrast(original, noClocks),
    matchedSubsetRetimed: contrast(subset, retimed), videoSubsetVsFull: contrast(videoA, subset) };
  const timingSensitive = comparisons.liveClocksRemoved.outcomeChanged === true || comparisons.matchedSubsetRetimed.outcomeChanged === true;
  const samplingSensitive = comparisons.videoSubsetVsFull.outcomeChanged === true;
  const baselineSensitive = comparisons.baselineOnLive.outcomeChanged === true || comparisons.baselineOnVideo.outcomeChanged === true;
  const streamSensitive = comparisons.inputWithProductionBaseline.outcomeChanged === true;
  const audit = productionBaselineAudit(session);
  const reference = trial.estimatorNeutralReference;
  const inReference = (frames: ReplayPoseFrame[]) => frames.filter((f) => f.tMs >= reference.startMs && f.tMs <= reference.endMs);
  const auxiliary = runs.filter((r) => r !== video).map((run) => {
    const baseline = rebuildEstimatorBaseline(session, trial, run, 'UNASSIGNED');
    const replay = counterfactualReplay(session, run.frames, baseline.y, false);
    return { variant: run.variant, baseline: baseline.y, baselineStatus: baseline.y ? 'READY' : 'INSUFFICIENT_VARIANT_NEUTRAL',
      detectorAssessment: baseline.y ? 'DESCRIPTIVE_ONLY' : 'NOT_EVALUATED',
      neutralCoverage: frameCoverage(inReference(run.frames)), timeline: frameTimeline(session, run.frames),
      replay: replaySummary(replay), trace: replay ? diagnosticTrace(replay) : null };
  });
  return { version: 1, step: '4R', scope: 'ANALYSIS_ONLY_SAVED_INPUTS', captureId: session.captureId,
    detectorConfig: Y_KICK_V3_CONFIG, originalParity: parity,
    baselines: {
      A: { source: 'STORED_PRODUCTION_V3', value: a, valid: true, collection: audit },
      B: { source: 'LIVE_OWN_EXACT_3S', value: b.y, valid: b.y !== null, window: b.window, coverage: frameCoverage(inReference(session.poseFrames)) },
      C: { source: 'VIDEO_OWN_EXACT_3S', value: c.y, valid: c.y !== null, window: c.window, coverage: frameCoverage(inReference(video.frames)) },
      BMinusA: baselineDifference(a, b.y), CMinusA: baselineDifference(a, c.y), CMinusB: baselineDifference(b.y, c.y),
      note: 'Production uses a bounded 1s rolling collection ending at Neutral freeze; estimator reference is a different frozen 3s interval. No baseline is changed in production.' },
    counterfactuals: cases.map(({ replay, ...meta }) => ({ ...meta, diagnosticOnly: true, ...replaySummary(replay) })),
    timeline: { LIVE: frameTimeline(session, session.poseFrames), FULL_VIDEO_CONTROL: frameTimeline(session, video.frames) },
    alignment, timing: { actualClockSamplesTotal: session.clockSamples.length,
      actualTrialClockSamples: session.clockSamples.filter((c) => c.trialId === trial.id && c.tMs >= trial.startMs &&
        (c.tMs < trial.endMs! || c.tMs === trial.endMs && c.order <= (trial.endOrder ?? Infinity))).length,
      noClocks: replaySummary(noClocks), matchedSubset: replaySummary(subset), retimedSubset: replaySummary(retimed),
      matchedGuidedFrames: guidedMatches.length,
      subsetPolicy: 'Identical matched VIDEO frames/baseline, no clocks, only timestamps changed to matched LIVE times. Unmatched remain in alignment; this is not a full-stream parity claim.' },
    comparisons, auxiliary: auxiliary.map(({ trace: _trace, ...rest }) => rest),
    attribution: { category: classifyAttribution(parity.status, baselineSensitive, streamSensitive, timingSensitive || samplingSensitive),
      baselineSensitive, streamSensitive, timingSensitive, samplingSensitive,
      scope: 'Outcome sensitivity only. Fixed-baseline stream contrast includes pose availability, landmarks and sampling. No independent camera/model-cause experiment.',
      uncertainty: 'A same-stage temporal match is not the same camera frame. Subset removal is a sampling intervention, not a reproduction of LIVE sampling. Stream and sampling sensitivities overlap; they are not independent root causes. Negative clock/retiming controls do not rule out other timing effects. One capture cannot establish superiority or production replacement.' },
    traces: Object.fromEntries([...cases.map((c) => [c.id, c.replay ? diagnosticTrace(c.replay) : null]),
      ['VIDEO_MATCHED_SUBSET', subset ? diagnosticTrace(subset) : null], ['VIDEO_RETIMED_SUBSET', retimed ? diagnosticTrace(retimed) : null],
      ...auxiliary.map((v) => [v.variant, v.trace])]),
  };
}
