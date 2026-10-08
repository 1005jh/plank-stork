import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { createEstimator } from '../estimator/estimatorConfig';
import { frameSequence } from '../estimator/estimatorInference';
import { decodeWebMFrames, type DecodedVideoFrame } from '../replay/decodedVideoSource';
import { motionFrame } from '../pose/motion/testFixtures';
import { inferForensicMedia } from './forensicInference';
vi.mock('../estimator/estimatorConfig', async (original) => ({ ...await original<typeof import('../estimator/estimatorConfig')>(), createEstimator: vi.fn() }));
vi.mock('../replay/decodedVideoSource', async (original) => ({ ...await original<typeof import('../replay/decodedVideoSource')>(), decodeWebMFrames: vi.fn() }));
const file = () => new File(['video'], 'unverified-original-name.webm');
const times = [0, 33, 67];
let frames: DecodedVideoFrame[], close: ReturnType<typeof vi.fn>, iteratorClose: ReturnType<typeof vi.fn<() => void>>;
let model: { detect: ReturnType<typeof vi.fn>; detectForVideo: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
const plan = async () => ({ timestamps: times, sequence: await frameSequence(times) });
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); close = vi.fn(); iteratorClose = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => { throw new Error('Do not use presentation clock'); }));
  frames = times.map((t) => ({ timestamp: t / 1000, displayWidth: 1280, displayHeight: 720, draw: vi.fn(), close: vi.fn() }));
  vi.mocked(decodeWebMFrames).mockImplementation(async function* () { try { yield* frames; } finally { iteratorClose(); } });
  model = { detect: vi.fn(), detectForVideo: vi.fn(() => ({ landmarks: [motionFrame(0).landmarks], worldLandmarks: [], close })), close: vi.fn() };
  vi.mocked(createEstimator).mockResolvedValue(model as unknown as PoseLandmarker);
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
it('creates only Full VIDEO, processes every PTS, and marks its output unverified', async () => {
  const run = await inferForensicMedia(file(), 'hash', await plan(), new AbortController().signal);
  expect(createEstimator).toHaveBeenCalledExactlyOnceWith('FULL_VIDEO_CONTROL'); expect(model.detect).not.toHaveBeenCalled();
  expect(model.detectForVideo.mock.calls.map((c) => c[1])).toEqual(times); expect(run.frames.map((f) => f.tMs)).toEqual(times);
  expect(run.inputStatus).toBe('UNVERIFIED_FORENSIC_INPUT'); expect(run.sequence).toEqual((await plan()).sequence);
  expect(close).toHaveBeenCalledTimes(3); expect(model.close).toHaveBeenCalledOnce(); frames.forEach((f) => expect(f.close).toHaveBeenCalledOnce());
  expect(requestAnimationFrame).not.toHaveBeenCalled();
});
it('snapshots primitives before result close; missing pose stays empty', async () => {
  const raw = motionFrame(0).landmarks;
  model.detectForVideo.mockReturnValueOnce({ landmarks: [raw], worldLandmarks: [], close: () => { raw[0].x = 1000; } });
  model.detectForVideo.mockReturnValueOnce({ landmarks: [], worldLandmarks: [], close });
  const run = await inferForensicMedia(file(), 'hash', await plan(), new AbortController().signal);
  expect(run.frames[0].landmarks[0].x).toBe(.5); expect(run.frames[1]).toMatchObject({ posePresent: false, landmarks: [] });
});
it.each(['cancel', 'inference', 'decode'])('cleans resources on %s failure', async (kind) => {
  const c = new AbortController();
  if (kind === 'cancel') model.detectForVideo.mockImplementationOnce(() => { c.abort(); return { landmarks: [], worldLandmarks: [], close }; });
  if (kind === 'inference') model.detectForVideo.mockImplementationOnce(() => { throw new Error('inference'); });
  if (kind === 'decode') vi.mocked(decodeWebMFrames).mockImplementation(async function* () { try { yield frames[0]; throw new Error('decode'); } finally { iteratorClose(); } });
  await expect(inferForensicMedia(file(), 'hash', await plan(), c.signal)).rejects.toThrow();
  expect(model.close).toHaveBeenCalledOnce(); expect(iteratorClose).toHaveBeenCalledOnce(); expect(frames[0].close).toHaveBeenCalledOnce();
  if (kind === 'cancel') expect(close).toHaveBeenCalledOnce();
});
it('rejects missing decoded frames', async () => {
  frames.pop(); await expect(inferForensicMedia(file(), 'hash', await plan(), new AbortController().signal)).rejects.toThrow('sequence mismatch');
  expect(model.close).toHaveBeenCalledOnce();
});
it('rejects mismatched timestamps without dropping frames', async () => {
  frames[0] = { ...frames[0], timestamp: .01 }; await expect(inferForensicMedia(file(), 'hash', await plan(), new AbortController().signal)).rejects.toThrow('packet inventory');
  expect(frames[0].close).toHaveBeenCalledOnce(); expect(model.close).toHaveBeenCalledOnce();
});
it('does not start inference when already cancelled', async () => {
  const c = new AbortController(); c.abort(); await expect(inferForensicMedia(file(), 'hash', await plan(), c.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(createEstimator).not.toHaveBeenCalled();
});
