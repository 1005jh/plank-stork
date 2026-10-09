import { validateReplayMediaArtifact, ReplayMediaValidationCache, verifyMediaSequence, verifyMediaDimensions } from '../replay/mediaArtifact';
import { decodeWebMFrames, replayAborted } from '../replay/decodedVideoSource';
import { replayVideoSourceError, replayVideoSourceFromFilename } from '../replay/replayVideoSource';
import { copyPoseFrame, type ReplayPoseFrame, type ReplaySession } from '../replay/replayTypes';
import { POSE_MODEL_URL } from '../pose/poseConstants';
import { POSE_VIDEO_OPTIONS } from '../pose/createPoseLandmarker';
import { createEstimator, estimatorConfig, type EstimatorVariant } from './estimatorConfig';

export function validateEstimatorMedia(session: ReplaySession, file: File) {
  if (session.version === 2) throw new Error('V2 requires async cryptographic media validation.');
  const selected = replayVideoSourceFromFilename(file.name);
  const error = replayVideoSourceError({ filename: session.video.filename, sourceCaptureId: session.captureId }, selected);
  if (error) throw new Error(error);
  if (session.pose.delegate !== 'GPU' || session.pose.modelUrl !== POSE_MODEL_URL ||
      Object.entries(POSE_VIDEO_OPTIONS).some(([key, value]) => session.pose.settings[key] !== value)) {
    throw new Error('FULL_VIDEO control requires the recorded Full / VIDEO / GPU configuration.');
  }
  return { captureId: session.captureId, expectedFilename: session.video.filename, selected,
    validation: 'EXISTING_FILENAME_CAPTURE_ID_GUARD' as const, limitation: 'Filename identity only; no verified WebM container capture metadata.' };
}
export async function validateEstimatorMediaArtifact(session: ReplaySession, file: File, signal: AbortSignal, cache = new ReplayMediaValidationCache()) {
  if (session.version !== 2) return validateEstimatorMedia(session, file);
  const identity = await validateReplayMediaArtifact(session, file, signal, cache);
  if (session.pose.delegate !== 'GPU' || session.pose.modelUrl !== POSE_MODEL_URL ||
      Object.entries(POSE_VIDEO_OPTIONS).some(([key, value]) => session.pose.settings[key] !== value)) {
    throw new Error('FULL_VIDEO control requires the recorded Full / VIDEO / GPU configuration.');
  }
  if (session.validation?.status !== 'VALIDATION_CAPTURE_COMPLETE') throw new Error('INVALID_CAPTURE: incomplete validation capture.');
  return identity;
}
export function acceptTimestamp(timestamps: number[], timestamp: number) {
  if (!Number.isFinite(timestamp) || timestamp < 0 || timestamps.length && timestamp <= timestamps.at(-1)!) {
    throw new Error('Decoded PTS must be finite, nonnegative and strictly increasing; frames are never silently dropped.');
  }
  timestamps.push(timestamp);
}
export async function frameSequence(timestamps: readonly number[]) {
  if (!timestamps.length) throw new Error('WebM contains no decoded video frames.');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(timestamps)));
  return { decodedFrameCount: timestamps.length, firstTimestamp: timestamps[0], lastTimestamp: timestamps.at(-1)!,
    timestampHash: Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join(''), timestampUnit: 'media PTS milliseconds' as const };
}
export interface FramePlan { timestamps: number[]; sequence: Awaited<ReturnType<typeof frameSequence>> }
export function verifyFrameSequence(plan: FramePlan, timestamps: readonly number[]) {
  if (plan.timestamps.length !== timestamps.length || timestamps.some((t, i) => t !== plan.timestamps[i])) throw new Error('Decoded frame sequence mismatch. Comparison refused.');
}
function check(signal: AbortSignal) { if (signal.aborted) throw replayAborted(); }
async function yieldForCancel(signal: AbortSignal) { check(signal); await new Promise<void>((r) => setTimeout(r, 0)); check(signal); }
export async function decodeEstimatorFrames(file: File, session: ReplaySession, signal: AbortSignal, progress: (count: number) => void = () => {}, cache = new ReplayMediaValidationCache()) {
  if (session.version === 2) await validateEstimatorMediaArtifact(session, file, signal, cache); else validateEstimatorMedia(session, file); check(signal);
  const timestamps: number[] = [];
  for await (const frame of decodeWebMFrames(file, signal)) {
    try { check(signal); verifyMediaDimensions(session, frame); acceptTimestamp(timestamps, frame.timestamp * 1000); }
    finally { frame.close(); }
    if (timestamps.length % 30 === 0) { progress(timestamps.length); await yieldForCancel(signal); }
  }
  check(signal);
  const sequence = await frameSequence(timestamps); check(signal); verifyMediaSequence(session, sequence);
  return { timestamps, sequence };
}
export type EstimatorPoseFrame = ReplayPoseFrame & { posePresent: boolean; inferenceMs: number };
export async function runEstimator(file: File, session: ReplaySession, variant: EstimatorVariant, plan: FramePlan,
  signal: AbortSignal, progress: (count: number) => void = () => {}, cache = new ReplayMediaValidationCache()) {
  const mediaIdentity = session.version === 2 ? await validateEstimatorMediaArtifact(session, file, signal, cache) : validateEstimatorMedia(session, file); check(signal);
  verifyMediaSequence(session, plan.sequence);
  const canvas = document.createElement('canvas'), landmarker = await createEstimator(variant);
  try {
    check(signal);
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Cannot create estimator frame canvas.');
    const frames: EstimatorPoseFrame[] = [], timestamps: number[] = [], config = estimatorConfig(variant);
    for await (const frame of decodeWebMFrames(file, signal)) {
      try {
        check(signal);
        verifyMediaDimensions(session, frame);
        const timestamp = frame.timestamp * 1000;
        acceptTimestamp(timestamps, timestamp);
        if (timestamp !== plan.timestamps[frames.length]) throw new Error('Decoded frame sequence mismatch. Comparison refused.');
        canvas.width = frame.displayWidth; canvas.height = frame.displayHeight;
        frame.draw(ctx, 0, 0);
        const before = performance.now(); // Performance only; never detector/simulation time.
        const result = config.options.runningMode === 'IMAGE' ? landmarker.detect(canvas) : landmarker.detectForVideo(canvas, timestamp);
        try {
          const inferenceMs = performance.now() - before; check(signal);
          const landmarks = result.landmarks[0] ?? [], worldLandmarks = result.worldLandmarks[0] ?? [];
          frames.push({ ...copyPoseFrame({ timestamp, videoTime: frame.timestamp, landmarks, worldLandmarks }, 0, frames.length + 1),
            posePresent: landmarks.length > 0, inferenceMs });
        } finally { result.close(); }
      } finally { frame.close(); }
      if (frames.length % 10 === 0) progress(frames.length);
      await yieldForCancel(signal);
    }
    check(signal); verifyFrameSequence(plan, timestamps);
    const sequence = await frameSequence(timestamps); check(signal); verifyMediaSequence(session, sequence);
    return { variant, config, mediaIdentity, sequence, frames, frameSequenceParity: true as const,
      clock: 'decoded media PTS * 1000 = existing VIDEO replay capture tMs mapping' as const };
  } finally { landmarker.close(); canvas.width = 0; canvas.height = 0; }
}
export type EstimatorRun = Awaited<ReturnType<typeof runEstimator>>;
