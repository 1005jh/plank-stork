// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeWebMFrames } from './decodedVideoSource';
import { finalizeMediaArtifact, hashBlob, inspectReplayMedia, ReplayMediaValidationCache, validateReplayMediaArtifact } from './mediaArtifact';
import { frameSequence } from '../estimator/estimatorInference';
import { createTestCapture, mockRecorder, captureCamera } from './testFixtures';
import { readReplaySession } from './readReplaySession';
import type { ReplaySession } from './replayTypes';
vi.mock('./decodedVideoSource', async (original) => ({ ...await original<typeof import('./decodedVideoSource')>(), decodeWebMFrames: vi.fn() }));
let frames: { timestamp: number; displayWidth: number; displayHeight: number; close: ReturnType<typeof vi.fn<() => void>>; draw: ReturnType<typeof vi.fn<() => void>> }[];
const signal = () => new AbortController().signal;
beforeEach(() => {
  frames = [0, .033, .081].map((timestamp) => ({ timestamp, displayWidth: 1280, displayHeight: 720, close: vi.fn(), draw: vi.fn() }));
  vi.mocked(decodeWebMFrames).mockImplementation(async function* () { yield* frames; }); vi.mocked(decodeWebMFrames).mockClear();
});
async function pair() {
  const capture = createTestCapture(); capture.start(captureCamera(), false, 0, mockRecorder); await capture.stop(100);
  const session = JSON.parse(capture.getFiles().json) as ReplaySession, blob = new Blob(['webm-test-bytes']);
  session.video.integrity = await finalizeMediaArtifact(blob, session.video, signal());
  return { session, blob, file: new File([blob], session.video.filename) };
}
describe('V2 exact media bytes and decoded manifest', () => {
  it('uses exact Blob SHA/size, ms PTS and the estimator timestamp encoding', async () => {
    const { blob, session, file } = await pair(), m = session.video.integrity!;
    expect(m.sha256).toMatch(/^[a-f0-9]{64}$/); expect(m.sha256).toBe(await hashBlob(blob, signal()));
    expect(m.byteLength).toBe(blob.size);
    expect(m).toMatchObject({ decodedFrameCount: 3, firstPtsMs: 0, lastPtsMs: 81, decodedWidth: 1280, decodedHeight: 720 });
    expect(m.timestampHash).toBe((await frameSequence([0, 33, 81])).timestampHash);
    expect(await validateReplayMediaArtifact(session, file, signal())).toMatchObject({ validation: 'CRYPTOGRAPHIC_MEDIA_MATCH', renamed: false });
    expect(frames.every((f) => f.close.mock.calls.length === 2)).toBe(true);
    expect(readReplaySession(JSON.stringify(session)).version).toBe(2);
  });
  it('accepts renamed exact bytes, rejects same-name one-byte changes', async () => {
    const { session, blob } = await pair();
    expect(await validateReplayMediaArtifact(session, new File([blob], 'renamed.webm'), signal())).toMatchObject({ renamed: true, validation: 'CRYPTOGRAPHIC_MEDIA_MATCH' });
    const bytes = new Uint8Array(await blob.arrayBuffer()); bytes[0] ^= 1;
    await expect(validateReplayMediaArtifact(session, new File([bytes], session.video.filename), signal())).rejects.toThrow('MEDIA_HASH_MISMATCH');
  });
  it('rejects size before hashing/decoding and still rejects a renamed V1 pair', async () => {
    const { session, file } = await pair(); session.video.integrity!.byteLength++;
    await expect(validateReplayMediaArtifact(session, file, signal())).rejects.toThrow('MEDIA_SIZE_MISMATCH');
    session.version = 1;
    await expect(validateReplayMediaArtifact(session, new File([], 'renamed.webm'), signal())).rejects.toThrow('Replay JSON과 다른 capture');
    expect(await validateReplayMediaArtifact(session, file, signal())).toMatchObject({ validation: 'EXISTING_FILENAME_CAPTURE_ID_GUARD' });
  });
  it.each(['decodedFrameCount', 'firstPtsMs', 'lastPtsMs', 'timestampHash', 'decodedWidth', 'decodedHeight'] as const)('rejects a changed %s manifest', async (key) => {
    const { session, file } = await pair();
    if (key === 'timestampHash') session.video.integrity![key] = '0'.repeat(64); else session.video.integrity![key]++;
    await expect(validateReplayMediaArtifact(session, file, signal())).rejects.toThrow(key.includes('Width') || key.includes('Height') ? 'MEDIA_DIMENSION_MISMATCH' : 'MEDIA_TIMESTAMP_MANIFEST_MISMATCH');
  });
  it.each(['duplicate', 'backwards', 'changed dimensions', 'camera mismatch', 'empty'] as const)('fails finalization on %s and closes every yielded frame', async (kind) => {
    if (kind === 'duplicate') frames[1].timestamp = 0;
    if (kind === 'backwards') frames[1].timestamp = -.01;
    if (kind === 'changed dimensions') frames[1].displayWidth = 640;
    if (kind === 'camera mismatch') frames.forEach((f) => { f.displayHeight = 480; });
    if (kind === 'empty') frames = [];
    await expect(finalizeMediaArtifact(new Blob(['x']), { filename: 'x.webm', width: 1280, height: 720 }, signal())).rejects.toThrow();
    if (frames.length) expect(frames[0].close).toHaveBeenCalledOnce();
    if (['duplicate', 'backwards', 'changed dimensions'].includes(kind)) expect(frames[1].close).toHaveBeenCalledOnce();
  });
  it('caches only the identical File object in one analysis, rechecks a new File and each manifest', async () => {
    const { session, file } = await pair(), cache = new ReplayMediaValidationCache();
    const digest = vi.spyOn(crypto.subtle, 'digest');
    await validateReplayMediaArtifact(session, file, signal(), cache); const calls = digest.mock.calls.length;
    await validateReplayMediaArtifact(session, file, signal(), cache); expect(digest).toHaveBeenCalledTimes(calls);
    await validateReplayMediaArtifact(session, new File([file], file.name), signal(), cache); expect(digest.mock.calls.length).toBeGreaterThan(calls);
    session.video.integrity!.timestampHash = '0'.repeat(64);
    await expect(validateReplayMediaArtifact(session, file, signal(), cache)).rejects.toThrow('MEDIA_TIMESTAMP_MANIFEST_MISMATCH'); digest.mockRestore();
  });
  it('honors abort during inspection and closes the current frame', async () => {
    const abort = new AbortController();
    vi.mocked(decodeWebMFrames).mockImplementation(async function* () { yield frames[0]; abort.abort(); yield frames[1]; });
    await expect(inspectReplayMedia(new File([], 'x.webm'), { width: 1280, height: 720 }, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(frames[0].close).toHaveBeenCalledOnce(); expect(frames[1].close).toHaveBeenCalledOnce();
  });
  it.each(['missing integrity', 'uppercase SHA', 'reference missing', 'false COMPLETE'] as const)('rejects malformed V2 JSON: %s', async (kind) => {
    const { session } = await pair();
    if (kind === 'missing integrity') delete session.video.integrity;
    if (kind === 'uppercase SHA') session.video.integrity!.sha256 = 'A'.repeat(64);
    if (kind === 'reference missing') session.validation!.trialHasEstimatorReference = true;
    if (kind === 'false COMPLETE') session.validation!.status = 'VALIDATION_CAPTURE_COMPLETE';
    expect(() => readReplaySession(JSON.stringify(session))).toThrow('Replay JSON');
  });
});
