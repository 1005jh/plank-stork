import { ESTIMATOR_VALIDATION_PROTOCOL_V1 as PROTOCOL } from '../capture/estimatorValidationProtocol';
import { discoveryStages, stageForTime } from '../discovery/discoveryStages';
import { rawReliabilityGeometry, measureReliabilityFrame, GEOMETRY_JOINTS } from '../discovery/geometryReliabilityFeatures';
import { distribution, prepareIntegrityFixture } from '../discovery/integrityFeatures';
import { prepareMultiFixture } from '../discovery/analyzeMultiSignal';
import { runIntegrityFixture } from '../discovery/analyzeIntegrity';
import { IntegrityShadow, PRE_REGISTERED_INTEGRITY_CONFIG, FIXED_FLEXION_CONFIG } from '../discovery/integrityGuard';
import { continuitySummary, estimatorNeutralWindow, rebuildEstimatorBaseline } from '../estimator/estimatorAnalysis';
import { ESTIMATOR_VARIANTS, estimatorConfig } from '../estimator/estimatorConfig';
import { frameSequence, verifyFrameSequence, type EstimatorRun, type FramePlan } from '../estimator/estimatorInference';
import { KneeKickDetectorV3, Y_KICK_V3_CONFIG, usableKneesV3 } from '../pose/kick/kneeKickDetectorV3';
import { DETECTOR_TEST_SEQUENCE } from '../pose/kick/guidedDetectorTest';
import { extractKneeMotionFeatures } from '../pose/motion/kneeMotionFeatures';
import { replayKneeKickV3 } from '../replay/kneeKickV3Replay';
import { readReplaySession } from '../replay/readReplaySession';
import { verifyMediaSequence } from '../replay/mediaArtifact';
import type { ReplaySession } from '../replay/replayTypes';

type Status = 'PASS' | 'FAIL' | 'INSUFFICIENT';
type Run = EstimatorRun & { offlineWallMs?: number };
type Outcome = { expected: string; correct: number; wrong: number; duplicates: number; falseEvents: number; observable: boolean };
type Safety = { falseEvents: number; wrong: number; duplicates: number; crossGap: number; reacquisitionFalse: number; softGapCross: number; softRecoveryFalse: number };

/** Per-capture observation only; neither five-role acceptance nor estimator selection. */
export function assessHoldoutEvents(stages: readonly Outcome[], safety: Safety): Status {
  if ((['falseEvents', 'wrong', 'duplicates', 'crossGap', 'reacquisitionFalse', 'softGapCross', 'softRecoveryFalse'] as const)
    .some((key) => safety[key] > 0)) return 'FAIL';
  const knees = stages.filter((s) => s.expected.startsWith('KNEE_'));
  if (knees.some((s) => s.observable && s.correct !== 1)) return 'FAIL';
  if (!['KNEE_LEFT', 'KNEE_RIGHT'].every((side) => knees.some((s) => s.expected === side)) ||
      stages.some((s) => !s.observable)) return 'INSUFFICIENT';
  return 'PASS';
}
const aggregate = (statuses: Status[]): Status => statuses.includes('FAIL') ? 'FAIL' : statuses.includes('INSUFFICIENT') ? 'INSUFFICIENT' : 'PASS';
const joints = Object.keys(GEOMETRY_JOINTS) as (keyof typeof GEOMETRY_JOINTS)[];
const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v);

function coverage(frames: Run['frames']) {
  const raw = frames.map((f) => rawReliabilityGeometry(f.landmarks, f.worldLandmarks));
  const counts = (n: number) => ({ usableFrames: n, coverage: frames.length ? n / frames.length : null });
  const usable = frames.map((f) => usableKneesV3(extractKneeMotionFeatures(f.landmarks)));
  return { frameCount: frames.length, pose: counts(frames.filter((f) => f.posePresent).length),
    leftY: counts(usable.filter((v) => v.left).length), rightY: counts(usable.filter((v) => v.right).length),
    joints: Object.fromEntries(joints.map((j) => [j, {
      image: counts(raw.filter((r) => r.image.points[j] !== null).length),
      world: counts(raw.filter((r) => r.world.points[j] !== null).length),
    }])) };
}

function analyzeVariant(session: ReplaySession, run: Run) {
  const trial = session.liveResult.trials[0], stages = discoveryStages(session, trial).stages;
  const guidedEndMs = stages.at(-1)!.endMs;
  // UNASSIGNED is only an adapter for existing per-fixture primitives. Never assign an old capture role.
  const baseline = rebuildEstimatorBaseline(session, trial, run, 'UNASSIGNED');
  let previous: ReturnType<typeof measureReliabilityFrame> | null = null;
  const rows = run.frames.filter((f) => stageForTime(stages, f.tMs) !== null).map((frame) => {
    const raw = rawReliabilityGeometry(frame.landmarks, frame.worldLandmarks);
    const measured = measureReliabilityFrame(raw, baseline.geometry, previous, frame.tMs); previous = measured;
    return { timestamp: frame.tMs, stageIndex: stageForTime(stages, frame.tMs)!.stageIndex, calibrationOnly: false,
      posePresent: frame.posePresent, values: measured.values, flags: measured.flags,
      jointMissing: (['image', 'world'] as const).reduce((n, space) => n + joints.filter((j) => raw[space].points[j] === null).length, 0) };
  });
  const perStage = stages.map((stage) => ({ ...stage,
    coverage: coverage(run.frames.filter((f) => f.tMs >= stage.startMs && f.tMs < stage.endMs)),
    geometry: continuitySummary(rows.filter((r) => r.stageIndex === stage.stageIndex)),
  }));
  let replay = null;
  if (baseline.y) {
    const y = baseline.y;
    const rebuiltTrial = { ...trial, baselineV3: y, baseline: { leftMedian: y.leftXMedian, rightMedian: y.rightXMedian,
      leftDistanceMedian: y.leftDistanceMedian, rightDistanceMedian: y.rightDistanceMedian, bodyScale: y.bodyScale } };
    const variantSession: ReplaySession = { ...session, poseFrames: run.frames, clockSamples: [], liveResult: { ...session.liveResult, trials: [rebuiltTrial] } };
    const production = replayKneeKickV3(variantSession, trial.id);
    const reference = estimatorNeutralWindow(variantSession, rebuiltTrial, 'UNASSIGNED');
    // Extend only the diagnostic run to capture end. Recorded Guided markers still end the labelled region.
    const extended: ReplaySession = { ...variantSession, liveResult: { ...variantSession.liveResult,
      trials: [{ ...rebuiltTrial, endMs: session.timing.durationMs, endOrder: null }] } };
    const extendedProduction = replayKneeKickV3(extended, trial.id);
    const input = { filename: session.video.filename, session: extended, role: 'UNASSIGNED' as const };
    const multi = prepareMultiFixture(input, trial.id, extendedProduction, reference);
    const fixture = prepareIntegrityFixture(input, multi, true, reference);
    const fixed = runIntegrityFixture({ ...fixture, frames: fixture.frames.filter((f) => f.stageIndex !== null) }, PRE_REGISTERED_INTEGRITY_CONFIG, 'FIXED_Y_OR_FLEXION');
    const productionStages = production.stages.map((s) => ({ ...s, wrong: s.wrongDirection }));
    const fixedStages = fixed.stageOutcomes.map((s) => ({ ...s, observable: s.expectedObservable }));
    const counts = (outcomes: readonly Outcome[], safety: Safety) => ({ ...safety,
      leftCorrectEvents: outcomes.filter((s) => s.expected === 'KNEE_LEFT').reduce((n, s) => n + s.correct, 0),
      rightCorrectEvents: outcomes.filter((s) => s.expected === 'KNEE_RIGHT').reduce((n, s) => n + s.correct, 0),
      neutralFalse: outcomes.filter((s) => s.expected === 'NEUTRAL').reduce((n, s) => n + s.falseEvents, 0),
      twistFalse: outcomes.filter((s) => s.expected.startsWith('TWIST_')).reduce((n, s) => n + s.falseEvents, 0) });
    const p = production.counts;
    const pc = counts(productionStages, { falseEvents: p.falseEvents, wrong: p.wrongDirection, duplicates: p.duplicates,
      crossGap: p.crossGapConfirmations, reacquisitionFalse: p.reacquisitionFalseEvents, softGapCross: 0, softRecoveryFalse: 0 });
    const fc = counts(fixedStages, { falseEvents: fixed.falseEvents, wrong: fixed.wrong, duplicates: fixed.duplicates,
      crossGap: fixed.crossGap, reacquisitionFalse: fixed.reacquisitionFalse, softGapCross: fixed.softGapCross, softRecoveryFalse: fixed.softRecoveryFalse });
    // Continue identical detector implementations past Guided end, but never label these events false/true.
    const yDetector = new KneeKickDetectorV3(); yDetector.setBaseline(y);
    const yAfter = [];
    for (const frame of run.frames.filter((f) => f.tMs > trial.startMs)) {
      const event = yDetector.processFrame(extractKneeMotionFeatures(frame.landmarks), frame.tMs);
      if (event && event.timestamp >= guidedEndMs) yAfter.push(event);
    }
    const fixedDetector = new IntegrityShadow(PRE_REGISTERED_INTEGRITY_CONFIG, FIXED_FLEXION_CONFIG), fixedAfter = [];
    for (const frame of fixture.frames) {
      const event = fixedDetector.processFrame(frame);
      if (event && event.timestamp >= guidedEndMs) fixedAfter.push(event);
    }
    replay = {
      PRODUCTION_Y_V3: { status: assessHoldoutEvents(productionStages, pc), counts: pc, stages: productionStages,
        events: production.events, finalState: production.result.finalState, softIntegrityGuard: 'NOT_APPLICABLE' },
      FIXED_REFERENCE: { status: assessHoldoutEvents(fixedStages, fc), counts: fc, stages: fixedStages,
        events: fixed.events, finalState: fixed.finalState, guardActivationCount: fixed.guardActivationCount,
        flexionBaseline: multi.baseline, segmentBaseline: fixture.segmentBaseline },
      postGuidedDiagnostic: { fromMs: guidedEndMs, labelled: false, includedInRecallOrFalse: false,
        PRODUCTION_Y_V3: yAfter, FIXED_REFERENCE: fixedAfter },
    };
  }
  const duration = distribution(run.frames.map((f) => f.inferenceMs));
  const totalMs = run.frames.reduce((n, f) => n + f.inferenceMs, 0), meanMs = totalMs / run.frames.length;
  return { variant: run.variant, config: run.config, sequence: run.sequence, baseline,
    baselineStatus: baseline.y ? 'READY' as const : 'INSUFFICIENT_VARIANT_NEUTRAL' as const,
    eventAssessment: replay ? aggregate([replay.PRODUCTION_Y_V3.status, replay.FIXED_REFERENCE.status]) : 'INSUFFICIENT' as const,
    baselineSource: 'OWN_VARIANT_LANDMARKS_ONLY',
    neutralCoverage: coverage(run.frames.filter((f) => f.tMs >= baseline.window.startMs && f.tMs <= baseline.window.endMs)),
    coverage: coverage(run.frames), perStage, geometry: continuitySummary(rows),
    geometryAssessment: baseline.y ? 'DESCRIPTIVE_ONLY' : 'INSUFFICIENT_BASELINE_DO_NOT_TREAT_ZERO_AS_CLEAN', replay,
    performance: { totalInferenceFrames: run.frames.length, inferenceTotalMs: totalMs, meanMs, medianMs: duration.median,
      p95Ms: duration.p95, maxMs: duration.max, inferenceOnlyFps: meanMs > 0 ? 1000 / meanMs : null,
      offlineWallMs: run.offlineWallMs ?? null, scope: 'Entire video, offline only; reciprocal inference time is not measured live FPS. Wall time also includes model/network initialization, decode and cooperative yields.' } };
}

export async function createV2HoldoutReport(input: ReplaySession, runs: readonly Run[], plan: FramePlan, createdAt = new Date().toISOString()) {
  const session = readReplaySession(JSON.stringify(input));
  if (session.version !== 2 || session.validation?.protocolId !== PROTOCOL.id || session.validation.status !== 'VALIDATION_CAPTURE_COMPLETE' || session.liveResult.trials.length !== 1)
    throw new Error('INVALID_CAPTURE: one completed V2 holdout trial required.');
  const trial = session.liveResult.trials[0], definition = discoveryStages(session, trial);
  if (definition.source !== 'GUIDED_STAGE_CHANGE' || definition.stages.length !== DETECTOR_TEST_SEQUENCE.length ||
      definition.stages.some((s, i) => s.endMs - s.startMs !== DETECTOR_TEST_SEQUENCE[i].durationMs))
    throw new Error('INVALID_GUIDED_TIMELINE: complete recorded 22s sequence required.');
  if (canonical(await frameSequence(plan.timestamps)) !== canonical(plan.sequence)) throw new Error('INVALID_PTS_PLAN');
  verifyMediaSequence(session, plan.sequence);
  if (runs.length !== ESTIMATOR_VARIANTS.length || ESTIMATOR_VARIANTS.some((v) => runs.filter((r) => r.variant === v).length !== 1))
    throw new Error('Exactly the three registered variants are required.');
  for (const run of runs) {
    verifyFrameSequence(plan, run.frames.map((f) => f.tMs)); verifyMediaSequence(session, run.sequence);
    const media = run.mediaIdentity;
    if (!('sha256' in media) || media.validation !== 'CRYPTOGRAPHIC_MEDIA_MATCH' || !media.inspectionComplete || media.captureId !== session.captureId || media.sha256 !== session.video.integrity!.sha256)
      throw new Error('UNVERIFIED_VARIANT_MEDIA');
    if (!run.frameSequenceParity || canonical(run.sequence) !== canonical(plan.sequence) || canonical(run.config) !== canonical(estimatorConfig(run.variant)))
      throw new Error('VARIANT_CONFIG_OR_SEQUENCE_MISMATCH');
    if (run.frames.some((f) => !Number.isFinite(f.inferenceMs) || f.inferenceMs < 0 || f.posePresent !== (f.landmarks.length > 0)))
      throw new Error('INVALID_VARIANT_FRAME');
  }
  const variants = ESTIMATOR_VARIANTS.map((v) => analyzeVariant(session, runs.find((r) => r.variant === v)!));
  const guidedEndMs = definition.stages.at(-1)!.endMs;
  return { version: 1, step: '4Q', createdAt, captureId: session.captureId, protocol: PROTOCOL,
    scope: 'SINGLE_V2_HOLDOUT_ANALYSIS_ONLY', integrityStatus: 'PASS', sequence: plan.sequence, reference: trial.estimatorNeutralReference,
    status: aggregate(variants.map((v) => v.eventAssessment)), generalization: 'INSUFFICIENT', productionReplacement: false,
    policy: { sameCompletePts: true, sameFrozenReference: true, ownVariantBaselines: true,
      fiveRoleAcceptanceApplied: false, historicalFalseAnchorsUsed: false, liveBitIdenticalRequired: false,
      labels: 'Recorded Guided intent [start,end), not independent physical-motion annotations.',
      assessment: 'PASS/FAIL/INSUFFICIENT describes only this capture; not estimator superiority or a production gate.',
      geometry: 'Existing 4N measurements and 4O descriptive summaries; missing availability is reported, no new gate.' },
    detectorConfigs: { PRODUCTION_Y_V3: Y_KICK_V3_CONFIG, FIXED_REFERENCE: { evidence: FIXED_FLEXION_CONFIG, integrity: PRE_REGISTERED_INTEGRITY_CONFIG } },
    recordedLive: { trialId: trial.id, guidedStartMs: trial.startMs, guidedEndMs,
      events: session.liveResult.events.filter((e) => e.trialId === trial.id && e.tMs >= trial.startMs && e.tMs < guidedEndMs),
      guidedSummary: trial.result.guidedSummary,
      postGuidedDiagnostic: { events: session.liveResult.events.filter((e) => e.tMs >= guidedEndMs), includedInRecallOrFalse: false } },
    variants,
  };
}
