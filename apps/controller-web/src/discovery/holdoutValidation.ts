import { runIntegrityFixture } from './analyzeIntegrity';
import type { IntegrityFixture } from './integrityFeatures';
import { FIXED_FLEXION_CONFIG, PRE_REGISTERED_INTEGRITY_CONFIG } from './integrityGuard';
import { REPLAY_TIMESTAMP_TOLERANCE_MS } from '../replay/landmarkReplay';
import { DETECTOR_TEST_SEQUENCE } from '../pose/kick/guidedDetectorTest';

export const HOLDOUT_ROLE = 'REFERENCE_LIVE_3_HOLDOUT' as const;

/** No config argument, sweep import, ranking or retry with another threshold. */
export function validateIntegrityHoldout(fixtures: readonly IntegrityFixture[]) {
  if (!fixtures.length) throw new Error('HOLDOUT capture를 직접 지정하세요.');
  const seen = new Set<string>();
  // All trials must pass parity before ANY guarded evaluation starts.
  for (const f of fixtures) {
    if (f.input.role !== HOLDOUT_ROLE) throw new Error('HOLDOUT role만 별도로 평가합니다.');
    const key = `${f.input.captureId}/${f.input.trialId}`;
    if (seen.has(key)) throw new Error('동일 capture/trial을 중복 입력할 수 없습니다.');
    seen.add(key);
    const p = f.liveReplayParity, c = f.production.comparison, b = f.production.calibrationParity;
    if (!p.required || !p.matched || c?.eventsEqual !== true || !c.guidedSummaryEqual || !c.finalStateEqual ||
      b?.kickBaselineV3Equal !== true || !b.neutralBaselineEqual || !b.kickBaselineEqual)
      throw new Error(`LIVE_V3_PARITY_MISMATCH ${f.input.filename}: HOLDOUT requires matching Y_V3 events/time, summary, baselines and final state.`);
  }
  const perFixture = fixtures.map((f) => {
    const y = runIntegrityFixture(f, PRE_REGISTERED_INTEGRITY_CONFIG, 'Y_ONLY');
    const full = runIntegrityFixture(f, PRE_REGISTERED_INTEGRITY_CONFIG, 'FIXED_Y_OR_FLEXION');
    const production = f.production;
    // Preserve the original true events themselves, not merely an aggregate L/R count
    // that could hide a lost event replaced by a different event in the same stage.
    const lostProductionTrueEvents = production.events.filter((e) => !e.falseEvent && !e.wrongDirection &&
      !y.events.some((r) => r.direction === e.direction && r.stageIndex === e.stageIndex &&
        Math.abs(r.timestamp - e.timestamp) <= REPLAY_TIMESTAMP_TOLERANCE_MS));
    const addedByStage = y.stageOutcomes.map((s) => {
      const reference = production.stages.find((r) => r.stageIndex === s.stageIndex)!;
      return { stageIndex: s.stageIndex, expected: s.expected,
        falseAdded: Math.max(0, s.falseEvents - reference.falseEvents), wrongAdded: Math.max(0, s.wrong - reference.wrongDirection),
        duplicatesAdded: Math.max(0, s.duplicates - reference.duplicates) };
    });
    const yChecks = {
      productionTrueEventsPreserved: lostProductionTrueEvents.length === 0,
      noAddedFalse: addedByStage.every((s) => s.falseAdded === 0),
      noAddedWrong: addedByStage.every((s) => s.wrongAdded === 0),
      noAddedDuplicates: addedByStage.every((s) => s.duplicatesAdded === 0),
      noHardGap: y.crossGap === 0, noSoftGap: y.softGapCross === 0,
      noReacquisitionFalse: y.reacquisitionFalse === 0 && y.softRecoveryFalse === 0,
    };
    const completeStages = full.stageOutcomes.length === DETECTOR_TEST_SEQUENCE.length && full.stageOutcomes.every((s, i) =>
      s.expected === DETECTOR_TEST_SEQUENCE[i].expected && s.frameCount > 0 && !s.calibrationOnly &&
      s.endMs - s.startMs + REPLAY_TIMESTAMP_TOLERANCE_MS >= DETECTOR_TEST_SEQUENCE[i].durationMs);
    const fullChecks = {
      completeGuidedEvidence: completeStages,
      noTwistOrNeutralFalse: full.falseEvents === 0,
      leftExactlyOne: full.left === 1, rightExactlyOne: full.right === 1,
      noWrong: full.wrong === 0, noDuplicates: full.duplicates === 0,
      noHardGap: full.crossGap === 0, noSoftGap: full.softGapCross === 0,
      noReacquisitionFalse: full.reacquisitionFalse === 0 && full.softRecoveryFalse === 0,
      noExpectedLimbKickActivation: full.guardActivationsDuringExpectedLimbKick === 0,
    };
    const failed = (checks: Record<string, boolean>) => Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name);
    return { input: f.input, liveReplayParity: f.liveReplayParity,
      calibration: { selection: 'LATEST_FROZEN', reconstruction: production.calibrationParity,
        segmentBaseline: f.segmentBaseline, flexionBaseline: f.baseline, yBaseline: f.yBaseline },
      yProductionReference: { result: production.result, events: production.events, stages: production.stages, counts: production.counts },
      yWithGuard12: y, fixedFlexionWithGuard12: full,
      acceptance: { yGuardSafetyPass: Object.values(yChecks).every(Boolean), fullCandidatePass: Object.values(fullChecks).every(Boolean),
        yChecks, fullChecks, yFailureReasons: failed(yChecks), fullFailureReasons: failed(fullChecks),
        lostProductionTrueEvents, addedByStage,
        expectedLimbKickActivations: full.guardActivationsDuringExpectedLimbKick } };
  });
  return { role: HOLDOUT_ROLE, preRegisteredConfig: PRE_REGISTERED_INTEGRITY_CONFIG,
    fixedFlexionConfig: { ...FIXED_FLEXION_CONFIG },
    registration: 'STEP 4K.2A: fixed using STEP 4K.1, before independent holdout inspection; no fallback or automatic BEST.',
    perFixture, acceptance: { yGuardSafetyPass: perFixture.every((f) => f.acceptance.yGuardSafetyPass),
      fullCandidatePass: perFixture.every((f) => f.acceptance.fullCandidatePass) } };
}
export type HoldoutValidation = ReturnType<typeof validateIntegrityHoldout>;
