import { runIntegrityFixture } from './analyzeIntegrity';
import { NO_INTEGRITY_GUARD, PRE_REGISTERED_INTEGRITY_CONFIG, FIXED_FLEXION_CONFIG } from './integrityGuard';
import { distribution } from './integrityFeatures';
import { stageForTime } from './discoveryStages';
import { LIMBS, type Limb } from './discoveryFeatures';
import { candidateRelative, TWIST_ANALYSIS_STATUS, TWIST_FEATURE_SETTINGS, type TwistFixture, type TwistFrame, type TwistNumericFeature } from './twistConfusionFeatures';
import { CALIBRATION_FEATURES } from '../pose/features/poseFeatureTypes';
import { TwistEntryGuard, twistGuardId, TWIST_SWEEP, type TwistGuardConfig } from './twistEntryGuard';

export const TWIST_NUMERIC_FEATURES: readonly TwistNumericFeature[] = [
  ...CALIBRATION_FEATURES.map((f) => f.delta), 'normalizedHipCenterX', 'normalizedHipCenterY', 'normalizedHipDepthDifference',
  'absNormalizedHipDepthDifference', 'hipMotionScore', 'hipWidth', 'hipWidthRatio', 'pelvisAxisDeg', 'pelvisAxisDeltaDeg',
  'leftSignedY', 'rightSignedY', 'leftY', 'rightY', 'yMax', 'yMin', 'yDominanceAbs', 'ySymmetryRatio',
  'leftFlexion', 'rightFlexion', 'flexMax', 'flexMin', 'flexDominanceAbs', 'flexSymmetryRatio',
];
function distributions(frames: readonly TwistFrame[]) {
  return Object.fromEntries(TWIST_NUMERIC_FEATURES.map((feature) => [feature, distribution(frames.map((f) => f.twist[feature]))])) as Record<TwistNumericFeature, ReturnType<typeof distribution>>;
}
const TRACE_RADIUS_MS = 750;
const TEMPORAL_PROXIES = ['absNormalizedHipDepthDifference', 'hipMotionScore', 'ySymmetryRatio', 'flexSymmetryRatio'] as const;
export function temporalRelation(rows: readonly TwistFrame[], feature: TwistNumericFeature, candidateStart: number, kickConfirm: number | null) {
  const available = rows.filter((r) => r.twist[feature] !== null);
  const peak = available.reduce<TwistFrame | null>((best, r) => best === null || r.twist[feature]! > best.twist[feature]! ? r : best, null);
  const at = (t: number | null) => t === null ? null : rows.find((r) => r.timestamp === t)?.twist[feature] ?? null;
  return { feature, candidateStart, kickConfirm, twistFeaturePeakAt: peak?.timestamp ?? null,
    twistFeaturePeak: peak?.twist[feature] ?? null, twistFeatureAtCandidateStart: at(candidateStart), twistFeatureAtConfirm: at(kickConfirm),
    peakOffsetFromCandidateMs: peak === null ? null : peak.timestamp - candidateStart,
    peakRelation: !peak ? 'UNAVAILABLE' : peak.timestamp < candidateStart ? 'BEFORE_ENTRY' : peak.timestamp === candidateStart ? 'AT_ENTRY' :
      kickConfirm === null ? 'AFTER_ANCHOR' : peak.timestamp <= kickConfirm ? 'ENTRY_TO_CONFIRM' : 'AFTER_CONFIRM',
    peakAtWindowEdge: peak !== null && (peak === rows[0] || peak === rows.at(-1)),
    beforeEntry: distribution(available.filter((r) => r.timestamp < candidateStart).map((r) => r.twist[feature])),
    entryToConfirm: distribution(available.filter((r) => r.timestamp >= candidateStart && kickConfirm !== null && r.timestamp <= kickConfirm).map((r) => r.twist[feature])),
    afterConfirm: distribution(available.filter((r) => kickConfirm !== null && r.timestamp > kickConfirm).map((r) => r.twist[feature])) };
}
type MatrixResult = ReturnType<typeof runIntegrityFixture>;
interface Anchor { kind: 'FALSE_EVENT' | 'TRUE_EVENT' | 'WRONG_EVENT' | 'EXPECTED_STAGE_PEAK' | 'STRESS_TWIST_PEAK' | 'INTEGRITY_ENTRY';
  mode: string; side: Limb; stageIndex: number; candidateStart: number; kickConfirm: number | null; triggerSource: string | null }

export function createTwistConfusionEvidence(fixtures: readonly TwistFixture[]) {
  const references = fixtures.map((f) => ({ input: f.input, yOnly: runIntegrityFixture(f, NO_INTEGRITY_GUARD, 'Y_ONLY'),
    yIntegrity12: runIntegrityFixture(f, PRE_REGISTERED_INTEGRITY_CONFIG, 'Y_ONLY'),
    fixedFlexionIntegrity12: runIntegrityFixture(f, PRE_REGISTERED_INTEGRITY_CONFIG, 'FIXED_Y_OR_FLEXION') }));
  const perFixture = fixtures.map((f, i) => {
    const ref = references[i], production = f.production.result;
    if (ref.yOnly.finalState !== production.finalState || ref.yOnly.events.length !== production.events.length ||
      ref.yOnly.events.some((e, j) => e.direction !== production.events[j].direction || Math.abs(e.timestamp - production.events[j].tMs) > .000001))
      throw new Error(`STEP4L Y_ONLY differs from production: ${f.input.filename}`);
    const evaluated = f.frames.filter((r) => !r.calibrationOnly && r.stageIndex !== null);
    const perStage = f.stages.map((stage) => ({ ...stage,
      calibrationOnly: f.twistBaseline.excludedStageIndex === stage.stageIndex,
      features: distributions(evaluated.filter((r) => r.stageIndex === stage.stageIndex)) }));
    const labels = ['NEUTRAL', 'TWIST_LEFT', 'TWIST_RIGHT', 'KNEE_LEFT', 'KNEE_RIGHT', 'TWIST', 'KNEE'] as const;
    const perLabel = labels.map((label) => ({ label, features: distributions(evaluated.filter((r) => {
      const expected = stageForTime(f.stages, r.timestamp)!.expected;
      return label === 'TWIST' || label === 'KNEE' ? expected.startsWith(`${label}_`) : expected === label;
    })) }));
    const anchors: Anchor[] = [];
    const events = (mode: string, result: MatrixResult) => result.events.forEach((e) => anchors.push({
      kind: e.falseEvent ? 'FALSE_EVENT' : e.wrong ? 'WRONG_EVENT' : 'TRUE_EVENT', mode, side: e.side, stageIndex: e.stageIndex,
      candidateStart: e.candidateStartedAt, kickConfirm: e.timestamp, triggerSource: e.triggerSource }));
    events('Y_ONLY', ref.yOnly); events('FIXED_Y_OR_FLEXION_INTEGRITY12', ref.fixedFlexionIntegrity12);
    for (const stage of f.stages) {
      const kick = stage.expected.startsWith('KNEE_'), stressTwist = f.input.role === 'STRESS' && stage.expected.startsWith('TWIST_');
      if (!kick && !stressTwist) continue;
      for (const side of LIMBS) {
        if (kick && (stage.expected !== `KNEE_${side}` || ref.yOnly.events.some((e) => e.stageIndex === stage.stageIndex && e.direction === stage.expected))) continue;
        const rows = evaluated.filter((r) => r.stageIndex === stage.stageIndex);
        const strength = (r: TwistFrame) => Math.max(r[side].Y === null ? -Infinity : r[side].Y / .4, r[side].FLEXION === null ? -Infinity : r[side].FLEXION / 15);
        const peak = rows.filter((r) => Number.isFinite(strength(r))).reduce<TwistFrame | null>((best, r) => best === null || strength(r) > strength(best) ? r : best, null);
        if (peak) anchors.push({ kind: kick ? 'EXPECTED_STAGE_PEAK' : 'STRESS_TWIST_PEAK', mode: 'DIAGNOSTIC_PEAK_NOT_EVENT', side,
          stageIndex: stage.stageIndex, candidateStart: peak.timestamp, kickConfirm: null, triggerSource: null });
      }
    }
    // Also retain rejected corruption entry windows even when no kick was emitted.
    if (f.input.role === 'STRESS' || f.input.role === 'REFERENCE_LIVE_2_INDEPENDENT')
      for (const e of ref.fixedFlexionIntegrity12.softEpisodes) if (e.stageIndex !== null) anchors.push({
        kind: 'INTEGRITY_ENTRY', mode: 'FIXED_Y_OR_FLEXION_INTEGRITY12', side: e.side, stageIndex: e.stageIndex,
        candidateStart: e.startedAt, kickConfirm: null, triggerSource: null });
    const eventTraces = anchors.map((a) => {
      const rows = f.frames.filter((r) => r.timestamp >= a.candidateStart - TRACE_RADIUS_MS && r.timestamp <= a.candidateStart + TRACE_RADIUS_MS);
      const relative = rows.filter((r) => !r.calibrationOnly && r.stageIndex !== null).map((r) => candidateRelative(r.twist, a.side));
      const relativeKeys: (keyof ReturnType<typeof candidateRelative>)[] = ['candidateY', 'opponentY', 'candidateMinusOpponentY', 'candidateToOpponentYRatio',
        'candidateFlexion', 'opponentFlexion', 'candidateMinusOpponentFlexion', 'candidateToOpponentFlexionRatio'];
      return { ...a, expected: f.stages.find((s) => s.stageIndex === a.stageIndex)!.expected,
        anchorMeaning: a.kind.includes('PEAK') ? 'stage peak only; no observed candidate or confirmation' : 'observed candidate entry',
        startMs: a.candidateStart - TRACE_RADIUS_MS, endMs: a.candidateStart + TRACE_RADIUS_MS,
        temporalPeaks: TEMPORAL_PROXIES.map((feature) => temporalRelation(rows, feature, a.candidateStart, a.kickConfirm)),
        distributions: distributions(rows.filter((r) => !r.calibrationOnly && r.stageIndex !== null)),
        candidateDistributions: Object.fromEntries(relativeKeys.map((key) => [key, distribution(relative.map((r) => r[key]))])),
        rows: rows.map((r) => ({ timestamp: r.timestamp, relativeToCandidateStartMs: r.timestamp - a.candidateStart,
          fixture: f.input.captureId, role: f.input.role, stageIndex: r.stageIndex, expected: stageForTime(f.stages, r.timestamp)?.expected ?? null,
          calibrationOnly: r.calibrationOnly, candidateSide: a.side, ...r.twist, ...candidateRelative(r.twist, a.side),
          leftHipVisibility: r.measurements.LEFT.visibility.hip, rightHipVisibility: r.measurements.RIGHT.visibility.hip,
          leftKneeVisibility: r.measurements.LEFT.visibility.knee, rightKneeVisibility: r.measurements.RIGHT.visibility.knee,
          leftAnkleVisibility: r.measurements.LEFT.visibility.ankle, rightAnkleVisibility: r.measurements.RIGHT.visibility.ankle,
          leftTrackingState: r.measurements.LEFT.trackingState, rightTrackingState: r.measurements.RIGHT.trackingState,
          leftYVelocity: r.measurements.LEFT.deltaDyNormVelocity, rightYVelocity: r.measurements.RIGHT.deltaDyNormVelocity,
          integrityVelocityThreshold: 12,
          yGuardActivationLeft: ref.yIntegrity12.softEpisodes.some((e) => e.side === 'LEFT' && e.startedAt === r.timestamp),
          yGuardActivationRight: ref.yIntegrity12.softEpisodes.some((e) => e.side === 'RIGHT' && e.startedAt === r.timestamp),
          fixedGuardActivationLeft: ref.fixedFlexionIntegrity12.softEpisodes.some((e) => e.side === 'LEFT' && e.startedAt === r.timestamp),
          fixedGuardActivationRight: ref.fixedFlexionIntegrity12.softEpisodes.some((e) => e.side === 'RIGHT' && e.startedAt === r.timestamp),
        })) };
    });
    // Union overlapping windows to avoid counting the same frame repeatedly.
    const eventWindowComparisons = (['FALSE_TWIST', 'TRUE_KNEE'] as const).map((kind) => {
      const selected = eventTraces.filter((t) => kind === 'FALSE_TWIST' ? t.kind === 'FALSE_EVENT' && t.expected.startsWith('TWIST_') : t.kind === 'TRUE_EVENT');
      return { kind, windowCount: selected.length, features: distributions(evaluated.filter((r) => selected.some((t) => r.timestamp >= t.startMs && r.timestamp <= t.endMs))) };
    });
    return { input: f.input, analysisStatus: TWIST_ANALYSIS_STATUS, liveReplayParity: f.liveReplayParity, baseline: f.twistBaseline,
      perStage, perLabel, eventWindowComparisons, eventTraces };
  });
  return { version: 1, step: '4L', analysisStatus: TWIST_ANALYSIS_STATUS,
    warning: 'LIVE3 has been used after failure for discovery; it is not an independent holdout for these rules. No production-ready claim or automatic BEST.',
    settings: { features: TWIST_FEATURE_SETTINGS, integrity: PRE_REGISTERED_INTEGRITY_CONFIG, fixedFlexion: FIXED_FLEXION_CONFIG,
      traceRadiusMs: TRACE_RADIUS_MS, peaks: 'diagnostic ±750ms observed maximum (earliest tie), never input to a guard; a peak does not prove rise onset or causation' },
    inputs: fixtures.map((f) => f.input), twistConfusionEvidence: { perFixture }, references };
}
export type TwistEvidence = ReturnType<typeof createTwistConfusionEvidence>;

export function analyzeTwistStrategy(fixtures: readonly TwistFixture[], evidence: TwistEvidence, config: TwistGuardConfig) {
  if (fixtures.length !== evidence.references.length || fixtures.some((f, i) =>
    f.input.captureId !== evidence.inputs[i].captureId || f.input.trialId !== evidence.inputs[i].trialId || f.input.role !== evidence.inputs[i].role))
    throw new Error('STEP4L evidence must be measured from the same assigned fixtures before a strategy is run.');
  const completeRoles = ['REFERENCE_OLD_CLEAN', 'STRESS', 'REFERENCE_LIVE_1', 'REFERENCE_LIVE_2_INDEPENDENT', 'REFERENCE_LIVE_3_HOLDOUT_FAILURE']
    .every((role) => fixtures.some((f) => f.input.role === role)) && fixtures.every((f) => f.input.role !== 'UNASSIGNED');
  const perFixture = fixtures.map((f, i) => {
    const guard = new TwistEntryGuard(config), reference = evidence.references[i].fixedFlexionIntegrity12;
    const result = runIntegrityFixture(f, PRE_REGISTERED_INTEGRITY_CONFIG, 'FIXED_Y_OR_FLEXION', false, guard.evaluate);
    const stages = result.stageOutcomes.map((s) => {
      const before = reference.stageOutcomes.find((r) => r.stageIndex === s.stageIndex)!;
      return { stageIndex: s.stageIndex, expected: s.expected, observable: s.expectedObservable,
        falseRemoved: Math.max(0, before.falseEvents - s.falseEvents), falseAdded: Math.max(0, s.falseEvents - before.falseEvents),
        trueEventsPreserved: Math.min(before.correct, s.correct), trueEventsLost: Math.max(0, before.correct - s.correct),
        duplicateAdded: Math.max(0, s.duplicates - before.duplicates) };
    });
    const sum = (key: 'falseRemoved' | 'falseAdded' | 'trueEventsPreserved' | 'trueEventsLost' | 'duplicateAdded') => stages.reduce((n, s) => n + s[key], 0);
    const activations = guard.observations.filter((o) => o.activation).map((o) => ({ ...o, expected: stageForTime(f.stages, o.timestamp)?.expected ?? null }));
    const checks = {
      trueRecallPreserved: sum('trueEventsLost') === 0, noAddedFalse: sum('falseAdded') === 0,
      noWrong: result.wrong === 0, noAddedDuplicates: sum('duplicateAdded') === 0,
      noHardGap: result.crossGap === 0, noSoftGap: result.softGapCross === 0,
      noAddedReacquisitionFalse: result.reacquisitionFalse <= reference.reacquisitionFalse && result.softRecoveryFalse <= reference.softRecoveryFalse,
      cleanTrueBoth: f.input.role !== 'REFERENCE_OLD_CLEAN' || result.left === 1 && result.right === 1,
      failureResolved: f.input.role !== 'REFERENCE_LIVE_3_HOLDOUT_FAILURE' || result.stageOutcomes.some((s) => s.expected === 'TWIST_LEFT' && s.frameCount > 0) &&
        result.stageOutcomes.filter((s) => s.expected === 'TWIST_LEFT').every((s) => s.falseEvents === 0) && result.left === 1 && result.right === 1,
    };
    return { input: f.input, result, referenceCounts: { left: reference.left, right: reference.right, falseEvents: reference.falseEvents },
      falseRemoved: sum('falseRemoved'), falseAdded: sum('falseAdded'), trueEventsPreserved: sum('trueEventsPreserved'), trueEventsLost: sum('trueEventsLost'),
      wrong: result.wrong, duplicates: result.duplicates, duplicateAdded: sum('duplicateAdded'),
      guardActivationsDuringTrueKick: activations.filter((a) => a.expected?.startsWith('KNEE_')).length,
      guardActivationsDuringExpectedLimbKick: activations.filter((a) => a.expected === `KNEE_${a.side}`).length,
      guardActivationsDuringTwist: activations.filter((a) => a.expected?.startsWith('TWIST_')).length,
      activations, attemptedEntries: guard.observations.length, unavailableEntries: guard.observations.filter((o) => o.decision === null).length,
      blockedEntryFrames: guard.observations.filter((o) => o.decision === true).length, entryObservations: guard.observations,
      stages, checks, accepted: Object.values(checks).every(Boolean) };
  });
  const sum = (key: 'falseRemoved' | 'falseAdded' | 'trueEventsPreserved' | 'trueEventsLost' | 'wrong' | 'duplicates' | 'guardActivationsDuringTrueKick' | 'guardActivationsDuringTwist') =>
    perFixture.reduce((n, f) => n + f[key], 0);
  return { id: twistGuardId(config), config: { ...config }, analysisStatus: TWIST_ANALYSIS_STATUS,
    falseRemoved: sum('falseRemoved'), falseAdded: sum('falseAdded'), trueEventsPreserved: sum('trueEventsPreserved'), trueEventsLost: sum('trueEventsLost'),
    wrong: sum('wrong'), duplicates: sum('duplicates'), guardActivationsDuringTrueKick: sum('guardActivationsDuringTrueKick'), guardActivationsDuringTwist: sum('guardActivationsDuringTwist'),
    perFixture, assessment: !completeRoles ? 'INSUFFICIENT_EVIDENCE' : perFixture.every((f) => f.accepted) ? 'EXPLORATORY_VIABLE' : 'REJECTED' };
}
export type TwistStrategyResult = ReturnType<typeof analyzeTwistStrategy>;
export function createTwistReport(evidence: TwistEvidence, strategyResults: TwistStrategyResult[], createdAt = new Date().toISOString()) {
  return { ...evidence, createdAt, strategySettings: { grid: TWIST_SWEEP,
    suppression: 'ENTRY_ONLY: current eligible side entry, no continuing side channel run (current value still >= enter); rejected frames retry with current values; no past/future peaks, no mid-run cancellation',
    bilateralActive: 'both absolute Y >= existing Y enter 0.40; either missing => unavailable, never automatic veto',
    counting: 'activation starts a contiguous blocked-entry frame episode per side; blockedEntryFrames also reported. Recall/false deltas compared per stage to fixed Y+flexion+integrity12, no aggregate cancellation',
    acceptance: 'all five explicit roles; preserve fixed-candidate recall per stage, no added false/duplicates, wrong/hard-gap/soft-gap0, no added reacquisition false; OLD CLEAN and LIVE3 both kicks exactly1, LIVE3 TwistLeft false0' },
    strategyResults, exploratoryViableConfigs: strategyResults.filter((s) => s.assessment === 'EXPLORATORY_VIABLE').map((s) => ({ id: s.id, ...s.config })) };
}
export type TwistReport = ReturnType<typeof createTwistReport>;

export function twistTracesCsv(evidence: TwistEvidence) {
  const rows = evidence.twistConfusionEvidence.perFixture.flatMap((f) => f.eventTraces.flatMap((t) => t.rows.map((r) => ({
    analysisStatus: TWIST_ANALYSIS_STATUS, trialId: f.input.trialId, traceKind: t.kind, mode: t.mode, candidateStart: t.candidateStart,
    kickConfirm: t.kickConfirm, ...r }))));
  if (!rows.length) return 'analysisStatus,fixture,trialId,timestamp';
  const keys = Object.keys(rows[0]) as (keyof typeof rows[number])[];
  const quote = (v: unknown) => `"${(v === null ? '' : typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : String(v)).replaceAll('"', '""')}"`;
  return [keys.join(','), ...rows.map((r) => keys.map((k) => quote(r[k])).join(','))].join('\r\n');
}
