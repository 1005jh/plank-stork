// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { createPoseLandmarker } from './createPoseLandmarker';
import { POSE_MODEL_URL, VISION_WASM_URL } from './poseConstants';

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn() },
  PoseLandmarker: { createFromOptions: vi.fn() },
}));

describe('Pose initialization diagnostics and fallback', () => {
  const vision = { wasmLoaderPath: 'loader.js', wasmBinaryPath: 'vision.wasm' };
  const landmarker = { close: vi.fn() } as unknown as PoseLandmarker;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(FilesetResolver.forVisionTasks).mockResolvedValue(vision);
  });

  afterEach(() => vi.restoreAllMocks());

  it('pins WASM to the installed package version and uses Full model version 1', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(manifest.dependencies['@mediapipe/tasks-vision']).toBe('1.0.1');
    expect(VISION_WASM_URL).toBe(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${manifest.dependencies['@mediapipe/tasks-vision']}/wasm`);
    expect(POSE_MODEL_URL).toBe('https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task');
  });

  it('logs each stage and uses GPU without attempting CPU when successful', async () => {
    vi.mocked(PoseLandmarker.createFromOptions).mockResolvedValueOnce(landmarker);
    await expect(createPoseLandmarker()).resolves.toEqual({ landmarker, delegate: 'GPU' });
    expect(FilesetResolver.forVisionTasks).toHaveBeenCalledWith(VISION_WASM_URL);
    expect(PoseLandmarker.createFromOptions).toHaveBeenCalledExactlyOnceWith(vision, {
      baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5, outputSegmentationMasks: false,
    });
    expect(vi.mocked(console.info).mock.calls.map(([stage]) => stage)).toEqual([
      '[Pose] WASM_LOADING', '[Pose] WASM_READY', '[Pose] MODEL_LOADING',
      '[Pose] GPU_INITIALIZING', '[Pose] POSE_READY',
    ]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('logs the original GPU error and retries exactly once with CPU', async () => {
    const gpuError = new Error('WebGL context creation failed');
    vi.mocked(PoseLandmarker.createFromOptions)
      .mockRejectedValueOnce(gpuError)
      .mockResolvedValueOnce(landmarker);
    await expect(createPoseLandmarker()).resolves.toEqual({ landmarker, delegate: 'CPU' });
    expect(console.warn).toHaveBeenCalledWith('[Pose] GPU initialization failed; falling back to CPU', gpuError);
    const calls = vi.mocked(PoseLandmarker.createFromOptions).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual([vision, {
      ...calls[0][1], baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: 'CPU' },
    }]);
    expect(console.info).toHaveBeenCalledWith('[Pose] CPU_INITIALIZING');
    expect(console.info).toHaveBeenLastCalledWith('[Pose] POSE_READY', { delegate: 'CPU' });
  });

  it('propagates the original CPU error without further retries or a ready log', async () => {
    const cpuError = new Error('Failed to load model: HTTP 404');
    vi.mocked(PoseLandmarker.createFromOptions)
      .mockRejectedValueOnce(new Error('GPU failed'))
      .mockRejectedValueOnce(cpuError);
    await expect(createPoseLandmarker()).rejects.toBe(cpuError);
    expect(PoseLandmarker.createFromOptions).toHaveBeenCalledTimes(2);
    expect(console.info).not.toHaveBeenCalledWith('[Pose] POSE_READY', expect.anything());
  });

  it('propagates a WASM resolver error before attempting either delegate', async () => {
    const wasmError = new Error('WASM resolver failed');
    vi.mocked(FilesetResolver.forVisionTasks).mockRejectedValueOnce(wasmError);
    await expect(createPoseLandmarker()).rejects.toBe(wasmError);
    expect(PoseLandmarker.createFromOptions).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledWith('[Pose] WASM_LOADING', { wasmUrl: VISION_WASM_URL });
  });
});
