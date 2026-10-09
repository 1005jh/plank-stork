import { usableKneesV3 } from '../pose/kick/kneeKickDetectorV3';
import { BODY_ROLES, type BodyInput } from '../discovery/bodyLocalFeatures';
import { prepareGeometryInputs, rawReliabilityGeometry, freezeGeometryBaseline, measureReliabilityFrame, GEOMETRY_JOINTS } from '../discovery/geometryReliabilityFeatures';
import { createGeometryEvidence } from '../discovery/analyzeGeometryReliability';
import { neutralCalibrationWindow, type AnalysisNeutralWindow } from '../discovery/multiSignalFeatures';
import { distribution, prepareIntegrityFixture, type IntegrityRole } from '../discovery/integrityFeatures';
import { prepareMultiFixture } from '../discovery/analyzeMultiSignal';
import { runIntegrityFixture } from '../discovery/analyzeIntegrity';
import { PRE_REGISTERED_INTEGRITY_CONFIG } from '../discovery/integrityGuard';
import { stageForTime } from '../discovery/discoveryStages';
import { buildKneeKickBaselineV3 } from '../pose/kick/kneeKickBaselineV3';
import { extractKneeMotionFeatures } from '../pose/motion/kneeMotionFeatures';
import { replayKneeKickV3 } from '../replay/kneeKickV3Replay';
import type { ReplaySession, ReplayTrial } from '../replay/replayTypes';
import { ESTIMATOR_VARIANTS, estimatorConfig, type EstimatorVariant } from './estimatorConfig';
import type { EstimatorRun } from './estimatorInference';

export const ESTIMATOR_ROLES = BODY_ROLES;
export function estimatorAnchors(input: BodyInput) {
  if (input.role === 'UNASSIGNED') throw new Error('Assign the capture role manually.');
  return createGeometryEvidence(prepareGeometryInputs([input])).geometryReliabilityEvidence.perFixture.map((f) => ({
    trialId: f.input.trialId, anchors: f.anchorTraces.map(({ rows: _rows, ...anchor }) => anchor),
  }));
}
export type EstimatorAnchors = ReturnType<typeof estimatorAnchors>;
/** V2 uses a frozen, capture-time reference. V1 keeps its original 1s marker semantics. */
export function estimatorNeutralWindow(session: ReplaySession, trial: ReplayTrial, role: BodyInput['role']): AnalysisNeutralWindow {
  if (session.version === 1) return neutralCalibrationWindow(session, trial, role === 'REFERENCE_OLD_CLEAN' ? 'LATEST_FROZEN_OR_COMPATIBILITY' : 'LATEST_FROZEN');
  const ref = trial.estimatorNeutralReference;
  if (!ref) throw new Error('INVALID_MISSING_ESTIMATOR_REFERENCE');
  const frames = session.poseFrames.filter((f) => f.tMs >= ref.startMs && f.tMs <= ref.endMs);
  return { source: 'ESTIMATOR_NEUTRAL_REFERENCE', calibrationStartMs: ref.calibrationStartMs,
    startMs: ref.startMs, endMs: ref.endMs, frameCount: frames.length, frames, excludedStageIndex: null };
}
export function rebuildEstimatorBaseline(session: ReplaySession, trial: ReplayTrial, run: Pick<EstimatorRun, 'frames'>, role: BodyInput['role']) {
  const { frames: _original, ...window } = estimatorNeutralWindow(session, trial, role);
  if (window.source === 'FIRST_NEUTRAL_COMPATIBILITY' && role !== 'REFERENCE_OLD_CLEAN') throw new Error('Only OLD CLEAN may use first-Neutral compatibility.');
  const neutral = run.frames.filter((f) => window.source === 'ESTIMATOR_NEUTRAL_REFERENCE' ? f.tMs >= window.startMs && f.tMs <= window.endMs :
    window.source === 'FIRST_NEUTRAL_COMPATIBILITY' ? f.tMs >= window.startMs && f.tMs < window.endMs : f.tMs > window.startMs && f.tMs <= window.endMs);
  const samples = neutral.map((f) => extractKneeMotionFeatures(f.landmarks));
  const y = buildKneeKickBaselineV3(samples);
  const geometry = freezeGeometryBaseline(neutral.map((f) => rawReliabilityGeometry(f.landmarks, f.worldLandmarks)), y?.bodyScale ?? NaN);
  return { window: { ...window, frameCount: neutral.length }, y, geometry,
    ...(session.version === 2 ? { neutralFrameCount: neutral.length, leftUsableSamples: samples.filter((s) => usableKneesV3(s).left).length,
      rightUsableSamples: samples.filter((s) => usableKneesV3(s).right).length, bodyScale: y?.bodyScale ?? null,
      baselineStatus: y ? 'READY' : 'INSUFFICIENT_VARIANT_NEUTRAL' } : {}) };
}
type Row = { timestamp: number; stageIndex: number | null; calibrationOnly: boolean; posePresent: boolean;
  values: Record<string, number | null>; flags: Record<string, boolean | null>; jointMissing: number };
const legSegments = ['leftHipKnee', 'rightHipKnee', 'leftKneeAnkle', 'rightKneeAnkle'];
const known = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
export function continuitySummary(rows: readonly Row[]) {
  const count = (keys: string[], predicate: (n: number) => boolean) => rows.filter((r) => keys.some((k) => known(r.values[k]) && predicate(r.values[k]!))).length;
  const segments = (space: string) => legSegments.map((s) => `${space}.${s}Ratio`);
  const swap = ['image.swapAdvantage', 'world.swapAdvantage'];
  const axis = ['image.pelvisAxisAngularVelocity', 'image.torsoAxisAngularVelocity'];
  const keys = Object.keys(rows[0]?.values ?? {});
  return { frameCount: rows.length,
    segmentExtremeCount: count(segments('image'), (v) => Math.abs(v - 1) >= .5),
    worldSegmentExtremeCount: count(segments('world'), (v) => Math.abs(v - 1) >= .5),
    positiveSwapCount: count(swap, (v) => v > 0), largeSwapCount: count(swap, (v) => v > .1),
    poseMissingCount: rows.filter((r) => !r.posePresent).length,
    jointMissingCount: rows.filter((r) => r.jointMissing > 0).length,
    missingJointObservations: rows.reduce((n, r) => n + r.jointMissing, 0),
    largeAxisVelocityCount: count(axis, (v) => Math.abs(v) >= 720),
    // Report availability alongside counts: unknown geometry is never a measured anomaly-free zero.
    distributions: Object.fromEntries(keys.map((k) => [k, distribution(rows.map((r) => r.values[k]))])),
    peaks: Object.fromEntries(['image', 'world'].flatMap((space) => legSegments.flatMap((segment) => ['RatioDeviation', 'RatioVelocityPerSec'].map((metric) => {
      const key = `${space}.${segment}${metric}`;
      return [key, distribution(rows.map((r) => known(r.values[key]) ? Math.abs(r.values[key]!) : null)).max];
    })))),
  };
}
export function analyzeEstimator<Identity extends object>(input: BodyInput, run: Omit<EstimatorRun, 'mediaIdentity'> & { mediaIdentity: Identity }, anchors: EstimatorAnchors) {
  const trials = input.session.liveResult.trials.map((trial) => {
    const baseline = rebuildEstimatorBaseline(input.session, trial, run, input.role);
    let previous: ReturnType<typeof measureReliabilityFrame> | null = null;
    const originalGeometry = prepareGeometryInputs([input]).find((f) => f.input.trialId === trial.id)!;
    const stages = originalGeometry.stages;
    const rows: Row[] = run.frames.filter((f) => f.tMs > trial.startMs && f.tMs <= (trial.endMs ?? Infinity)).map((f) => {
      const raw = rawReliabilityGeometry(f.landmarks, f.worldLandmarks), measured = measureReliabilityFrame(raw, baseline.geometry, previous, f.tMs);
      previous = measured;
      const stageIndex = stageForTime(stages, f.tMs)?.stageIndex ?? null;
      return { timestamp: f.tMs, stageIndex, calibrationOnly: stageIndex !== null && stageIndex === baseline.window.excludedStageIndex,
        posePresent: f.posePresent, values: measured.values, flags: measured.flags,
        jointMissing: (['image', 'world'] as const).reduce((n, space) => n + Object.keys(GEOMETRY_JOINTS).filter((j) => raw[space].points[j as keyof typeof GEOMETRY_JOINTS] === null).length, 0) };
    });
    let detectorReplay = null;
    if (baseline.y) {
      const y = baseline.y;
      const rebuiltTrial = { ...trial, baselineV3: y, baseline: { leftMedian: y.leftXMedian, rightMedian: y.rightXMedian,
        leftDistanceMedian: y.leftDistanceMedian, rightDistanceMedian: y.rightDistanceMedian, bodyScale: y.bodyScale } };
      const session: ReplaySession = { ...input.session, poseFrames: run.frames, clockSamples: [],
        liveResult: { ...input.session.liveResult, trials: [rebuiltTrial] } };
      // Direct preparation deliberately bypasses recorded LIVE parity gating. Original LANDMARK paths keep their oracle.
      const production = replayKneeKickV3(session, trial.id);
      const reference = session.version === 2 ? estimatorNeutralWindow(session, rebuiltTrial, input.role) : undefined;
      const multi = prepareMultiFixture({ filename: input.filename, session, role: input.role === 'STRESS' ? 'STRESS' : 'REFERENCE_LIVE',
        calibrationSelection: input.role === 'REFERENCE_OLD_CLEAN' ? 'LATEST_FROZEN_OR_COMPATIBILITY' : 'LATEST_FROZEN' }, trial.id, production, reference);
      const fixture = prepareIntegrityFixture({ filename: input.filename, session,
        role: input.role === 'REFERENCE_LIVE_2' ? 'REFERENCE_LIVE_2_INDEPENDENT' : input.role === 'REFERENCE_LIVE_3' ? 'REFERENCE_LIVE_3_HOLDOUT' : input.role as IntegrityRole }, multi, true, reference);
      // Stored baseline bypasses compatibility exclusion in the production runner; exclude OLD's baseline frames explicitly.
      // They are Neutral only, but must not contribute event evidence or detector arming history.
      if (baseline.window.excludedStageIndex !== null) {
        const withoutCalibration = { ...session, poseFrames: run.frames.filter((f) => f.tMs < baseline.window.startMs || f.tMs >= baseline.window.endMs) };
        const corrected = replayKneeKickV3(withoutCalibration, trial.id);
        production.events = corrected.events; production.result = corrected.result; production.counts = corrected.counts;
      }
      const fixed = runIntegrityFixture(fixture, PRE_REGISTERED_INTEGRITY_CONFIG, 'FIXED_Y_OR_FLEXION');
      detectorReplay = { PRODUCTION_Y_V3: { counts: production.counts, stages: production.stages, finalState: production.result.finalState,
        events: production.events.map((e) => ({ ...e, latencyMs: e.timestamp - e.candidateStartedAt })) }, FIXED_REFERENCE: fixed,
        controlLiveParityRequired: false, calibrationSource: 'VARIANT_NEUTRAL_RECONSTRUCTION', geometryQualityGate: 'NONE' };
    }
    const windows = anchors.find((a) => a.trialId === trial.id)?.anchors ?? [];
    const anchorComparisons = windows.map((a) => { const trace = rows.filter((r) => r.timestamp >= a.startMs && r.timestamp <= a.endMs);
      return { ...a, alignment: 'Original LANDMARK time window only; new events computed independently.',
        summary: continuitySummary(trace), nearEntry: continuitySummary(trace.filter((r) => Math.abs(r.timestamp - a.candidateStart) <= 100)), trace }; });
    const evaluated = rows.filter((r) => !r.calibrationOnly && r.stageIndex !== null);
    const knownFalseRows = evaluated.filter((r) => windows.some((a) => a.kind === 'FALSE_EVENT' && r.timestamp >= a.startMs && r.timestamp <= a.endMs));
    return { trialId: trial.id, baseline, baselineStatus: baseline.y ? 'READY' : input.session.version === 2 ? 'INSUFFICIENT_VARIANT_NEUTRAL' : 'INSUFFICIENT_NEUTRAL_SAMPLES',
      geometryContinuity: continuitySummary(evaluated), knownFalseContinuity: continuitySummary(knownFalseRows), anchorComparisons, detectorReplay };
  });
  const performance = distribution(run.frames.map((f) => f.inferenceMs));
  const meanMs = run.frames.length ? run.frames.reduce((n, f) => n + f.inferenceMs, 0) / run.frames.length : null;
  return { input: { filename: input.filename, role: input.role, captureId: input.session.captureId }, variant: run.variant,
    mediaIdentity: run.mediaIdentity, sequence: run.sequence, frameSequenceParity: run.frameSequenceParity, trials,
    performance: { totalInferenceFrames: run.frames.length, medianMs: performance.median, p95Ms: performance.p95, maxMs: performance.max, meanMs,
      estimatedSustainableFps: meanMs && meanMs > 0 ? 1000 / meanMs : null, scope: 'Inference-only offline estimate, not measured live FPS.', inferenceDurationsMs: run.frames.map((f) => f.inferenceMs) } };
}
export type EstimatorAnalysis = ReturnType<typeof analyzeEstimator>;
const supportKeys = ['segmentExtremeCount', 'worldSegmentExtremeCount', 'positiveSwapCount', 'largeSwapCount', 'poseMissingCount', 'jointMissingCount'] as const;
const continuityKeys = ['segmentExtremeCount', 'worldSegmentExtremeCount', 'positiveSwapCount', 'largeSwapCount', 'poseMissingCount', 'jointMissingCount', 'largeAxisVelocityCount'] as const;
export function compareEstimators(results: readonly EstimatorAnalysis[], createdAt = new Date().toISOString()) {
  const roles = ESTIMATOR_ROLES.filter((r) => r !== 'UNASSIGNED');
  const complete = results.length === roles.length * ESTIMATOR_VARIANTS.length && ESTIMATOR_VARIANTS.every((v) => roles.every((role) => results.filter((r) => r.variant === v && r.input.role === role).length === 1));
  const frameSequenceParity = roles.map((role) => {
    const runs = results.filter((r) => r.input.role === role), first = runs[0];
    return { role, sequences: runs.map((r) => ({ variant: r.variant, ...r.sequence })), identical: runs.length === 3 &&
      runs.every((r) => r.input.captureId === first.input.captureId && JSON.stringify(r.sequence) === JSON.stringify(first.sequence) && r.frameSequenceParity) };
  });
  const usable = complete && frameSequenceParity.every((p) => p.identical) && results.every((r) => r.trials.length && r.trials.every((t) => t.detectorReplay));
  const perVariant = ESTIMATOR_VARIANTS.map((variant) => {
    const fixtures = results.filter((r) => r.variant === variant);
    const comparisons = fixtures.flatMap((f) => f.trials.map((t) => {
      const control = results.find((r) => r.variant === 'FULL_VIDEO_CONTROL' && r.input.captureId === f.input.captureId)?.trials.find((c) => c.trialId === t.trialId);
      const fixed = t.detectorReplay?.FIXED_REFERENCE;
      const stagePreserved = !!fixed && fixed.stageOutcomes.filter((s) => s.expected.startsWith('KNEE_')).every((s) => s.correct === 1 && s.eventCount === 1 && s.expectedObservable);
      const eventsPass = !!fixed && (f.input.role === 'STRESS' ? fixed.observableFalseEvents === 0 && fixed.wrong === 0 && fixed.duplicates === 0 && fixed.crossGap === 0 && fixed.reacquisitionFalse === 0 :
        fixed.left === 1 && fixed.right === 1 && fixed.falseEvents === 0 && fixed.wrong === 0 && fixed.duplicates === 0 && fixed.crossGap === 0 && fixed.reacquisitionFalse === 0 && stagePreserved);
      const known = t.knownFalseContinuity, ref = control?.knownFalseContinuity;
      const support = !!ref && known.frameCount > 0 && supportKeys.some((k) => known[k] < ref[k]);
      const noWorse = !!control && continuityKeys.every((k) => t.geometryContinuity[k] <= control.geometryContinuity[k]) &&
        known.poseMissingCount <= (ref?.poseMissingCount ?? 0) && known.jointMissingCount <= (ref?.jointMissingCount ?? 0);
      const failureWindows = t.anchorComparisons.filter((a) => a.kind === 'FALSE_EVENT').map((a) => {
        const old = control?.anchorComparisons.find((c) => c.candidateStart === a.candidateStart && c.mode === a.mode && c.side === a.side);
        const reference = old?.summary, measured = a.summary;
        const failureObserved = !!reference && supportKeys.some((k) => reference[k] > 0);
        const fewerAnomalies = !!reference && supportKeys.some((k) => measured[k] < reference[k]);
        const noIncreasedMissing = !!reference && measured.poseMissingCount <= reference.poseMissingCount && measured.jointMissingCount <= reference.jointMissingCount;
        const noIncreasedAnomalies = !!reference && continuityKeys.every((k) => measured[k] <= reference[k]);
        const unchangedCounts = !!reference && continuityKeys.every((k) => measured[k] === reference[k]);
        return { id: `${f.input.captureId}/${t.trialId}/${a.mode}/${a.side}/${a.candidateStart}`, failureObserved, fewerAnomalies, noIncreasedMissing, noIncreasedAnomalies, unchangedCounts,
          candidateStart: a.candidateStart, mode: a.mode, side: a.side };
      });
      return { role: f.input.role, trialId: t.trialId, failureWindows, eventsPass, stagePreserved, geometrySupport: support, continuityNoWorse: noWorse,
        controlFailureObserved: !!ref && continuityKeys.some((k) => ref[k] > 0) };
    }));
    const eventPass = comparisons.length > 0 && comparisons.every((c) => c.eventsPass), support = comparisons.some((c) => c.geometrySupport);
    const noWorse = comparisons.every((c) => c.continuityNoWorse);
    const assessment = variant === 'FULL_VIDEO_CONTROL' ? 'CONTROL' : !usable ? 'INSUFFICIENT_EVIDENCE' :
      !eventPass || !noWorse ? 'REJECTED' : support ? 'EXPLORATORY_ESTIMATOR_CANDIDATE' : 'EVENT_ONLY_IMPROVEMENT';
    const durations = fixtures.flatMap((f) => f.performance.inferenceDurationsMs), perf = distribution(durations);
    const meanMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
    return { variant, assessment, comparisons, eventPass, geometrySupport: support, continuityNoWorse: noWorse,
      performance: { totalInferenceFrames: durations.length, medianMs: perf.median, p95Ms: perf.p95, maxMs: perf.max, meanMs, estimatedSustainableFps: meanMs && meanMs > 0 ? 1000 / meanMs : null } }; 
  });
  const failures = (v: EstimatorVariant) => perVariant.find((p) => p.variant === v)!.comparisons.flatMap((c) => c.failureWindows);
  const improved = (v: EstimatorVariant) => failures(v).filter((f) => f.failureObserved && f.fewerAnomalies && f.noIncreasedMissing && f.noIncreasedAnomalies).map((f) => f.id).sort();
  const image = improved('FULL_IMAGE'), heavy = improved('HEAVY_VIDEO');
  const reproduced = failures('FULL_VIDEO_CONTROL').some((f) => f.failureObserved);
  const similar = (v: EstimatorVariant) => failures(v).filter((f) => f.failureObserved).every((f) => f.unchangedCounts);
  // Exact count similarity is intentionally conservative; mixed/worse changes cannot establish one-factor sensitivity.
  const attribution = !usable || !reproduced ? 'INSUFFICIENT_EVIDENCE' : image.length && heavy.length ?
    JSON.stringify(image) === JSON.stringify(heavy) ? 'BOTH_TRACKING_AND_MODEL_SENSITIVE' : 'MIXED' :
    image.length ? similar('HEAVY_VIDEO') ? 'TRACKING_SENSITIVE' : 'MIXED' :
    heavy.length ? similar('FULL_IMAGE') ? 'MODEL_CAPACITY_SENSITIVE' : 'MIXED' :
    similar('FULL_IMAGE') && similar('HEAVY_VIDEO') ? 'ESTIMATOR_VARIANTS_NOT_SUFFICIENT' : 'INSUFFICIENT_EVIDENCE';
  return { version: 1, step: '4O', createdAt, analysisStatus: 'POST_FAILURE_EXPLORATORY',
    estimatorContinuityEvidence: { complete, usable, policy: 'Conservative descriptive assessment; event/stage preservation plus known-false improvement and no increase in global anomaly/missing counts. No BEST or causal proof.',
      counts: 'Per frame, any eligible image/world leg segment; swaps are image OR world; joints include eight 4N joints in each space. Availability distributions accompany all counts.',
      determinism: { sequence: 'exact timestamp equality; SHA-256 JSON number sequence', gpuPose: 'Not bit-exact; repeated runs report coordinate deltas, availability and events separately. No tolerance used to hide changed events.', eventToleranceMs: 1e-6, geometryAbsoluteDiagnosticTolerance: 1e-5 },
      controls: 'Same model/config except mode or capacity; no identity gate, no dropped decoded frames, recorded marker times only.' },
    mediaIdentity: results.map((r) => r.mediaIdentity), variantConfigs: ESTIMATOR_VARIANTS.map(estimatorConfig), frameSequenceParity, perVariant,
    perFixture: results.map((r) => ({ ...r, trials: r.trials.map(({ anchorComparisons: _anchors, ...t }) => t) })), anchorComparisons: results.map((r) => ({ input: r.input, variant: r.variant, trials: r.trials.map((t) => ({ trialId: t.trialId, anchors: t.anchorComparisons })) })),
    geometryContinuity: results.map((r) => ({ input: r.input, variant: r.variant, trials: r.trials.map((t) => t.geometryContinuity) })),
    detectorReplay: results.map((r) => ({ input: r.input, variant: r.variant, trials: r.trials.map((t) => t.detectorReplay) })),
    performance: results.map((r) => ({ input: r.input, variant: r.variant, ...r.performance })), attribution,
    attributionCaveat: 'Pattern evidence only; absence of improvement does not establish camera causation or a monocular limit.' };
}
