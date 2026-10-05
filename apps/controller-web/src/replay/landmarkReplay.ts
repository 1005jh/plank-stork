import { PoseFeatureAnalysis } from '../pose/features/poseFeatureAnalysis';
import { KneeKickAnalysis } from '../pose/kick/kneeKickAnalysis';
import { diagnosticConfig } from '../pose/kick/kneeKickDiagnostics';
import { usableKnees } from '../pose/kick/kneeKickDetector';
import { extractKneeMotionFeatures } from '../pose/motion/kneeMotionFeatures';
import { asPoseFrame, replayDetectorMode, type ReplayComparison, type ReplayResult, type ReplayOutput, type ReplayPoseFrame, type ReplaySession, type ReplayTrial } from './replayTypes';

// Only compensates floating-point subtraction of the capture origin, not clock drift.
export const REPLAY_TIMESTAMP_TOLERANCE_MS = 0.000001;
export function orderedFrames(frames: readonly ReplayPoseFrame[]): ReplayPoseFrame[] {
  const sorted = [...frames].sort((a, b) => a.tMs - b.tMs || a.order - b.order);
  return sorted.filter((frame, index) => index === 0 || frame.tMs > sorted[index - 1].tMs);
}

/** Fast, isolated source swap. All state transitions run in the production analysis core. */
export function replayLandmarks(session: ReplaySession, trialId: number, source = session.poseFrames,
  mode: ReplayOutput['replayMode'] = 'LANDMARK'): ReplayOutput {
  const trial = session.liveResult.trials.find((trial) => trial.id === trialId);
  if (!trial || trial.endMs === null) throw new Error('완료 또는 중지된 Guided Test가 포함된 Capture JSON이 필요합니다.');
  const engine = KneeKickAnalysis.forReplay(trial.baseline);
  if (!engine.startTest(trial.startMs)) throw new Error('저장된 kick baseline으로 Guided Test를 시작할 수 없습니다.');
  const afterStart = (tMs: number, order: number) => tMs > trial.startMs || (tMs === trial.startMs && order > trial.startOrder);
  const beforeEnd = (tMs: number, order: number) => tMs < trial.endMs! || (tMs === trial.endMs && order <= (trial.endOrder ?? Infinity));
  const frames = orderedFrames(source).filter((frame) => afterStart(frame.tMs, frame.order) && beforeEnd(frame.tMs, mode === 'VIDEO' ? 0 : frame.order));
  const operations = [
    ...frames.map((frame) => ({ tMs: frame.tMs, order: frame.order, frame })),
    ...(mode === 'LANDMARK' ? session.clockSamples.filter((clock) => clock.trialId === trialId && beforeEnd(clock.tMs, clock.order))
      .map((clock) => ({ ...clock, frame: null })) : []),
  ].sort((a, b) => a.tMs - b.tMs || a.order - b.order);
  let poseUsableFrameCount = 0;
  const events: ReplayOutput['result']['events'] = [];
  let lastEventId: number | null = null;
  for (const operation of operations) {
    if (operation.frame) {
      const frame = asPoseFrame(operation.frame);
      engine.processReplayFrame(frame);
      const usable = usableKnees(extractKneeMotionFeatures(frame.landmarks));
      if (usable.left || usable.right) poseUsableFrameCount++;
    } else engine.getView(operation.tMs);
    const event = engine.getReplaySnapshot().detector.eventsLast;
    if (event && event.id !== lastEventId) {
      lastEventId = event.id;
      if (event.timestamp < trial.startMs + 22000) events.push({ id: event.id, direction: event.direction, tMs: event.timestamp });
    }
  }
  // VIDEO advances only on actual decoded media frames, with no fabricated final clock tick.
  const snapshot = engine.getReplaySnapshot();
  const result = { poseFrameCount: frames.length, poseUsableFrameCount, events, finalState: snapshot.detector.state, guidedSummary: snapshot.guided.summary };
  return { replayMode: mode, sourceCaptureId: session.captureId, trialId, result, detectorConfig: diagnosticConfig(),
    comparison: compareReplayResults(result, replayDetectorMode(session) === 'Y_V3' ? trial.legacyXShadow?.result : trial.result,
      replayDetectorMode(session) === 'Y_V3' ? 'LIVE_X_SHADOW' : 'LIVE_X') };

}

export function replayCalibration(session: ReplaySession, trialId: number) {
  const trial = session.liveResult.trials.find((trial) => trial.id === trialId);
  if (!trial) throw new Error('Guided Test를 선택하세요.');
  const start = latestCalibrationStart(session, trial);
  if (!start) throw new Error('Capture를 먼저 시작한 뒤 Neutral calibration을 수행한 JSON이 필요합니다.');
  const neutral = new PoseFeatureAnalysis(), kick = new KneeKickAnalysis();
  neutral.startCalibration(start.tMs);
  for (const recorded of orderedFrames(session.poseFrames)) {
    if (recorded.tMs < start.tMs || (recorded.tMs === start.tMs && recorded.order <= start.order) || recorded.tMs >= trial.startMs) continue;
    const frame = asPoseFrame(recorded);
    neutral.processFrame(frame.landmarks, frame.worldLandmarks, frame.timestamp);
    kick.processFrame(frame, neutral.getView(frame.timestamp));
  }
  const baseline = neutral.getView(trial.startMs).baseline;
  const kickBaseline = kick.getReplaySnapshot().legacyShadow.detector.baseline;
  const kickBaselineV3 = kick.getReplaySnapshot().baselineV3;
  const equal = (a: object | null, b: object | null) => a === null || b === null ? a === b
    : Object.entries(a).every(([key, value]) => {
      const other = (b as Record<string, unknown>)[key];
      return value === other || (typeof value === 'number' && typeof other === 'number' && Math.abs(value - other) <= 1e-9);
    });
  return { sourceCaptureId: session.captureId, trialId, calibrationStartMs: start.tMs, calibrationStartOrder: start.order, baseline, kickBaseline, kickBaselineV3,
    kickBaselineV3Equal: trial.baselineV3 == null ? null : equal(kickBaselineV3, trial.baselineV3),
    neutralBaselineEqual: equal(baseline, trial.neutralBaseline), kickBaselineEqual: equal(kickBaseline, trial.baseline) };
}

/** Compare only like-for-like detectors; missing X shadow is not a primary V3 failure. */
export function compareReplayResults(result: ReplayResult, live: ReplayResult | undefined, target: ReplayComparison['target']): ReplayComparison {
  return { target, available: live !== undefined,
    eventsEqual: !!live && result.events.length === live.events.length && result.events.every((event, i) => {
      const recorded = live.events[i];
      return event.id === recorded.id && event.direction === recorded.direction && Math.abs(event.tMs - recorded.tMs) <= REPLAY_TIMESTAMP_TOLERANCE_MS;
    }),
    finalStateEqual: !!live && result.finalState === live.finalState,
    guidedSummaryEqual: !!live && JSON.stringify(result.guidedSummary) === JSON.stringify(live.guidedSummary),
    timestampToleranceMs: REPLAY_TIMESTAMP_TOLERANCE_MS };
}

/** Select by recorded time/order, never file array order or the first calibration. */
export function latestCalibrationStart(session: ReplaySession, trial: ReplayTrial) {
  return session.markers.filter((m) => m.type === 'NEUTRAL_CALIBRATION_START' &&
    (m.tMs < trial.startMs || m.tMs === trial.startMs && m.order < trial.startOrder))
    .sort((a, b) => a.tMs - b.tMs || a.order - b.order).at(-1);
}
