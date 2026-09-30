import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { createPoseLandmarker, POSE_VIDEO_OPTIONS } from '../pose/createPoseLandmarker';
import { POSE_MODEL_URL } from '../pose/poseConstants';
import { inferReplayVideo } from './videoReplay';
import { decodeWebMFrames, type DecodedVideoFrame } from './decodedVideoSource';
import { motionFrame } from '../pose/motion/testFixtures';
import type { ReplaySession } from './replayTypes';
import { fullTrial } from './testFixtures';
import { replayLandmarks } from './landmarkReplay';

vi.mock('../pose/createPoseLandmarker', async (original) => ({ ...await original<typeof import('../pose/createPoseLandmarker')>(), createPoseLandmarker: vi.fn() }));
vi.mock('./decodedVideoSource', async (original) => ({ ...await original<typeof import('./decodedVideoSource')>(), decodeWebMFrames: vi.fn() }));
let canvas: HTMLCanvasElement, clear: ReturnType<typeof vi.fn>;
let sourceClosed: ReturnType<typeof vi.fn<() => void>>;
let model: { detectForVideo: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
let samples: DecodedVideoFrame[];
const session = { pose: { delegate: 'CPU', modelUrl: POSE_MODEL_URL, settings: POSE_VIDEO_OPTIONS },
  video: { nominalFrameRate: 30 }, timing: { durationMs: 22000 } } as unknown as ReplaySession;
function timeline(times: number[]) {
  samples = times.map((time) => ({ timestamp: time / 1000, displayWidth: 1280, displayHeight: 720, draw: vi.fn(), close: vi.fn() }));
  vi.mocked(decodeWebMFrames).mockImplementation(async function* () { try { for (const sample of samples) yield sample; } finally { sourceClosed(); } });
}
function run(signal = new AbortController().signal, captured = session) {
  return inferReplayVideo(canvas, new File(['video'], 'test.webm'), captured, signal);
}
beforeEach(() => {
  canvas = document.createElement('canvas'); clear = vi.fn(); sourceClosed = vi.fn();
  vi.spyOn(canvas, 'getContext').mockReturnValue({ clearRect: clear } as unknown as CanvasRenderingContext2D);
  model = { detectForVideo: vi.fn(() => {
    const frame = motionFrame(0);
    return { landmarks: [frame.landmarks], worldLandmarks: [frame.worldLandmarks], close: vi.fn() };
  }), close: vi.fn() };
  vi.mocked(createPoseLandmarker).mockResolvedValue({ landmarker: model as unknown as PoseLandmarker, delegate: 'CPU' });
  timeline([0, 33, 66, 100, 133]);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => { throw new Error('presentation clock forbidden'); }));
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:unused') });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe('frame-complete sequential video replay', () => {
  it('processes EVERY source timestamp with 50ms inference per frame, concurrency 1, no wall-clock or callback-now dependence', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => { throw new Error('presentation clock forbidden'); }));
    let active = 0, maxActive = 0, completed = 0;
    const frame = motionFrame(0);
    const result = { landmarks: [frame.landmarks], worldLandmarks: [frame.worldLandmarks] };
    model.detectForVideo.mockImplementation(async () => {
      expect(completed).toBe(model.detectForVideo.mock.calls.length - 1);
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 50));
      active--; completed++; return { ...result, close: vi.fn() };
    });
    vi.spyOn(performance, 'now').mockImplementation(() => { throw new Error('wall clock forbidden'); });
    // Even if a presentation callback could report 999999, none is registered or consulted.
    const callback = vi.fn(() => 999999);
    Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', { configurable: true, value: callback });
    const promise = run(); await vi.runAllTimersAsync(); const output = await promise;
    expect(model.detectForVideo.mock.calls.map((call) => call[1])).toEqual([0, 33, 66, 100, 133]);
    expect(output.frames.map((frame) => frame.tMs)).toEqual([0, 33, 66, 100, 133]);
    expect(maxActive).toBe(1); expect(completed).toBe(5); expect(callback).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(output.diagnostics).toMatchObject({ decodedFrameCount: 5, processedFrameCount: 5, skippedFrameCount: 0,
      duplicateMediaTimestampCount: 0, firstMediaTimestampMs: 0, lastMediaTimestampMs: 133, medianFrameIntervalMs: 33, maxFrameIntervalMs: 34 });
    for (const sample of samples) expect(sample.close).toHaveBeenCalledOnce();
    expect(sourceClosed).toHaveBeenCalledOnce(); expect(model.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves decoded mediaTime, counts duplicates separately from nonmonotonic/invalid frames, and deep-copies before close', async () => {
    timeline([1234, 1234, 1200, 1300, 1234, NaN, -1]);
    model.detectForVideo.mockImplementation(() => {
      const frame = motionFrame(0);
      return { landmarks: [frame.landmarks], worldLandmarks: [frame.worldLandmarks], close: vi.fn(() => { frame.landmarks[0].x = 999; }) };
    });
    const output = await run();
    expect(output.frames.map((frame) => frame.tMs)).toEqual([1234, 1300]);
    expect(output.frames[0].landmarks[0].x).toBe(0.5);
    expect(output.diagnostics).toMatchObject({ decodedFrameCount: 7, processedFrameCount: 2, duplicateFrameCount: 2,
      duplicateMediaTimestampCount: 2, skippedFrameCount: 3, outOfOrderMediaTimestampCount: 1, invalidMediaTimestampCount: 2 });
    expect(createPoseLandmarker).toHaveBeenCalledWith('CPU'); expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledWith(0, 0, 1280, 720);
  });
  it('feeds detector event timestamps from decoded frames and preserves production functional behavior', async () => {
    const { session: captured } = await fullTrial(); timeline(captured.poseFrames.map((frame) => frame.tMs));
    for (const frame of captured.poseFrames) model.detectForVideo.mockReturnValueOnce({ landmarks: [frame.landmarks], worldLandmarks: [frame.worldLandmarks], close: vi.fn() });
    const output = await run(undefined, captured), result = replayLandmarks(captured, 1, output.frames, 'VIDEO');
    expect(result.result.events.map((event) => [event.direction, Math.round(event.tMs)])).toEqual(captured.liveResult.trials[0].result.events.map((event) => [event.direction, event.tMs]));
    expect(output.diagnostics.processedFrameCount).toBe(captured.poseFrames.length);
  });
  it('never falls back to playback/RAF when WebCodecs or decoding fails', async () => {
    vi.mocked(decodeWebMFrames).mockImplementation(async function* () { throw new Error('codec unavailable'); });
    await expect(run()).rejects.toThrow('codec unavailable');
    expect(model.close).toHaveBeenCalledOnce(); expect(model.detectForVideo).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled(); expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it.each(['abort', 'decode', 'inference'] as const)('closes the owned model, current frame and iterator on %s', async (kind) => {
    const controller = new AbortController();
    if (kind === 'decode') vi.mocked(decodeWebMFrames).mockImplementation(async function* () {
      try { yield samples[0]; throw new Error('decode failed'); } finally { sourceClosed(); }
    });
    if (kind === 'inference') model.detectForVideo.mockImplementationOnce(() => { throw new Error('inference'); });
    if (kind === 'abort') model.detectForVideo.mockImplementationOnce(() => { controller.abort(); return { landmarks: [], worldLandmarks: [], close: vi.fn() }; });
    await expect(run(controller.signal)).rejects.toHaveProperty('message');
    expect(model.close).toHaveBeenCalledOnce(); expect(sourceClosed).toHaveBeenCalledOnce();
    expect(samples[0].close).toHaveBeenCalledOnce(); expect(model.detectForVideo).toHaveBeenCalledOnce();
    if (kind === 'abort') expect(model.detectForVideo.mock.results[0].value.close).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalled();
  });
  it('finishes an in-flight inference before releasing its result on cancel, without starting the next frame', async () => {
    vi.useFakeTimers(); const controller = new AbortController(); const close = vi.fn();
    model.detectForVideo.mockImplementation(async () => {
      setTimeout(() => controller.abort(), 10);
      await new Promise((resolve) => setTimeout(resolve, 50)); return { landmarks: [], worldLandmarks: [], close };
    });
    const promise = run(controller.signal), rejected = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await vi.runAllTimersAsync(); await rejected;
    expect(close).toHaveBeenCalledOnce(); expect(model.detectForVideo).toHaveBeenCalledOnce();
    expect(samples[0].close).toHaveBeenCalledOnce(); expect(model.close).toHaveBeenCalledOnce(); expect(sourceClosed).toHaveBeenCalledOnce();
  });
  it('closes an asynchronously initialized model after cancellation before opening any source', async () => {
    let resolve!: (result: Awaited<ReturnType<typeof createPoseLandmarker>>) => void;
    vi.mocked(createPoseLandmarker).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const controller = new AbortController(), promise = run(controller.signal);
    controller.abort(); resolve({ landmarker: model as unknown as PoseLandmarker, delegate: 'CPU' });
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(model.close).toHaveBeenCalledOnce(); expect(decodeWebMFrames).not.toHaveBeenCalled();
  });
  it('rejects model/settings or delegate mismatch and releases initialized resources', async () => {
    await expect(run(undefined, { ...session, pose: { ...session.pose, modelUrl: 'other' } })).rejects.toThrow('모델/설정');
    vi.mocked(createPoseLandmarker).mockResolvedValueOnce({ landmarker: model as unknown as PoseLandmarker, delegate: 'GPU' });
    await expect(run()).rejects.toThrow('delegate'); expect(model.close).toHaveBeenCalledOnce();
  });
});
