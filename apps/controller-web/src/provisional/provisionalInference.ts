import { decodeWebMFrames, replayAborted } from '../replay/decodedVideoSource';
import { copyPoseFrame } from '../replay/replayTypes';
import { createEstimator, type EstimatorVariant } from '../estimator/estimatorConfig';
import { acceptTimestamp, frameSequence, verifyFrameSequence, type EstimatorPoseFrame, type FramePlan } from '../estimator/estimatorInference';
import { assertProvisionalPair, assertVariant, canonical, PAIRING_LIMITATION, PROVISIONAL_PROVENANCE, provisionalConfig, sha256, type ProvisionalPair } from './provisionalContract';

interface PoseCache { mediaId: string; config: ReturnType<typeof provisionalConfig>; sequence: FramePlan['sequence']; frames: EstimatorPoseFrame[]; frameSequenceParity: true }
export async function validateFullVideoCache(cache: unknown, mediaHash: string, plan: FramePlan) {
  try {
    const c = cache as PoseCache;
    if (!c || c.mediaId !== mediaHash) throw new Error('WebM SHA-256 mismatch.');
    if (canonical(c.config) !== canonical(provisionalConfig('FULL_VIDEO_CONTROL'))) throw new Error('Variant/model URL/runningMode/delegate/config mismatch.');
    if (!c.frameSequenceParity || canonical(c.sequence) !== canonical(plan.sequence)) throw new Error('Decoded sequence metadata mismatch.');
    const times: number[] = [];
    for (const f of c.frames) {
      acceptTimestamp(times, f.tMs);
      if (!Number.isFinite(f.inferenceMs) || f.inferenceMs < 0 || !Array.isArray(f.landmarks) || !Array.isArray(f.worldLandmarks)) throw new Error('Malformed cached frame.');
      for (const points of [f.landmarks, f.worldLandmarks]) {
        if (![0, 33].includes(points.length) || points.some((p) => ![p.x, p.y, p.z].every(Number.isFinite) || p.visibility !== null && !Number.isFinite(p.visibility))) throw new Error('Malformed cached landmarks.');
      }
    }
    verifyFrameSequence(plan, times);
    if (canonical(await frameSequence(times)) !== canonical(plan.sequence)) throw new Error('Decoded timestamp hash mismatch.');
    return { valid: true as const, reason: null, cache: c };
  } catch (cause) { return { valid: false as const, reason: cause instanceof Error ? cause.message : String(cause), cache: null }; }
}
export async function validateProvisionalFile(pair: ProvisionalPair, file: File) {
  assertProvisionalPair(pair);
  if (file.name.normalize('NFC') !== pair.webmFilename) throw new Error('Fixed provisional filename mismatch; do not rename media.');
  const hash = await sha256(await file.arrayBuffer());
  if (hash !== pair.webmSha256) throw new Error('Provisional WebM content hash mismatch.');
  return hash;
}

/** Explicit analysis-only entry. No general replay caller imports this module. */
export async function runProvisionalEstimatorAnalysis(pair: ProvisionalPair, file: File, variant: EstimatorVariant, plan: FramePlan,
  signal: AbortSignal, progress: (count: number) => void = () => {}, fullVideoCache?: unknown) {
  assertProvisionalPair(pair); assertVariant(variant);
  const check = () => { if (signal.aborted) throw replayAborted(); }; check();
  const mediaId = await validateProvisionalFile(pair, file); check();
  const plannedSequence = await frameSequence(plan.timestamps);
  if (canonical(plannedSequence) !== canonical(plan.sequence)) throw new Error('INVALID_FRAME_SEQUENCE: inconsistent decode plan.');
  const config = provisionalConfig(variant), mediaIdentity = { ...pair, selectedFilename: file.name, limitation: PAIRING_LIMITATION };
  const reused = variant === 'FULL_VIDEO_CONTROL' && fullVideoCache !== undefined ? await validateFullVideoCache(fullVideoCache, mediaId, plan) : null;
  check();
  if (reused?.valid) return { ...PROVISIONAL_PROVENANCE, variant, config, mediaIdentity, mediaId, frames: reused.cache.frames, sequence: plannedSequence,
    frameSequenceParity: true as const, clock: 'decoded media PTS * 1000 = existing VIDEO replay capture tMs mapping' as const,
    cacheReuse: { reused: true, rejection: null as string | null } };
  const canvas = document.createElement('canvas'), model = await createEstimator(variant);
  try {
    check(); const context = canvas.getContext('2d'); if (!context) throw new Error('Cannot create provisional frame canvas.');
    const frames: EstimatorPoseFrame[] = [], timestamps: number[] = [];
    for await (const frame of decodeWebMFrames(file, signal)) {
      try {
        check(); const timestamp = frame.timestamp * 1000; acceptTimestamp(timestamps, timestamp);
        if (timestamp !== plan.timestamps[frames.length]) throw new Error('INVALID_FRAME_SEQUENCE: decoded PTS differs from plan.');
        canvas.width = frame.displayWidth; canvas.height = frame.displayHeight; frame.draw(context, 0, 0);
        const before = performance.now();
        const result = variant === 'FULL_IMAGE' ? model.detect(canvas) : model.detectForVideo(canvas, timestamp);
        try {
          const inferenceMs = performance.now() - before; check();
          const landmarks = result.landmarks[0] ?? [], worldLandmarks = result.worldLandmarks[0] ?? [];
          frames.push({ ...copyPoseFrame({ timestamp, videoTime: frame.timestamp, landmarks, worldLandmarks }, 0, frames.length + 1), posePresent: landmarks.length > 0, inferenceMs });
        } finally { result.close(); }
      } finally { frame.close(); }
      if (frames.length % 100 === 0) progress(frames.length);
      await new Promise<void>((resolve) => setTimeout(resolve, 0)); check();
    }
    if (timestamps.length !== plan.timestamps.length) throw new Error('INVALID_FRAME_SEQUENCE: decoded frame count mismatch.');
    verifyFrameSequence(plan, timestamps); check();
    const sequence = await frameSequence(timestamps); check();
    return { ...PROVISIONAL_PROVENANCE, variant, config, mediaIdentity, mediaId, frames, sequence, frameSequenceParity: true as const,
      clock: 'decoded media PTS * 1000 = existing VIDEO replay capture tMs mapping' as const, cacheReuse: { reused: false, rejection: reused?.reason ?? null } };
  } finally { model.close(); canvas.width = 0; canvas.height = 0; }
}
export type ProvisionalRun = Awaited<ReturnType<typeof runProvisionalEstimatorAnalysis>>;
