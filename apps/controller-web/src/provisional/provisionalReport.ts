import type { BodyInput } from '../discovery/bodyLocalFeatures';
import { distribution } from '../discovery/integrityFeatures';
import { PRE_REGISTERED_INTEGRITY_CONFIG, FIXED_FLEXION_CONFIG } from '../discovery/integrityGuard';
import { Y_KICK_V3_CONFIG } from '../pose/kick/kneeKickDetectorV3';
import { analyzeEstimator, estimatorAnchors, type EstimatorAnalysis } from '../estimator/estimatorAnalysis';
import { assertProvisionalPair, canonical, PAIRING_LIMITATION, PROVISIONAL_PAIRS, PROVISIONAL_PROVENANCE, PROVISIONAL_VARIANTS, provisionalConfig, SENSITIVITY_POLICY } from './provisionalContract';
import type { ProvisionalRun } from './provisionalInference';

const MODES = ['PRODUCTION_Y_V3', 'FIXED_REFERENCE'] as const;
const anomalyKeys = ['segmentExtremeCount', 'worldSegmentExtremeCount', 'positiveSwapCount', 'largeSwapCount', 'poseMissingCount', 'jointMissingCount'] as const;
const eventKeys = ['falseEvents', 'wrong', 'duplicates', 'crossGap', 'reacquisitionFalse'] as const;
type Continuity = EstimatorAnalysis['trials'][number]['knownFalseContinuity'];
function geometryView(summary: Continuity) {
  return { ...summary, maxSwapAdvantage: { image: summary.distributions['image.swapAdvantage']?.max ?? null, world: summary.distributions['world.swapAdvantage']?.max ?? null } };
}
export function analyzeProvisionalRun(input: BodyInput, run: ProvisionalRun) {
  assertProvisionalPair(run.mediaIdentity);
  if (input.session.captureId !== run.mediaIdentity.captureId || input.role !== run.mediaIdentity.role ||
      Object.entries(PROVISIONAL_PROVENANCE).some(([k, v]) => (run as unknown as Record<string, unknown>)[k] !== v)) throw new Error('Provisional analysis provenance/input mismatch.');
  const result = analyzeEstimator(input, run, estimatorAnchors(input));
  const trials = result.trials.map((trial) => {
    const replay = trial.detectorReplay, y = replay?.PRODUCTION_Y_V3, f = replay?.FIXED_REFERENCE;
    const detectors = {
      PRODUCTION_Y_V3: y ? { left: y.counts.leftDetected, right: y.counts.rightDetected, falseEvents: y.counts.falseEvents, wrong: y.counts.wrongDirection,
        duplicates: y.counts.duplicates, crossGap: y.counts.crossGapConfirmations, reacquisitionFalse: y.counts.reacquisitionFalseEvents,
        stages: y.stages.map((s) => ({ stageIndex: s.stageIndex, expected: s.expected, correct: s.correct, observable: s.observable, falseEvents: s.falseEvents })),
        events: y.events.map((e) => ({ timestamp: e.timestamp, entryStartMs: e.candidateStartedAt, direction: e.direction, expected: e.expected, stageIndex: e.stageIndex, falseEvent: e.falseEvent, wrong: e.wrongDirection })) } : null,
      FIXED_REFERENCE: f ? { left: f.left, right: f.right, falseEvents: f.falseEvents, wrong: f.wrong, duplicates: f.duplicates,
        crossGap: f.crossGap, reacquisitionFalse: f.reacquisitionFalse, softGapCross: f.softGapCross, softRecoveryFalse: f.softRecoveryFalse,
        stages: f.stageOutcomes.map((s) => ({ stageIndex: s.stageIndex, expected: s.expected, correct: s.correct, observable: s.expectedObservable, falseEvents: s.falseEvents })),
        events: f.events.map((e) => ({ timestamp: e.timestamp, entryStartMs: e.candidateStartedAt, direction: e.direction, expected: e.expected, stageIndex: e.stageIndex, falseEvent: e.falseEvent, wrong: e.wrong })) } : null,
    };
    return { ...PROVISIONAL_PROVENANCE, trialId: trial.trialId, baseline: trial.baseline, baselineStatus: trial.baselineStatus, detectors,
      geometry: geometryView(trial.geometryContinuity), knownFalseGeometry: geometryView(trial.knownFalseContinuity),
      anchors: trial.anchorComparisons.map((a) => ({ kind: a.kind, expected: a.expected, sourceDetector: a.mode, side: a.side,
        entryStartMs: a.candidateStart, startMs: a.startMs, endMs: a.endMs, summary: geometryView(a.summary), nearEntry: geometryView(a.nearEntry), trace: a.trace })) };
  });
  return { ...PROVISIONAL_PROVENANCE, input: result.input, mediaIdentity: run.mediaIdentity, variant: run.variant, config: run.config,
    sequence: run.sequence, frameSequenceParity: run.frameSequenceParity, cacheReuse: run.cacheReuse, trials, performance: result.performance, limitation: PAIRING_LIMITATION };
}
export type ProvisionalAnalysis = ReturnType<typeof analyzeProvisionalRun>;
const watched = ['REFERENCE_LIVE_2', 'REFERENCE_LIVE_3'];
function compareGeometry(current: Continuity, control: Continuity) {
  const measuredKeys = ['image', 'world'].flatMap((space) => ['leftHipKnee', 'rightHipKnee', 'leftKneeAnkle', 'rightKneeAnkle'].map((s) => `${space}.${s}Ratio`).concat(`${space}.swapAdvantage`));
  const availabilityPreserved = measuredKeys.every((k) => (current.distributions[k]?.usable ?? 0) >= (control.distributions[k]?.usable ?? 0));
  const improved = anomalyKeys.filter((k) => current[k] < control[k]), worsened = anomalyKeys.filter((k) => current[k] > control[k]);
  return { improved, worsened, availabilityPreserved, enoughWindow: current.frameCount > 0 && control.frameCount > 0,
    better: current.frameCount > 0 && control.frameCount > 0 && availabilityPreserved && improved.length >= 2 && worsened.length === 0,
    same: anomalyKeys.every((k) => current[k] === control[k]) && availabilityPreserved };
}
export interface VariantEvidence { available: boolean; material: boolean; adverseEvents: boolean; same: boolean; worse: boolean }
export function sensitivityClass(image: VariantEvidence, heavy: VariantEvidence) {
  if (!image.available || !heavy.available) return 'INSUFFICIENT';
  const a = image.material && !image.adverseEvents, b = heavy.material && !heavy.adverseEvents;
  if (a && b) return 'BOTH_BETTER';
  if (a && !heavy.adverseEvents) return 'FULL_IMAGE_BETTER';
  if (b && !image.adverseEvents) return 'HEAVY_VIDEO_BETTER';
  if (image.same && heavy.same) return 'NO_MATERIAL_DIFFERENCE';
  if (image.worse && heavy.worse) return 'WORSE';
  return 'MIXED';
}
export function createProvisionalReport(analyses: readonly ProvisionalAnalysis[], createdAt: string) {
  for (const a of analyses) { assertProvisionalPair(a.mediaIdentity); if (a.input.captureId !== a.mediaIdentity.captureId || a.input.role !== a.mediaIdentity.role ||
    Object.entries(PROVISIONAL_PROVENANCE).some(([k, v]) => (a as unknown as Record<string, unknown>)[k] !== v)) throw new Error('Missing provisional report provenance.'); }
  const keys = analyses.map((a) => `${a.input.role}/${a.variant}`);
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate provisional result.');
  const frameParity = PROVISIONAL_PAIRS.map((pair) => {
    const runs = PROVISIONAL_VARIANTS.map((v) => analyses.find((a) => a.input.role === pair.role && a.variant === v));
    const complete = runs.every((r) => !!r);
    const identical = complete && runs.every((r) => r!.frameSequenceParity && canonical(r!.sequence) === canonical(runs[0]!.sequence));
    if (complete && !identical) throw new Error('INVALID_FRAME_SEQUENCE: variants differ; comparison refused.');
    return { role: pair.role, captureId: pair.captureId, identical, sequences: runs.filter((r) => !!r).map((r) => ({ variant: r!.variant, ...r!.sequence })) };
  });
  const complete = analyses.length === 15 && frameParity.every((p) => p.identical);
  const available = complete && analyses.every((a) => a.trials.length && a.trials.every((t) => t.detectors.PRODUCTION_Y_V3 && t.detectors.FIXED_REFERENCE));
  const detectorMatrix = analyses.flatMap((a) => a.trials.flatMap((t) => MODES.map((mode) => ({ ...PROVISIONAL_PROVENANCE,
    role: a.input.role, variant: a.variant, trialId: t.trialId, mode, result: t.detectors[mode] }))));
  const comparisons = (['FULL_IMAGE', 'HEAVY_VIDEO'] as const).map((variant) => {
    const geometry = analyses.filter((a) => a.variant === variant).flatMap((a) => a.trials.map((t) => {
      const c = analyses.find((b) => b.input.role === a.input.role && b.variant === 'FULL_VIDEO_CONTROL')?.trials.find((b) => b.trialId === t.trialId);
      return { role: a.input.role, trialId: t.trialId, comparison: c ? compareGeometry(t.knownFalseGeometry, c.knownFalseGeometry) : null };
    }));
    const geometryBetter = watched.every((role) => geometry.some((g) => g.role === role) && geometry.filter((g) => g.role === role).every((g) => g.comparison?.better));
    const geometrySame = geometry.length === 5 && geometry.every((g) => g.comparison?.same);
    const modes = MODES.map((mode) => {
      const perPair = detectorMatrix.filter((m) => m.variant === variant && m.mode === mode).map((m) => {
        const c = detectorMatrix.find((n) => n.role === m.role && n.trialId === m.trialId && n.variant === 'FULL_VIDEO_CONTROL' && n.mode === mode)?.result, v = m.result;
        if (!c || !v) return { role: m.role, trialId: m.trialId, available: false, recallPreserved: false, noEventIncrease: false, falseReduced: false, same: false };
        const recallPreserved = m.role === 'STRESS' || c.stages.filter((s) => s.expected.startsWith('KNEE_') && s.correct > 0)
          .every((s) => v.stages.some((n) => n.stageIndex === s.stageIndex && n.expected === s.expected && n.correct > 0));
        const noEventIncrease = eventKeys.every((k) => v[k] <= c[k]);
        const same = eventKeys.every((k) => v[k] === c[k]) && v.left === c.left && v.right === c.right && canonical(v.stages.map(({ observable: _o, ...s }) => s)) === canonical(c.stages.map(({ observable: _o, ...s }) => s));
        return { role: m.role, trialId: m.trialId, available: true, recallPreserved, noEventIncrease, falseReduced: v.falseEvents < c.falseEvents, same };
      });
      const recallPreserved = perPair.length === 5 && perPair.every((p) => p.available && p.recallPreserved);
      const noEventIncrease = perPair.length === 5 && perPair.every((p) => p.available && p.noEventIncrease);
      const falseReducedBoth = watched.every((role) => perPair.some((p) => p.role === role) && perPair.filter((p) => p.role === role).every((p) => p.falseReduced));
      const eventBetter = recallPreserved && noEventIncrease && falseReducedBoth;
      const difference = eventBetter && geometryBetter ? 'MATERIAL_EVENT_AND_GEOMETRY_IMPROVEMENT' : eventBetter ? 'EVENT_ONLY_DIFFERENCE' : geometryBetter ? 'GEOMETRY_ONLY_DIFFERENCE' : 'NO_MATERIAL_DIFFERENCE';
      return { mode, perPair, recallPreserved, noEventIncrease, falseReducedBoth, eventBetter, difference };
    });
    const adverseEvents = modes.some((m) => !m.recallPreserved || !m.noEventIncrease), material = modes.some((m) => m.eventBetter) && geometryBetter;
    const same = modes.every((m) => m.perPair.length === 5 && m.perPair.every((p) => p.same)) && geometrySame;
    const worse = adverseEvents && !modes.some((m) => m.eventBetter) && !geometryBetter;
    return { ...PROVISIONAL_PROVENANCE, variant, geometry, geometryBetter, modes, available, material, adverseEvents, same, worse,
      nextValidation: available && material && !adverseEvents ? 'NEXT_VALIDATION_WORTHY' : 'NO_CLEAR_VALIDATION_TRIGGER' };
  });
  const classification = sensitivityClass(comparisons[0], comparisons[1]);
  const performance = PROVISIONAL_VARIANTS.map((variant) => {
    const ms = analyses.filter((a) => a.variant === variant).flatMap((a) => a.performance.inferenceDurationsMs), d = distribution(ms);
    const mean = ms.length ? ms.reduce((n, x) => n + x, 0) / ms.length : null;
    return { variant, frames: ms.length, medianMs: d.median, p95Ms: d.p95, maxMs: d.max, estimatedSustainableFps: mean && mean > 0 ? 1000 / mean : null,
      diagnosticOnly: true, reusedControlHasDifferentHostLoad: variant === 'FULL_VIDEO_CONTROL' && analyses.some((a) => a.variant === variant && a.cacheReuse.reused) };
  });
  return { version: 1, step: '4O.3', createdAt, ...PROVISIONAL_PROVENANCE, limitation: PAIRING_LIMITATION, policy: SENSITIVITY_POLICY,
    complete, available, frameParity, detectorConfigs: { PRODUCTION_Y_V3: Y_KICK_V3_CONFIG, FIXED_REFERENCE: { evidence: FIXED_FLEXION_CONFIG, integrity: PRE_REGISTERED_INTEGRITY_CONFIG } },
    variantConfigs: PROVISIONAL_VARIANTS.map(provisionalConfig), detectorMatrix, comparisons, classification, performance,
    focused: detectorMatrix.filter((m) => ['REFERENCE_LIVE_1', ...watched].includes(m.role)),
    nextValidationWorthy: comparisons.some((c) => c.nextValidation === 'NEXT_VALIDATION_WORTHY'),
    nextStep: classification === 'NO_MATERIAL_DIFFERENCE' ? 'ESTIMATOR_VARIANTS_NOT_SUFFICIENT' : comparisons.some((c) => c.nextValidation === 'NEXT_VALIDATION_WORTHY') ? 'NEW_CAPTURE_VALIDATION_REQUIRED' : 'REASSESS_VIEWPOINT_OCCLUSION_OBSERVABILITY_AND_SENSING',
    unmatchedMedia: { filename: '2차검증1.webm', status: 'UNMATCHED_MEDIA' }, analyses };
}
