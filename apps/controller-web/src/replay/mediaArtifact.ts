import { decodeWebMFrames, replayAborted } from './decodedVideoSource';
import { replayVideoSourceError, replayVideoSourceFromFilename } from './replayVideoSource';
import type { ReplaySession } from './replayTypes';

export interface VideoIntegrity {
  algorithm: 'SHA-256'; sha256: string; byteLength: number; decodedFrameCount: number; firstPtsMs: number; lastPtsMs: number;
  timestampHash: string; decodedWidth: number; decodedHeight: number; finalizedAt: string;
}
export const checkMediaAbort = (signal: AbortSignal) => { if (signal.aborted) throw replayAborted(); };
export async function hashBlob(blob: Blob, signal: AbortSignal) {
  checkMediaAbort(signal); const bytes = await blob.arrayBuffer(); checkMediaAbort(signal);
  const digest = await crypto.subtle.digest('SHA-256', bytes); checkMediaAbort(signal);
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}
export async function inspectReplayMedia(file: File, expected: { width: number; height: number }, signal: AbortSignal) {
  const times: number[] = []; let width = 0, height = 0;
  for await (const frame of decodeWebMFrames(file, signal)) {
    try {
      checkMediaAbort(signal); const t = frame.timestamp * 1000;
      if (!Number.isFinite(t) || t < 0 || times.length > 0 && t <= times.at(-1)!) throw new Error('INVALID_FRAME_SEQUENCE: PTS must strictly increase.');
      if (!times.length) { width = frame.displayWidth; height = frame.displayHeight; }
      if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error('MEDIA_DIMENSION_MISMATCH');
      if (width !== frame.displayWidth || height !== frame.displayHeight || width !== expected.width || height !== expected.height) throw new Error('MEDIA_DIMENSION_MISMATCH');
      times.push(t);
    } finally { frame.close(); }
    if (times.length % 30 === 0) { await new Promise<void>((r) => setTimeout(r, 0)); checkMediaAbort(signal); }
  }
  if (!times.length) throw new Error('INVALID_FRAME_SEQUENCE: no decoded frames.');
  // Exactly the estimator frameSequence encoding: JSON number array, UTF-8, SHA-256.
  const timestampHash = await hashBlob(new Blob([JSON.stringify(times)]), signal);
  return { decodedFrameCount: times.length, firstPtsMs: times[0], lastPtsMs: times.at(-1)!, timestampHash, decodedWidth: width, decodedHeight: height, timestamps: times };
}
export async function finalizeMediaArtifact(blob: Blob, video: { filename: string; width: number; height: number }, signal: AbortSignal,
  phase: (state: 'HASHING' | 'MEDIA_INSPECTION') => void = () => {}): Promise<VideoIntegrity> {
  phase('HASHING'); const sha256 = await hashBlob(blob, signal); phase('MEDIA_INSPECTION');
  const { timestamps: _times, ...manifest } = await inspectReplayMedia(new File([blob], video.filename, { type: blob.type }), video, signal);
  checkMediaAbort(signal);
  return { algorithm: 'SHA-256', sha256, byteLength: blob.size, ...manifest, finalizedAt: new Date().toISOString() };
}
/** File object identity only; each caller owns its short-lived analysis cache. No persistent metadata shortcuts. */
export class ReplayMediaValidationCache {
  private hashes = new WeakMap<File, string>();
  private inspections = new WeakMap<File, Awaited<ReturnType<typeof inspectReplayMedia>>>();
  async validate(session: ReplaySession, file: File, signal: AbortSignal, inspect = true) {
    checkMediaAbort(signal);
    const selected = replayVideoSourceFromFilename(file.name);
    if (session.version === 1) {
      const error = replayVideoSourceError({ filename: session.video.filename, sourceCaptureId: session.captureId }, selected);
      if (error) throw new Error(error);
      return { captureId: session.captureId, validation: 'EXISTING_FILENAME_CAPTURE_ID_GUARD' as const, renamed: false, selected, expectedFilename: session.video.filename };
    }
    const expected = session.video.integrity;
    if (!expected) throw new Error('MEDIA_INTEGRITY_MISSING');
    if (file.size !== expected.byteLength) throw new Error('MEDIA_SIZE_MISMATCH');
    const sha = this.hashes.get(file) ?? await hashBlob(file, signal); checkMediaAbort(signal); this.hashes.set(file, sha);
    if (sha !== expected.sha256) throw new Error('MEDIA_HASH_MISMATCH');
    if (inspect) {
      const actual = this.inspections.get(file) ?? await inspectReplayMedia(file, session.video, signal); checkMediaAbort(signal); this.inspections.set(file, actual);
      for (const key of ['decodedFrameCount', 'firstPtsMs', 'lastPtsMs', 'timestampHash', 'decodedWidth', 'decodedHeight'] as const) {
        if (actual[key] !== expected[key]) throw new Error(key.startsWith('decodedW') || key.startsWith('decodedH') ? 'MEDIA_DIMENSION_MISMATCH' : 'MEDIA_TIMESTAMP_MANIFEST_MISMATCH');
      }
      if (actual.decodedWidth !== session.video.width || actual.decodedHeight !== session.video.height) throw new Error('MEDIA_DIMENSION_MISMATCH');
    }
    return { captureId: session.captureId, validation: 'CRYPTOGRAPHIC_MEDIA_MATCH' as const, renamed: file.name !== session.video.filename,
      selected, expectedFilename: session.video.filename, sha256: sha, inspectionComplete: inspect };
  }
}
export function validateReplayMediaArtifact(session: ReplaySession, file: File, signal: AbortSignal, cache = new ReplayMediaValidationCache()) {
  return cache.validate(session, file, signal);
}

/** Recheck the actual inference pass too, so a changed decoder output cannot silently pass a cached inspection. */
export function verifyMediaSequence(session: ReplaySession, sequence: { decodedFrameCount: number; firstTimestamp: number; lastTimestamp: number; timestampHash: string }) {
  const m = session.video.integrity;
  if (session.version === 2 && (!m || sequence.decodedFrameCount !== m.decodedFrameCount || sequence.firstTimestamp !== m.firstPtsMs ||
    sequence.lastTimestamp !== m.lastPtsMs || sequence.timestampHash !== m.timestampHash)) throw new Error('MEDIA_TIMESTAMP_MANIFEST_MISMATCH');
}
export function verifyMediaDimensions(session: ReplaySession, frame: { displayWidth: number; displayHeight: number }) {
  if (session.version === 2 && (frame.displayWidth !== session.video.integrity?.decodedWidth || frame.displayHeight !== session.video.integrity?.decodedHeight)) throw new Error('MEDIA_DIMENSION_MISMATCH');
}
