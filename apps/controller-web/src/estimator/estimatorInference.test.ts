import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { createEstimator, estimatorConfig, ESTIMATOR_VARIANTS } from './estimatorConfig';
import { acceptTimestamp, decodeEstimatorFrames, frameSequence, runEstimator, validateEstimatorMedia, verifyFrameSequence } from './estimatorInference';
import { decodeWebMFrames, type DecodedVideoFrame } from '../replay/decodedVideoSource';
import { POSE_VIDEO_OPTIONS } from '../pose/createPoseLandmarker';
import { POSE_MODEL_URL } from '../pose/poseConstants';
import type { ReplaySession } from '../replay/replayTypes';
import { motionFrame } from '../pose/motion/testFixtures';
vi.mock('./estimatorConfig', async (original) => ({ ...await original<typeof import('./estimatorConfig')>(), createEstimator: vi.fn() }));
vi.mock('../replay/decodedVideoSource', async (original) => ({ ...await original<typeof import('../replay/decodedVideoSource')>(), decodeWebMFrames: vi.fn() }));
const id = 'plank-stork-replay-2026-10-05T14-37-39-718Z';
const session = { captureId: id, video: { filename: `${id}.webm` }, pose: { delegate: 'GPU', modelUrl: POSE_MODEL_URL, settings: POSE_VIDEO_OPTIONS } } as unknown as ReplaySession;
const file = () => new File(['video'], `${id}.webm`);
let samples: DecodedVideoFrame[], resultClose: ReturnType<typeof vi.fn>, iteratorClose: ReturnType<typeof vi.fn<() => void>>;
let model: { detect: ReturnType<typeof vi.fn>; detectForVideo: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
function source(times = [0, 33, 67, 100]) {
  samples = times.map((t) => ({ timestamp: t / 1000, displayWidth: 1280, displayHeight: 720, draw: vi.fn(), close: vi.fn() }));
  vi.mocked(decodeWebMFrames).mockImplementation(async function* () { try { for (const s of samples) yield s; } finally { iteratorClose(); } });
}
const plan = async (times = [0, 33, 67, 100]) => ({ timestamps: times, sequence: await frameSequence(times) });
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); resultClose = vi.fn(); iteratorClose = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  const result = () => { const f = motionFrame(0); return { landmarks: [f.landmarks], worldLandmarks: [f.worldLandmarks], close: resultClose }; };
  model = { detect: vi.fn(result), detectForVideo: vi.fn(result), close: vi.fn() };
  vi.mocked(createEstimator).mockResolvedValue(model as unknown as PoseLandmarker); source();
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => { throw new Error('forbidden presentation clock'); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe('STEP4O identical streaming media experiments', () => {
  it('keeps production config intact, with only Full IMAGE or Heavy VIDEO differences', () => {
    const before = JSON.stringify(POSE_VIDEO_OPTIONS);
    const configs = ESTIMATOR_VARIANTS.map(estimatorConfig);
    expect(configs.map((c) => c.options.runningMode)).toEqual(['VIDEO', 'IMAGE', 'VIDEO']);
    expect(configs[0].options.baseOptions.modelAssetPath).toBe(POSE_MODEL_URL);
    expect(configs[1].options.baseOptions).toEqual(configs[0].options.baseOptions);
    expect(configs[2].options.baseOptions.modelAssetPath).toContain('pose_landmarker_heavy/float16/1/');
    expect(configs.every((c) => c.options.baseOptions.delegate === 'GPU')).toBe(true);
    expect(JSON.stringify(POSE_VIDEO_OPTIONS)).toBe(before); expect(POSE_VIDEO_OPTIONS.runningMode).toBe('VIDEO');
  });
  it('decodes a plan without inference and closes all frames', async () => {
    const decoded = await decodeEstimatorFrames(file(), session, new AbortController().signal);
    expect(decoded.timestamps).toEqual([0, 33, 67, 100]); expect(decoded.sequence.timestampHash).toHaveLength(64);
    expect(createEstimator).not.toHaveBeenCalled(); samples.forEach((s) => expect(s.close).toHaveBeenCalledOnce());
  });
  it.each(ESTIMATOR_VARIANTS)('%s preserves every PTS and uses the matching synchronous API', async (variant) => {
    vi.spyOn(performance, 'now').mockReturnValue(987654321);
    const run = await runEstimator(file(), session, variant, await plan(), new AbortController().signal);
    expect(run.frames.map((f) => f.tMs)).toEqual([0, 33, 67, 100]); expect(run.frames.every((f) => f.inferenceMs === 0)).toBe(true);
    expect(run.sequence).toEqual((await plan()).sequence); expect(run.frameSequenceParity).toBe(true);
    const api = variant === 'FULL_IMAGE' ? model.detect : model.detectForVideo;
    expect(api).toHaveBeenCalledTimes(4); expect(variant === 'FULL_IMAGE' ? model.detectForVideo : model.detect).not.toHaveBeenCalled();
    if (variant !== 'FULL_IMAGE') expect(api.mock.calls.map((c) => c[1])).toEqual([0, 33, 67, 100]);
    samples.forEach((s) => expect(s.close).toHaveBeenCalledOnce()); expect(resultClose).toHaveBeenCalledTimes(4);
    expect(model.close).toHaveBeenCalledOnce(); expect(iteratorClose).toHaveBeenCalledOnce(); expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
  it('does not retain SDK result objects or substitute zero for a missing pose', async () => {
    const f = motionFrame(0);
    model.detectForVideo.mockReturnValueOnce({ landmarks: [f.landmarks], worldLandmarks: [], close: () => { f.landmarks[0].x = 1000; } });
    model.detectForVideo.mockReturnValueOnce({ landmarks: [], worldLandmarks: [], close: resultClose });
    const run = await runEstimator(file(), session, 'FULL_VIDEO_CONTROL', await plan(), new AbortController().signal);
    expect(run.frames[0].landmarks[0].x).toBe(.5); expect(run.frames[0].worldLandmarks).toEqual([]);
    expect(run.frames[1]).toMatchObject({ posePresent: false, landmarks: [], worldLandmarks: [] });
  });
  it.each([{ times: [0, 33, 33] }, { times: [0, 33, 20] }, { times: [0, NaN] }, { times: [-1] }])('rejects invalid or reordered sequence %j', async ({ times }) => {
    source(times); await expect(decodeEstimatorFrames(file(), session, new AbortController().signal)).rejects.toThrow('strictly increasing');
    expect(iteratorClose).toHaveBeenCalledOnce(); expect(samples.at(-1)!.close).toHaveBeenCalledOnce();
  });
  it('rejects missing and extra decoded frames instead of accepting a partial comparison', async () => {
    source([0, 33]); await expect(runEstimator(file(), session, 'FULL_IMAGE', await plan(), new AbortController().signal)).rejects.toThrow('sequence mismatch');
    source([0, 33, 67, 100, 130]); await expect(runEstimator(file(), session, 'FULL_IMAGE', await plan(), new AbortController().signal)).rejects.toThrow('sequence mismatch');
    expect(model.close).toHaveBeenCalledTimes(2); expect(samples.at(-1)!.close).toHaveBeenCalledOnce();
  });
  it('rejects filename or capture ID mismatch before decoding', () => {
    expect(() => validateEstimatorMedia(session, new File([], 'renamed.webm'))).toThrow('다른 capture');
    expect(() => validateEstimatorMedia({ ...session, captureId: 'different' }, file())).toThrow('다른 capture');
    expect(decodeWebMFrames).not.toHaveBeenCalled();
  });
  it('rejects a noncontrol recorded model, mode or delegate', () => {
    for (const pose of [{ ...session.pose, delegate: 'CPU' as const }, { ...session.pose, modelUrl: 'other' }, { ...session.pose, settings: { ...POSE_VIDEO_OPTIONS, numPoses: 2 } }]) {
      expect(() => validateEstimatorMedia({ ...session, pose }, file())).toThrow('configuration');
    }
  });
  it.each(['cancel', 'inference', 'decode'])('cleans model, iterator and owned frame on %s', async (kind) => {
    const controller = new AbortController();
    if (kind === 'cancel') model.detect.mockImplementationOnce(() => { controller.abort(); return { landmarks: [], worldLandmarks: [], close: resultClose }; });
    if (kind === 'inference') model.detect.mockImplementationOnce(() => { throw new Error('inference failed'); });
    if (kind === 'decode') vi.mocked(decodeWebMFrames).mockImplementation(async function* () { try { yield samples[0]; throw new Error('decode failed'); } finally { iteratorClose(); } });
    await expect(runEstimator(file(), session, 'FULL_IMAGE', await plan(), controller.signal)).rejects.toHaveProperty('message');
    expect(model.close).toHaveBeenCalledOnce(); expect(samples[0].close).toHaveBeenCalledOnce(); expect(iteratorClose).toHaveBeenCalledOnce();
    if (kind === 'cancel') expect(resultClose).toHaveBeenCalledOnce();
  });
  it('cancels during initialization and closes the eventual model without decoding', async () => {
    let resolve!: (p: PoseLandmarker) => void;
    vi.mocked(createEstimator).mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const controller = new AbortController(), run = runEstimator(file(), session, 'FULL_IMAGE', await plan(), controller.signal);
    controller.abort(); resolve(model as unknown as PoseLandmarker);
    await expect(run).rejects.toMatchObject({ name: 'AbortError' }); expect(model.close).toHaveBeenCalledOnce(); expect(decodeWebMFrames).not.toHaveBeenCalled();
  });
  it('same variant/input is identical for deterministic mock inference; performance is excluded', async () => {
    const a = await runEstimator(file(), session, 'FULL_IMAGE', await plan(), new AbortController().signal);
    const b = await runEstimator(file(), session, 'FULL_IMAGE', await plan(), new AbortController().signal);
    expect(a.frames.map(({ inferenceMs: _ms, ...f }) => f)).toEqual(b.frames.map(({ inferenceMs: _ms, ...f }) => f));
    expect(a.sequence).toEqual(b.sequence);
  });
  it('refuses empty plans and exact sequence substitutions despite equal lengths', async () => {
    await expect(frameSequence([])).rejects.toThrow('no decoded'); expect(() => verifyFrameSequence({ timestamps: [0, 33], sequence: {} as never }, [0, 34])).toThrow('mismatch');
    const times: number[] = []; acceptTimestamp(times, 0); expect(() => acceptTimestamp(times, 0)).toThrow('strictly');
  });
});
