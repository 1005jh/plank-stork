import { isDeepStrictEqual } from 'node:util';
import { discoveryStages, stageForTime } from '../discovery/discoveryStages';
import { DETECTOR_TEST_SEQUENCE } from '../pose/kick/guidedDetectorTest';
import { KneeKickDetectorV3, validKneeKickBaselineV3, usableKneesV3, type KneeKickEventV3 } from '../pose/kick/kneeKickDetectorV3';
import { extractKneeMotionFeatures } from '../pose/motion/kneeMotionFeatures';
import { replayKneeKickV3 } from '../replay/kneeKickV3Replay';
import type { ReplayPoseFrame, ReplaySession } from '../replay/replayTypes';
import { createDisabledRecoveryMirror, createRecoveryDetector, RECOVERY_POLICIES, recoveryImplementationProof, type RecoveryPolicy } from './recoveryShadowFactory';
import { evaluateRecoverySynthetic } from './recoverySynthetic';

/** No stage labels or future frames are passed into either the real or derived detector. */
export function replayRecoveryPolicy(session: ReplaySession, frames: readonly ReplayPoseFrame[], policy: RecoveryPolicy, liveClocks: boolean) {
  const trial = session.liveResult.trials[0];
  if (!trial || trial.endMs === null || !validKneeKickBaselineV3(trial.baselineV3)) throw new Error('Completed trial and stored production V3 baseline required.');
  if (frames.some((f, i) => !Number.isFinite(f.tMs) || i > 0 && f.tMs <= frames[i - 1].tMs)) throw new Error('Invalid source timeline; do not drop or retime frames.');
  const definition = discoveryStages(session, trial);
  if (definition.source !== 'GUIDED_STAGE_CHANGE' || definition.stages.length !== DETECTOR_TEST_SEQUENCE.length ||
    definition.stages.some((s, i) => s.endMs - s.startMs !== DETECTOR_TEST_SEQUENCE[i].durationMs)) throw new Error('Original complete 22s Guided markers required.');
  const detector = createRecoveryDetector(policy), mirror = policy === 'CONTROL' ? createDisabledRecoveryMirror() : null;
  detector.setBaseline(trial.baselineV3); mirror?.setBaseline(trial.baselineV3);
  const inTrial = (t: number, order: number) => t < trial.endMs! || t === trial.endMs && order <= (trial.endOrder ?? Infinity);
  // Same start/reset boundary as original replay. All subsequent frames, including missing and
  // post-Guided frames, are processed at their original times; setup frames remain in the source.
  const afterStart = frames.filter((f) => f.tMs > trial.startMs || f.tMs === trial.startMs && f.order > trial.startOrder);
  const clocks = liveClocks ? session.clockSamples.filter((c) => c.trialId === trial.id && c.tMs >= trial.startMs && inTrial(c.tMs, c.order)) : [];
  const operations = [...afterStart.map((f) => ({ tMs: f.tMs, order: f.order, frame: f })),
    ...clocks.map((c) => ({ ...c, frame: null }))].sort((a, b) => a.tMs - b.tMs || a.order - b.order);
  type Diagnostic = ReturnType<KneeKickDetectorV3['getValuesForDiagnostics']>;
  const rows: (Diagnostic & { timestamp: number; order: number; trialWindow: boolean; usableLeft: boolean; usableRight: boolean;
    posePresent: boolean; event: KneeKickEventV3 | null; stateBefore: Diagnostic['state'] })[] = [];
  let trialFinalDiagnostics = detector.getValuesForDiagnostics(), mirrorFrames = 0, mirrorClocks = 0;
  for (const op of operations) {
    if (!op.frame) {
      const view = detector.getView(op.tMs);
      if (mirror) { if (!isDeepStrictEqual(view, mirror.getView(op.tMs))) throw new Error('Disabled mirror clock parity failure.'); mirrorClocks++; }
    } else {
      const features = extractKneeMotionFeatures(op.frame.landmarks), usable = usableKneesV3(features);
      const stateBefore = detector.getStateForDiagnostics(), event = detector.processFrame(features, op.tMs);
      const diagnostics = detector.getValuesForDiagnostics();
      if (mirror) {
        if (!isDeepStrictEqual(event, mirror.processFrame(features, op.tMs)) || !isDeepStrictEqual(diagnostics, mirror.getValuesForDiagnostics()) ||
            !isDeepStrictEqual(detector.getReplaySnapshot(), mirror.getReplaySnapshot())) throw new Error('Disabled mirror frame parity failure.');
        mirrorFrames++;
      }
      rows.push({ ...diagnostics, timestamp: op.tMs, order: op.order, trialWindow: inTrial(op.tMs, op.order),
        usableLeft: usable.left, usableRight: usable.right, posePresent: op.frame.landmarks.length > 0, event, stateBefore });
    }
    if (inTrial(op.tMs, op.order)) trialFinalDiagnostics = detector.getValuesForDiagnostics();
  }

  // Labels are attached only AFTER all causal detector processing has finished.
  const trace = rows.map((row) => {
    const stage = stageForTime(definition.stages, row.timestamp), s1 = policy === 'S1' || policy === 'S1+S2';
    const entry = row.state === 'ARMED' || row.state === 'CANDIDATE';
    return { ...row, stageIndex: stage?.stageIndex ?? null, expected: stage?.expected ?? null,
      // Preserve original diagnostics: S1 allows entry while the original Neutral gate remains
      // REACQUIRED_NOT_READY. Do not falsely rename that state to READY in reports.
      shadowLeftEntryAllowed: entry && row.usableLeft && (row.leftTrackingState === 'READY' || s1 && row.leftTrackingState === 'REACQUIRED_NOT_READY'),
      shadowRightEntryAllowed: entry && row.usableRight && (row.rightTrackingState === 'READY' || s1 && row.rightTrackingState === 'REACQUIRED_NOT_READY') };
  });
  const events = trace.flatMap((r) => r.event && r.stageIndex !== null ? [{ ...r.event, stageIndex: r.stageIndex, expected: r.expected!,
    falseEvent: !r.expected!.startsWith('KNEE_'), wrongDirection: r.expected!.startsWith('KNEE_') && r.event.direction !== r.expected }] : []);
  const stages = definition.stages.map((s) => {
    const stageRows = trace.filter((r) => r.stageIndex === s.stageIndex), emitted = events.filter((e) => e.stageIndex === s.stageIndex);
    const kick = s.expected.startsWith('KNEE_');
    return { ...s, frameCount: stageRows.length, poseMissing: stageRows.filter((r) => !r.posePresent).length,
      leftUsable: stageRows.filter((r) => r.usableLeft).length, rightUsable: stageRows.filter((r) => r.usableRight).length,
      correct: emitted.filter((e) => e.direction === s.expected).length,
      falseEvents: emitted.filter((e) => e.falseEvent).length, wrongDirection: emitted.filter((e) => e.wrongDirection).length,
      duplicates: kick ? Math.max(0, emitted.length - 1) : 0 };
  });
  const counts = { leftDetected: stages.filter((s) => s.expected === 'KNEE_LEFT').reduce((n, s) => n + s.correct, 0),
    rightDetected: stages.filter((s) => s.expected === 'KNEE_RIGHT').reduce((n, s) => n + s.correct, 0),
    falseEvents: events.filter((e) => e.falseEvent).length, wrongDirection: events.filter((e) => e.wrongDirection).length,
    duplicates: stages.reduce((n, s) => n + s.duplicates, 0), crossGapConfirmations: events.filter((e) => e.crossGapConfirmation).length,
    reacquisitionFalseEvents: events.filter((e) => (e.falseEvent || e.wrongDirection) && e.eventSource === 'POST_REACQUISITION').length };
  const signature = (r: typeof trace[number]) => [r.state, r.leftTrackingState, r.rightTrackingState, r.leftCandidateStartedAt, r.rightCandidateStartedAt,
    r.leftClearRunMs >= 100, r.rightClearRunMs >= 100];
  const transitions = trace.filter((r, i) => r.event || i === 0 || !isDeepStrictEqual(signature(r), signature(trace[i - 1])));
  let replayParity: { status: 'PASS'; frameCount: number } | null = null;
  if (policy === 'CONTROL') {
    const reference = replayKneeKickV3({ ...session, poseFrames: [...frames], clockSamples: liveClocks ? session.clockSamples : [] }, trial.id);
    const trialRows = trace.filter((r) => r.trialWindow);
    if (!isDeepStrictEqual(events, reference.events) || !isDeepStrictEqual(counts, reference.counts) ||
        !isDeepStrictEqual(trialFinalDiagnostics, reference.finalDiagnostics) || trialRows.length !== reference.diagnostics.length ||
        trialRows.some((r, i) => Object.entries(reference.diagnostics[i]).some(([key, value]) => key !== 'calibrationOnly' && !isDeepStrictEqual(r[key as keyof typeof r], value))))
      throw new Error('CONTROL differs from existing replay; do not attribute to shadow policies.');
    replayParity = { status: 'PASS', frameCount: trialRows.length };
  }
  return { policy, counts, neutralFalse: stages.filter((s) => s.expected === 'NEUTRAL').reduce((n, s) => n + s.falseEvents, 0),
    twistFalse: stages.filter((s) => s.expected.startsWith('TWIST_')).reduce((n, s) => n + s.falseEvents, 0),
    events, stages, finalState: trialFinalDiagnostics.state, trialFinalDiagnostics,
    sourceFrameCount: frames.length, setupFramesNotFedToTrialReset: frames.length - afterStart.length,
    processedFrames: rows.length, trialFrames: rows.filter((r) => r.trialWindow).length, clocksProcessed: clocks.length,
    guidedFrames: trace.filter((r) => r.stageIndex !== null).length,
    frameRemovalOrInterpolation: false, replayParity,
    disabledMirrorParity: mirror ? { status: 'PASS' as const, frames: mirrorFrames, clocks: mirrorClocks } : null,
    transitions, trace, postGuided: { includedInScoring: false,
      events: trace.flatMap((r) => r.stageIndex === null && r.event ? [r.event] : []), finalState: detector.getStateForDiagnostics() } };
}
type Replay = ReturnType<typeof replayRecoveryPolicy>;
const clean = (r: Pick<Replay, 'counts'>) => r.counts.leftDetected === 1 && r.counts.rightDetected === 1 &&
  r.counts.falseEvents === 0 && r.counts.wrongDirection === 0 && r.counts.duplicates === 0 && r.counts.crossGapConfirmations === 0 && r.counts.reacquisitionFalseEvents === 0;
export type RecoveryAssessment = 'INSUFFICIENT_EVIDENCE' | 'SHADOW_CANDIDATE_WORTH_VALIDATING' | 'PARTIAL_OR_UNSAFE';
export function assessRecoveryPolicy(live: Pick<Replay, 'counts'>, video: Pick<Replay, 'counts'>, syntheticStatus: 'PASS' | 'FAIL', verified: boolean): RecoveryAssessment {
  return !verified ? 'INSUFFICIENT_EVIDENCE' : clean(live) && clean(video) && syntheticStatus === 'PASS'
    ? 'SHADOW_CANDIDATE_WORTH_VALIDATING' : 'PARTIAL_OR_UNSAFE';
}
export function summarizeRecoveryFeasibility(statuses: readonly ReturnType<typeof assessRecoveryPolicy>[]) {
  return statuses.length !== 4 || statuses.includes('INSUFFICIENT_EVIDENCE') ? 'INSUFFICIENT_EVIDENCE'
    : statuses.slice(1).includes('SHADOW_CANDIDATE_WORTH_VALIDATING') ? 'SHADOW_CANDIDATE_WORTH_VALIDATING' : 'NO_SAFE_CANDIDATE';
}

export function createRecoveryPolicyReport(session: ReplaySession, videoFrames: readonly ReplayPoseFrame[]) {
  if (session.version !== 2 || session.detectorMode !== 'Y_V3' || session.liveResult.trials.length !== 1) throw new Error('One V2 Y_V3 capture required.');
  const rows = RECOVERY_POLICIES.map((policy) => {
    const live = replayRecoveryPolicy(session, session.poseFrames, policy, true);
    const video = replayRecoveryPolicy(session, videoFrames, policy, false);
    const synthetic = evaluateRecoverySynthetic(policy);
    return { policy, live, video, synthetic, liveSuccessPreserved: clean(live),
      videoLeftRecovered: video.counts.leftDetected === 1, videoBothKicks: video.counts.leftDetected === 1 && video.counts.rightDetected === 1,
      videoFalseEliminated: video.neutralFalse === 0 && video.twistFalse === 0,
      status: assessRecoveryPolicy(live, video, synthetic.status, true) };
  });
  return { step: '4S', version: 1, captureId: session.captureId, scope: 'ANALYSIS_ONLY_POST_OBSERVATION_SHADOW_FEASIBILITY',
    implementation: recoveryImplementationProof(), baseline: session.liveResult.trials[0].baselineV3,
    policies: rows, status: summarizeRecoveryFeasibility(rows.map((r) => r.status)),
    auxiliary: { FULL_IMAGE: 'EXISTING_4Q_4R_OBSERVATIONS_ONLY', HEAVY_VIDEO: 'NOT_EVALUATED_INSUFFICIENT_VARIANT_NEUTRAL', LIVE2_LIVE3: 'NOT_USED' },
    interpretation: 'Previously observed V2 capture; not an independent holdout. Synthetic PASS is not independent recognition evidence. A candidate only warrants separate future validation, never production approval.' };
}
