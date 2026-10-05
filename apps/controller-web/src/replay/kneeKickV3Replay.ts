import { PoseFeatureAnalysis } from '../pose/features/poseFeatureAnalysis';
import { KneeKickAnalysis } from '../pose/kick/kneeKickAnalysis';
import { buildKneeKickBaselineV3 } from '../pose/kick/kneeKickBaselineV3';
import { GuidedDetectorTest } from '../pose/kick/guidedDetectorTest';
import { KneeKickDetectorV3, Y_KICK_V3_CONFIG, usableKneesV3, validKneeKickBaselineV3, type KneeKickEventV3 } from '../pose/kick/kneeKickDetectorV3';
import { extractKneeMotionFeatures } from '../pose/motion/kneeMotionFeatures';
import { discoveryStages, stageForTime } from '../discovery/discoveryStages';
import { summarizeTemporalSide, type TemporalPoint } from '../discovery/temporalEvidence';
import { orderedFrames, replayLandmarks, replayCalibration, compareReplayResults, latestCalibrationStart } from './landmarkReplay';
import { asPoseFrame, replayDetectorMode, type ReplayResult, type ReplaySession, type ReplayTrial } from './replayTypes';

export function resolveV3ReplayBaseline(session: ReplaySession, trial: ReplayTrial) {
  if (trial.baselineV3 != null) {
    if (!validKneeKickBaselineV3(trial.baselineV3)) throw new Error('유효하지 않은 저장된 V3 baseline입니다.');
    return { source: 'STORED_V3' as const, baseline: { ...trial.baselineV3 }, calibrationOnly: null,
      scaleSource: 'STORED_V3', warnings: [] as string[] };
  }
  const start = latestCalibrationStart(session, trial);
  if (start) {
    const neutral = new PoseFeatureAnalysis(), calibration = new KneeKickAnalysis();
    neutral.startCalibration(start.tMs);
    for (const recorded of orderedFrames(session.poseFrames)) {
      if (recorded.tMs < start.tMs || (recorded.tMs === start.tMs && recorded.order <= start.order) || recorded.tMs >= trial.startMs) continue;
      const frame = asPoseFrame(recorded);
      neutral.processFrame(frame.landmarks, frame.worldLandmarks, frame.timestamp);
      calibration.processFrame(frame, neutral.getView(frame.timestamp));
    }
    const baseline = calibration.getReplaySnapshot().baselineV3;
    if (!baseline) throw new Error('기록된 Neutral calibration에서 V3 baseline의 usable samples가 부족합니다.');
    return { source: 'CALIBRATION_REPLAY' as const, baseline, calibrationOnly: null,
      scaleSource: 'PRODUCTION_NEUTRAL_WINDOW', warnings: replayDetectorMode(session) === 'Y_V3' ? [] : ['Legacy capture: V3 baseline reconstructed from recorded calibration frames; no stored V3 live result.'] };
  }
  if (replayDetectorMode(session) === 'Y_V3') throw new Error('Y_V3 capture에는 저장된 V3 baseline 또는 실제 Neutral calibration frame이 필요합니다. 첫 Neutral stage를 대체 보정으로 사용하지 않습니다.');
  // Legacy captures sometimes started after calibration, so Y was never recorded in the baseline.
  // Explicit compatibility reconstruction only. These first Neutral frames are calibration data,
  // excluded from candidate evaluation; they are not independent false-event evidence.
  const neutral = discoveryStages(session, trial).stages.find((s) => s.expected === 'NEUTRAL');
  if (!neutral) throw new Error('V3 baseline을 재구성할 첫 Neutral 구간이 없습니다.');
  const samples = orderedFrames(session.poseFrames).filter((f) => f.tMs >= neutral.startMs && f.tMs < neutral.endMs)
    .map((f) => extractKneeMotionFeatures(f.landmarks));
  const baseline = buildKneeKickBaselineV3(samples, trial.baseline);
  if (!baseline) throw new Error('첫 Neutral 구간에서 V3 baseline을 재구성할 usable samples가 부족합니다.');
  return { source: 'FIRST_NEUTRAL_RECONSTRUCTION' as const, baseline, calibrationOnly: { startMs: neutral.startMs, endMs: neutral.endMs },
    scaleSource: 'RECORDED_LEGACY_X_BASELINE', warnings: ['Original Neutral calibration frames / stored V3 baseline absent. First Neutral is used only for Y calibration, not independent validation. This does not prove live calibration parity.'] };
}

/** V3 primary parity runner. Old captures retain an explicitly labelled X reference. */
export function replayKneeKickV3(session: ReplaySession, trialId: number) {
  const trial = session.liveResult.trials.find((t) => t.id === trialId);
  if (!trial || trial.endMs === null) throw new Error('완료 또는 중지된 Guided trial이 필요합니다.');
  const baseline = resolveV3ReplayBaseline(session, trial), detector = new KneeKickDetectorV3(), guided = new GuidedDetectorTest();
  detector.setBaseline(baseline.baseline); guided.start(trial.startMs, true);
  const stageDefinition = discoveryStages(session, trial);
  const beforeEnd = (t: number, order: number) => t < trial.endMs! || t === trial.endMs && order <= (trial.endOrder ?? Infinity);
  const frames = orderedFrames(session.poseFrames).filter((f) => (f.tMs > trial.startMs || f.tMs === trial.startMs && f.order > trial.startOrder) && beforeEnd(f.tMs, f.order));
  const operations = [...frames.map((frame) => ({ tMs: frame.tMs, order: frame.order, frame })),
    ...session.clockSamples.filter((c) => c.trialId === trialId && c.tMs >= trial.startMs && beforeEnd(c.tMs, c.order)).map((c) => ({ ...c, frame: null }))]
    .sort((a, b) => a.tMs - b.tMs || a.order - b.order);
  const diagnostics: (ReturnType<KneeKickDetectorV3['getValuesForDiagnostics']> & { timestamp: number; stageIndex: number | null;
    expected: string | null; calibrationOnly: boolean; usableLeft: boolean; usableRight: boolean })[] = [];
  const events: (KneeKickEventV3 & { expected: string | null; stageIndex: number | null; falseEvent: boolean; wrongDirection: boolean })[] = [];
  let poseUsableFrameCount = 0, calibrationOnlyFrameCount = 0;
  for (const op of operations) {
    guided.advance(op.tMs, detector.getStateForDiagnostics()); // Never waits on tracking/readiness.
    if (!op.frame) { detector.getView(op.tMs); continue; }
    const features = extractKneeMotionFeatures(op.frame.landmarks), usable = usableKneesV3(features);
    if (usable.left || usable.right) poseUsableFrameCount++;
    const calibrationOnly = baseline.calibrationOnly !== null && op.tMs >= baseline.calibrationOnly.startMs && op.tMs < baseline.calibrationOnly.endMs;
    if (calibrationOnly) calibrationOnlyFrameCount++;
    const event = calibrationOnly ? null : detector.processFrame(features, op.tMs);
    const stage = stageForTime(stageDefinition.stages, op.tMs);
    if (event && stage) {
      guided.record(event);
      const falseEvent = !stage.expected.startsWith('KNEE_');
      events.push({ ...event, expected: stage.expected, stageIndex: stage.stageIndex, falseEvent, wrongDirection: !falseEvent && stage.expected !== event.direction });
    }
    diagnostics.push({ timestamp: op.tMs, stageIndex: stage?.stageIndex ?? null, expected: stage?.expected ?? null, calibrationOnly,
      usableLeft: usable.left, usableRight: usable.right, ...detector.getValuesForDiagnostics() });
  }
  const snapshot = guided.getReplaySnapshot();
  const result: ReplayResult = { poseFrameCount: frames.length, poseUsableFrameCount,
    events: events.map((e) => ({ id: e.id, direction: e.direction, tMs: e.timestamp })), finalState: detector.getStateForDiagnostics(), guidedSummary: snapshot.summary };
  const stages = stageDefinition.stages.map((stage) => {
    const rows = diagnostics.filter((d) => d.stageIndex === stage.stageIndex && !d.calibrationOnly);
    const point = (side: 'LEFT' | 'RIGHT', d: typeof rows[number]): TemporalPoint => {
      const value = side === 'LEFT' ? d.normalizedYLeft : d.normalizedYRight;
      return { timestamp: d.timestamp, usable: value !== null, deltaDyNorm: value, absY: value === null ? null : Math.abs(value),
        displacement2D: null, normalizedX: side === 'LEFT' ? d.normalizedXLeft : d.normalizedXRight, visibility: { leftHip: null, rightHip: null, knee: null } };
    };
    const left = summarizeTemporalSide(rows.map((d) => point('LEFT', d)), stage.startMs, stage.endMs);
    const right = summarizeTemporalSide(rows.map((d) => point('RIGHT', d)), stage.startMs, stage.endMs);
    const emitted = events.filter((e) => e.stageIndex === stage.stageIndex), kick = stage.expected.startsWith('KNEE_');
    const correct = emitted.filter((e) => e.direction === stage.expected).length, wrong = emitted.filter((e) => e.wrongDirection).length;
    const observable = stage.expected === 'KNEE_LEFT' ? left.observableStage : stage.expected === 'KNEE_RIGHT' ? right.observableStage : left.observableStage && right.observableStage;
    return { ...stage, calibrationOnly: baseline.calibrationOnly?.startMs === stage.startMs,
      leftUsableFrames: left.usableFrameCount, rightUsableFrames: right.usableFrameCount, frameCount: rows.length,
      leftCoverage: left.coverage, rightCoverage: right.coverage, observable, correct, wrongDirection: wrong,
      duplicates: kick ? Math.max(0, emitted.length - 1) : 0, falseEvents: emitted.filter((e) => e.falseEvent).length,
      outcome: !rows.length ? 'NOT_EVALUATED' : kick ? correct === 1 && !wrong && emitted.length === 1 ? 'CORRECT' : emitted.length ? 'WRONG_OR_DUPLICATE' : observable ? 'MISS' : 'UNOBSERVABLE' : emitted.length ? 'FALSE_EVENT' : 'CLEAR' };
  });
  const counts = { leftDetected: stages.filter((s) => s.expected === 'KNEE_LEFT').reduce((n, s) => n + s.correct, 0),
    rightDetected: stages.filter((s) => s.expected === 'KNEE_RIGHT').reduce((n, s) => n + s.correct, 0),
    falseEvents: events.filter((e) => e.falseEvent).length, wrongDirection: events.filter((e) => e.wrongDirection).length,
    duplicates: stages.reduce((n, s) => n + s.duplicates, 0), crossGapConfirmations: events.filter((e) => e.crossGapConfirmation).length,
    reacquisitionFalseEvents: events.filter((e) => (e.falseEvent || e.wrongDirection) && e.eventSource === 'POST_REACQUISITION').length };
  const legacyX = replayLandmarks(session, trialId);
  const isV3Live = replayDetectorMode(session) === 'Y_V3';
  const comparison = isV3Live ? compareReplayResults(result, trial.result, 'LIVE_V3') : null;
  // New fixtures should include actual setup frames. Lack of these is visible, never substituted.
  let calibrationParity: ReturnType<typeof replayCalibration> | null = null;
  let calibrationWarning: string | null = null;
  if (isV3Live) {
    try { calibrationParity = replayCalibration(session, trialId); }
    catch (cause) { calibrationWarning = cause instanceof Error ? cause.message : String(cause); }
  }
  return { version: 1, detector: 'Y_KICK_V3' as const, replayMode: 'LANDMARK' as const, sourceCaptureId: session.captureId, trialId,
    config: Y_KICK_V3_CONFIG, comparison, calibrationParity, baseline, calibrationOnlyFrameCount, result, events, diagnostics, stages, counts,
    finalDiagnostics: detector.getValuesForDiagnostics(), guided: snapshot,
    cleanAcceptance: counts.leftDetected === 1 && counts.rightDetected === 1 && counts.falseEvents === 0 && counts.wrongDirection === 0 && counts.duplicates === 0 &&
      result.finalState === 'ARMED' && stages.filter((s) => s.expected.startsWith('KNEE_')).every((s) => s.observable),
    stressAcceptance: counts.crossGapConfirmations === 0 && counts.reacquisitionFalseEvents === 0,
    // X is a separate reference. Disagreement never changes V3 acceptance/parity.
    legacyX, warnings: [...baseline.warnings, ...stageDefinition.warnings, ...(calibrationWarning ? [calibrationWarning] : [])] };
}
export type KneeKickV3Replay = ReturnType<typeof replayKneeKickV3>;
