import { File as NodeFile, Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeWebMFrames, type DecodedVideoFrame } from './decodedVideoSource';
import { finalizeMediaArtifact, ReplayMediaValidationCache } from './mediaArtifact';
import { createPoseLandmarker } from '../pose/createPoseLandmarker';
import { createEstimator } from '../estimator/estimatorConfig';
import { decodeEstimatorFrames, runEstimator } from '../estimator/estimatorInference';
import { inferReplayVideo } from './videoReplay';
import { readyCapture } from './v2TestFixtures';
import type { ReplaySession } from './replayTypes';
vi.mock('./decodedVideoSource', async (original) => ({ ...await original<typeof import('./decodedVideoSource')>(), decodeWebMFrames: vi.fn() }));
vi.mock('../pose/createPoseLandmarker', async (original) => ({ ...await original<typeof import('../pose/createPoseLandmarker')>(), createPoseLandmarker: vi.fn() }));
vi.mock('../estimator/estimatorConfig', async (original) => ({ ...await original<typeof import('../estimator/estimatorConfig')>(), createEstimator: vi.fn() }));
let session: ReplaySession, file: File, decoded: DecodedVideoFrame[], model: { detect: ReturnType<typeof vi.fn>; detectForVideo: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
const signal = () => new AbortController().signal;
beforeEach(async () => {
  vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('File', NodeFile); vi.stubGlobal('crypto', webcrypto);
  decoded = [0, .033, .067].map((timestamp) => ({ timestamp, displayWidth: 1280, displayHeight: 720, draw: vi.fn(), close: vi.fn() }));
  vi.mocked(decodeWebMFrames).mockImplementation(async function* () { yield* decoded; });
  const c = readyCapture(); c.kick.startTest(3101); c.capture.observe({ kind: 'START', timestamp: 3101 }, c.read);
  c.kick.getView(25101); c.capture.observe({ kind: 'CLOCK', timestamp: 25101 }, c.read); await c.capture.stop(25200);
  session = JSON.parse(c.capture.getFiles().json); session.pose.delegate = 'GPU';
  file = new File(['mock-webm'], 'renamed.webm'); session.video.integrity = await finalizeMediaArtifact(file, session.video, signal());
  const result = () => ({ landmarks: [], worldLandmarks: [], close: vi.fn() });
  model = { detect: vi.fn(result), detectForVideo: vi.fn(result), close: vi.fn() };
  vi.mocked(createPoseLandmarker).mockResolvedValue({ delegate: 'GPU', landmarker: model as never }); vi.mocked(createEstimator).mockResolvedValue(model as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: vi.fn() } as never);
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe('shared V2 validator in replay and estimator consumers', () => {
  it('accepts renamed VIDEO replay after hashing, without changing frame processing', async () => {
    const run = await inferReplayVideo(document.createElement('canvas'), file, session, signal());
    expect(run.frames.map((f) => f.tMs)).toEqual([0, 33, 67]); expect(model.detectForVideo).toHaveBeenCalledTimes(3);
    expect(model.close).toHaveBeenCalledOnce();
  });
  it('rejects corrupted bytes before initializing either model', async () => {
    const corrupted = new File(['Mock-webm'], session.video.filename);
    await expect(inferReplayVideo(document.createElement('canvas'), corrupted, session, signal())).rejects.toThrow('MEDIA_HASH_MISMATCH');
    await expect(runEstimator(corrupted, session, 'FULL_VIDEO_CONTROL', {} as never, signal())).rejects.toThrow('MEDIA_HASH_MISMATCH');
    expect(createPoseLandmarker).not.toHaveBeenCalled(); expect(createEstimator).not.toHaveBeenCalled();
  });
  it('hashes one selected File once across decode and all three mocked estimator runs', async () => {
    const bytes = vi.spyOn(file, 'arrayBuffer'), cache = new ReplayMediaValidationCache();
    const plan = await decodeEstimatorFrames(file, session, signal(), undefined, cache);
    for (const variant of ['FULL_VIDEO_CONTROL', 'FULL_IMAGE', 'HEAVY_VIDEO'] as const) {
      const result = await runEstimator(file, session, variant, plan, signal(), undefined, cache);
      expect(result.mediaIdentity).toMatchObject({ validation: 'CRYPTOGRAPHIC_MEDIA_MATCH', renamed: true }); expect(result.sequence).toEqual(plan.sequence);
    }
    expect(bytes).toHaveBeenCalledOnce(); expect(model.close).toHaveBeenCalledTimes(3);
  });
  it('checks actual variant decoded sequence/dimensions against the registered media manifest', async () => {
    const cache = new ReplayMediaValidationCache(), plan = await decodeEstimatorFrames(file, session, signal(), undefined, cache);
    decoded[1] = { ...decoded[1], displayHeight: 480 };
    await expect(runEstimator(file, session, 'FULL_IMAGE', plan, signal(), undefined, cache)).rejects.toThrow('MEDIA_DIMENSION_MISMATCH');
    decoded[1] = { ...decoded[1], displayHeight: 720, timestamp: .034 };
    await expect(decodeEstimatorFrames(file, session, signal(), undefined, cache)).rejects.toThrow('MEDIA_TIMESTAMP_MANIFEST_MISMATCH');
  });
  it('does not accept an incomplete capture as estimator hypothesis input', async () => {
    session.validation!.status = 'INCOMPLETE';
    await expect(decodeEstimatorFrames(file, session, signal())).rejects.toThrow('INVALID_CAPTURE'); expect(createEstimator).not.toHaveBeenCalled();
  });
});
