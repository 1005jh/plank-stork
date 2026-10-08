import { discoveryStages } from '../discovery/discoveryStages';
import type { BodyInput } from '../discovery/bodyLocalFeatures';
import { estimatorAnchors } from '../estimator/estimatorAnalysis';
import { POSE_MODEL_URL } from '../pose/poseConstants';
import { POSE_VIDEO_OPTIONS } from '../pose/createPoseLandmarker';
import type { RecordedTrace, TraceWindow } from './forensicScoring';

/** Stage labels and original 4N anchors select report windows only, never a candidate media file. */
export function recordedTrace(input: BodyInput): RecordedTrace {
  const { session } = input;
  if (session.pose.delegate !== 'GPU' || session.pose.modelUrl !== POSE_MODEL_URL ||
      Object.entries(POSE_VIDEO_OPTIONS).some(([key, value]) => session.pose.settings[key] !== value)) {
    throw new Error('Forensic control requires original Full VIDEO GPU settings.');
  }
  const lastRecorded = session.poseFrames.at(-1)?.tMs ?? 0;
  const windows: TraceWindow[] = session.liveResult.trials.flatMap((trial) => discoveryStages(session, trial).stages.map((s) => ({
    id: `${trial.id}/stage/${s.stageIndex}`, kind: 'STAGE', label: s.expected, startMs: s.startMs, endMs: s.endMs,
  })));
  for (const trial of estimatorAnchors(input)) for (const [index, a] of trial.anchors.entries()) {
    windows.push({ id: `${trial.trialId}/anchor/${index}`, kind: 'ANCHOR', label: `${a.kind}/${a.side}/${a.mode}`,
      startMs: Math.max(0, a.startMs), endMs: Math.min(session.timing.durationMs, lastRecorded, a.endMs) });
  }
  return { captureId: session.captureId, captureDurationMs: session.timing.durationMs, frames: session.poseFrames,
    requiredEndMs: Math.max(0, ...windows.map((w) => w.endMs)), windows };
}
