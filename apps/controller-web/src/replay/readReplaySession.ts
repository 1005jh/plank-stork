import { validateReplayV2 } from './validateReplayV2';
import type { ReplaySession } from './replayTypes';
import { validKneeKickBaselineV3 } from '../pose/kick/kneeKickDetectorV3';

/** Validate local inputs before letting malformed times/coordinates enter the production core. */
export function readReplaySession(json: string): ReplaySession {
  const data = JSON.parse(json) as ReplaySession;
  const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  const nonnegative = (value: unknown) => number(value) && value >= 0;
  const baseline = (value: unknown) => value !== null && typeof value === 'object' &&
    ['leftMedian', 'rightMedian', 'leftDistanceMedian', 'rightDistanceMedian', 'bodyScale'].every((key) => number((value as Record<string, unknown>)[key])) &&
    (value as { bodyScale: number }).bodyScale > 0;
  const points = (value: unknown) => Array.isArray(value) && (value.length === 0 || value.length === 33) && value.every((p) => p &&
    number(p.x) && number(p.y) && number(p.z) && (p.visibility === null || number(p.visibility)));
  const timed = (value: { tMs: number; order: number }) => value && nonnegative(value.tMs) && nonnegative(value.order);
  const states = ['NOT_READY', 'ARMED', 'CANDIDATE', 'WAIT_CLEAR', 'WAIT_RETURN', 'TRIGGERED_LEFT', 'TRIGGERED_RIGHT'];
  try {
    if ((data.detectorMode !== undefined && !['Y_V3', 'LEGACY_X'].includes(data.detectorMode)) || ![1, 2].includes(data.version) || typeof data.captureId !== 'string' || !data.captureId || !nonnegative(data.timing.durationMs) ||
        !number(data.timing.captureStartPerformanceMs) || typeof data.video.filename !== 'string' ||
        !number(data.video.width) || !number(data.video.height) || !['GPU', 'CPU'].includes(data.pose.delegate) ||
        typeof data.pose.modelUrl !== 'string' || typeof data.pose.settings !== 'object' || !data.pose.settings ||
        typeof data.display.mirrorEnabled !== 'boolean' ||
        !Array.isArray(data.poseFrames) || !data.poseFrames.every((frame) => timed(frame) && points(frame.landmarks) && points(frame.worldLandmarks)) ||
        !Array.isArray(data.markers) || !data.markers.every((marker) => timed(marker) && typeof marker.type === 'string') ||
        !Array.isArray(data.clockSamples) || !data.clockSamples.every((clock) => timed(clock) && number(clock.trialId)) ||
        !Array.isArray(data.liveResult.trials) || !data.liveResult.trials.every((trial) =>
          number(trial.id) && nonnegative(trial.startMs) && number(trial.startOrder) &&
          (trial.endMs === null || (number(trial.endMs) && trial.endMs >= trial.startMs)) &&
          (trial.endOrder === null || number(trial.endOrder)) && baseline(trial.baseline) && trial.result &&
          number(trial.result.poseFrameCount) && number(trial.result.poseUsableFrameCount) && states.includes(trial.result.finalState) &&
          Array.isArray(trial.result.events) && trial.result.events.every((event) => number(event.id) && nonnegative(event.tMs) && ['KNEE_LEFT', 'KNEE_RIGHT'].includes(event.direction)))) {
      throw new Error('invalid');
    }
    if (data.version === 2) validateReplayV2(data);
    // The table reads summaries; reject missing/incorrect nested keys here, not during render.
    if (data.liveResult.kickBaselineV3 != null && !validKneeKickBaselineV3(data.liveResult.kickBaselineV3)) throw new Error('V3 baseline');
    for (const trial of data.liveResult.trials) {
      if (trial.baselineV3 != null && !validKneeKickBaselineV3(trial.baselineV3)) throw new Error('V3 baseline');
      const shadow = trial.legacyXShadow?.result;
      if (shadow && (!nonnegative(shadow.poseFrameCount) || !nonnegative(shadow.poseUsableFrameCount) || !states.includes(shadow.finalState) ||
        !Array.isArray(shadow.events) || !shadow.events.every((e) => number(e.id) && nonnegative(e.tMs) && ['KNEE_LEFT', 'KNEE_RIGHT'].includes(e.direction)))) throw new Error('X shadow result');
      for (const result of [trial.result, ...(shadow ? [shadow] : [])]) {
      const summary = result.guidedSummary;
      if (!summary) continue;
      for (const name of ['NEUTRAL', 'TWIST_LEFT', 'TWIST_RIGHT'] as const) if (!nonnegative(summary[name].falseKickCount)) throw new Error('summary');
      for (const name of ['KNEE_LEFT', 'KNEE_RIGHT'] as const) if (typeof summary[name].detected !== 'boolean' ||
        ![null, true, false].includes(summary[name].directionCorrect)) throw new Error('summary');
      }
    }
  } catch { throw new Error('지원하는 STEP 4F version 1 / STEP 4P version 2 Replay JSON이 아닙니다. 원본 Capture JSON을 선택하세요.'); }
  return data;
}
