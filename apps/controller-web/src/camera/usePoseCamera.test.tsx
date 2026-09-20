import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoseLandmarker, PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import { createPoseLandmarker } from '../pose/createPoseLandmarker';
import { usePoseCamera } from './usePoseCamera';
import { PoseDatasetRecorder } from '../recorder/poseDatasetRecorder';

const drawing = vi.hoisted(() => ({
  drawConnectors: vi.fn(), drawLandmarks: vi.fn(), close: vi.fn(),
}));
vi.mock('../pose/createPoseLandmarker', () => ({ createPoseLandmarker: vi.fn() }));
vi.mock('@mediapipe/tasks-vision', () => ({
  PoseLandmarker: { POSE_CONNECTIONS: [{ start: 11, end: 12 }] },
  DrawingUtils: class {
    drawConnectors = drawing.drawConnectors;
    drawLandmarks = drawing.drawLandmarks;
    close = drawing.close;
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('Pose camera lifecycle and measurement', () => {
  let root: Root;
  let container: HTMLDivElement;
  let camera: ReturnType<typeof usePoseCamera>;
  let now: number;
  let inferenceMs: number;
  let renderCount: number;
  let frameId: number;
  let frames: Map<number, FrameRequestCallback>;
  let track: { stop: ReturnType<typeof vi.fn>; onended: (() => void) | null };
  let stream: MediaStream;
  let getUserMedia: ReturnType<typeof vi.fn>;
  let model: { detectForVideo: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  let result: Pick<PoseLandmarkerResult, 'landmarks' | 'worldLandmarks' | 'close'>;
  let clearRect: ReturnType<typeof vi.fn>;
  let recorder: PoseDatasetRecorder;

  function Probe() {
    camera = usePoseCamera({
      onFrame: (frame) => recorder.recordFrame(frame),
      onCameraStopped: () => recorder.interrupt(),
    });
    renderCount++;
    return <><video ref={camera.videoRef} /><canvas ref={camera.canvasRef} /></>;
  }

  async function frame(time: number, videoTime: number) {
    now = time;
    camera.videoRef.current!.currentTime = videoTime;
    const pending = [...frames.values()];
    expect(pending).toHaveLength(1);
    frames.clear();
    await act(async () => pending[0](time));
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('isSecureContext', true);
    now = 0;
    inferenceMs = 10;
    renderCount = 0;
    frameId = 0;
    frames = new Map();
    recorder = new PoseDatasetRecorder();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    clearRect = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect } as unknown as CanvasRenderingContext2D);
    track = { stop: vi.fn(), onended: null };
    stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
    getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    result = {
      landmarks: [Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }))],
      worldLandmarks: [Array.from({ length: 33 }, (_, index) => ({ x: index / 10, y: -index / 10, z: 0, visibility: 0.9 }))],
      close: vi.fn(),
    };
    model = {
      detectForVideo: vi.fn(() => { now += inferenceMs; return result; }),
      close: vi.fn(),
    };
    vi.mocked(createPoseLandmarker).mockResolvedValue({ landmarker: model as unknown as PoseLandmarker, delegate: 'GPU' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<StrictMode><Probe /></StrictMode>));
    Object.defineProperties(camera.videoRef.current!, {
      readyState: { value: 4 }, videoWidth: { value: 1280 }, videoHeight: { value: 720 },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('skips duplicate video frames, throttles UI updates, and clears missing poses', async () => {
    await act(async () => camera.start());
    expect(getUserMedia).toHaveBeenCalledWith({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    expect(camera.status).toBe('RUNNING');
    expect(camera.delegate).toBe('GPU');
    const rendersAfterStart = renderCount;
    await frame(100, 1);
    await frame(300, 1);
    expect(model.detectForVideo).toHaveBeenCalledTimes(1);
    expect(renderCount).toBe(rendersAfterStart);
    expect(camera.canvasRef.current!.width).toBe(1280);
    expect(camera.canvasRef.current!.height).toBe(720);
    expect(drawing.drawLandmarks.mock.calls[0][0]).toHaveLength(33);
    await frame(490, 2);
    expect(camera.metrics).toMatchObject({ cameraFps: 4, renderFps: 6, inferenceFps: 4, averageInferenceMs: 10, detected: true });
    expect(camera.metrics.visibility).toEqual(Array(8).fill(0.9));
    result = { ...result, landmarks: [], worldLandmarks: [] };
    await frame(990, 3);
    expect(camera.metrics.detected).toBe(false);
    expect(camera.metrics.visibility).toEqual(Array(8).fill(null));
    expect(camera.metrics.signalLandmarks).toEqual(Array(4).fill(null));
    expect(clearRect).toHaveBeenLastCalledWith(0, 0, 1280, 720);
    expect(result.close).toHaveBeenCalledTimes(3);
  });

  it('publishes raw hip/knee image and world coordinates only at the metrics interval', async () => {
    for (const index of [23, 24, 25, 26]) {
      result.landmarks[0][index] = { x: index / 100, y: 0, z: -index / 100, visibility: 0.8 };
    }
    await act(async () => camera.start());
    const rendersAfterStart = renderCount;
    await frame(100, 1);
    expect(renderCount).toBe(rendersAfterStart);
    expect(camera.metrics.signalLandmarks).toEqual(Array(4).fill(null));
    await frame(490, 2);
    expect(camera.metrics.signalLandmarks).toEqual([23, 24, 25, 26].map((index) => ({
      x: index / 100, y: 0, z: -index / 100, visibility: 0.8,
      worldX: index / 10, worldY: -index / 10, worldZ: 0,
    })));
    const snapshot = camera.metrics.signalLandmarks;
    result.landmarks[0][23].x = 0.99;
    await frame(600, 3);
    expect(camera.metrics.signalLandmarks).toBe(snapshot);
    expect(snapshot[0]?.x).toBe(0.23);
    await frame(990, 4);
    expect(camera.metrics.signalLandmarks[0]?.x).toBe(0.99);
    await act(async () => camera.stop());
    expect(camera.metrics.signalLandmarks).toEqual(Array(4).fill(null));
  });

  it('clears missing image/world landmarks instead of retaining prior values', async () => {
    await act(async () => camera.start());
    await frame(490, 1);
    expect(camera.metrics.signalLandmarks[0]?.worldX).toBe(2.3);
    result = { ...result, worldLandmarks: [] };
    await frame(990, 2);
    expect(camera.metrics.signalLandmarks[0]).toEqual({
      x: 0.5, y: 0.5, z: 0, visibility: 0.9, worldX: null, worldY: null, worldZ: null,
    });
    result = { ...result, landmarks: [result.landmarks[0].slice(0, 25)] };
    await frame(1490, 3);
    expect(camera.metrics.signalLandmarks.slice(2)).toEqual([null, null]);
  });

  it('uses only the latest 30 inference times for the moving average', async () => {
    await act(async () => camera.start());
    inferenceMs = 100;
    await frame(100, 1);
    inferenceMs = 10;
    for (let index = 2; index <= 31; index++) await frame(index * 500, index);
    expect(camera.metrics.averageInferenceMs).toBe(10);
  });

  it('stops every resource and ignores stale scheduled frames, then starts again', async () => {
    await act(async () => camera.start());
    await frame(490, 1);
    const staleFrame = [...frames.values()][0];
    const video = camera.videoRef.current!;
    await act(async () => camera.stop());
    expect(track.stop).toHaveBeenCalledOnce();
    expect(model.close).toHaveBeenCalledOnce();
    expect(drawing.close).toHaveBeenCalledOnce();
    expect(track.onended).toBeNull();
    expect(video.srcObject).toBeNull();
    expect(frames.size).toBe(0);
    expect(camera.status).toBe('STOPPED');
    expect(camera.delegate).toBeNull();
    expect(camera.metrics).toMatchObject({ cameraFps: 0, renderFps: 0, inferenceFps: 0, averageInferenceMs: null, detected: false });
    await act(async () => staleFrame(1000));
    expect(model.detectForVideo).toHaveBeenCalledTimes(1);
    await act(async () => camera.start());
    expect(camera.status).toBe('RUNNING');
    expect(frames.size).toBe(1);
  });

  it('stops a stream that arrives after cancellation without affecting a newer start', async () => {
    const pending = deferred<MediaStream>();
    const lateTrack = { stop: vi.fn() };
    getUserMedia.mockReturnValueOnce(pending.promise);
    let starting!: Promise<void>;
    await act(async () => { starting = camera.start(); });
    await act(async () => camera.stop());
    await act(async () => camera.start());
    await act(async () => {
      pending.resolve({ getTracks: () => [lateTrack] } as unknown as MediaStream);
      await starting;
    });
    expect(lateTrack.stop).toHaveBeenCalledOnce();
    expect(track.stop).not.toHaveBeenCalled();
    expect(camera.status).toBe('RUNNING');
    expect(camera.videoRef.current!.srcObject).toBe(stream);
  });

  it('closes a model that finishes loading after unmount', async () => {
    const pending = deferred<Awaited<ReturnType<typeof createPoseLandmarker>>>();
    vi.mocked(createPoseLandmarker).mockReturnValueOnce(pending.promise);
    let starting!: Promise<void>;
    await act(async () => { starting = camera.start(); });
    expect(camera.status).toBe('STARTING');
    await act(async () => root.unmount());
    await act(async () => {
      pending.resolve({ landmarker: model as unknown as PoseLandmarker, delegate: 'GPU' });
      await starting;
    });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(model.close).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  it('cleans up a running camera on unmount', async () => {
    await act(async () => camera.start());
    await act(async () => root.unmount());
    expect(track.stop).toHaveBeenCalledOnce();
    expect(model.close).toHaveBeenCalledOnce();
    expect(drawing.close).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  it.each(['NotAllowedError', 'NotFoundError', 'NotReadableError'])('shows a recoverable %s error', async (name) => {
    getUserMedia.mockRejectedValueOnce(new DOMException('', name));
    await act(async () => camera.start());
    expect(camera.status).toBe('STOPPED');
    expect(camera.error).toBeTruthy();
    expect(createPoseLandmarker).not.toHaveBeenCalled();
    await act(async () => camera.start());
    expect(camera.status).toBe('RUNNING');
    expect(camera.error).toBeNull();
  });

  it('releases the camera when model loading fails or the device disconnects', async () => {
    const error = new Error('download failed');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(createPoseLandmarker).mockRejectedValueOnce(error);
    await act(async () => camera.start());
    expect(camera.error).toContain('모델');
    expect(camera.error).toContain(error.message);
    expect(errorLog).toHaveBeenCalledWith('[Pose] initialization failed', error);
    expect(track.stop).toHaveBeenCalledOnce();
    await act(async () => camera.start());
    await act(async () => track.onended?.());
    expect(camera.status).toBe('STOPPED');
    expect(camera.error).toContain('연결이 종료');
    expect(model.close).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  it('exposes the actual CPU delegate after fallback and resets it on Stop', async () => {
    vi.mocked(createPoseLandmarker).mockResolvedValueOnce({
      landmarker: model as unknown as PoseLandmarker, delegate: 'CPU',
    });
    await act(async () => camera.start());
    expect(camera.delegate).toBe('CPU');
    expect(camera.status).toBe('RUNNING');
    await frame(490, 1);
    expect(camera.metrics.detected).toBe(true);
    await act(async () => camera.stop());
    expect(camera.delegate).toBeNull();
  });

  it('stops the loop and releases the model after an inference error', async () => {
    await act(async () => camera.start());
    const cause = new Error('inference failed');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    model.detectForVideo.mockImplementationOnce(() => { throw cause; });
    await frame(100, 1);
    expect(camera.status).toBe('STOPPED');
    expect(camera.error).toContain('추론');
    expect(errorLog).toHaveBeenCalledWith('[Pose] frame processing failed', cause);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(model.close).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  it('explains the localhost requirement on insecure origins', async () => {
    vi.stubGlobal('isSecureContext', false);
    await act(async () => camera.start());
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(camera.error).toContain('localhost');
    expect(camera.status).toBe('STOPPED');
  });

  function startDataset() {
    const context = camera.getRecordingContext();
    expect(context).not.toBeNull();
    recorder.start({
      ...context!, version: 1, createdAt: '2026-09-20T00:00:00Z', model: 'pose_landmarker_full',
      previewMirrored: true, timeOrigin: 0,
    }, 200);
  }

  it('checks current raw pose availability independently of the throttled UI state', async () => {
    expect(camera.getRecordingContext()).toBeNull();
    await act(async () => camera.start());
    expect(camera.getRecordingContext()).toBeNull();
    await frame(100, 1);
    expect(camera.metrics.detected).toBe(false);
    expect(camera.getRecordingContext()).toEqual({ delegate: 'GPU', videoWidth: 1280, videoHeight: 720 });
    result = { ...result, landmarks: [], worldLandmarks: [] };
    await frame(200, 2);
    expect(camera.getRecordingContext()).toBeNull();
  });

  it('records every inference without extra renders and closes every result while recording', async () => {
    await act(async () => camera.start());
    await frame(100, 1);
    startDataset();
    await frame(6210, 2);
    const renders = renderCount;
    for (let index = 1; index < 10; index++) await frame(6210 + index * 20, 2 + index);
    expect(renderCount).toBe(renders);
    expect(recorder.getView(now).totalSamples).toBe(10);
    expect(result.close).toHaveBeenCalledTimes(11);
    await act(async () => camera.stop());
    expect(recorder.getView(now).status).toBe('INTERRUPTED');
    expect(JSON.parse(recorder.exportJson()).samples).toHaveLength(10);
    expect(camera.getRecordingContext()).toBeNull();
  });

  it('snapshots before result.close and safely interrupts recording on unmount', async () => {
    await act(async () => camera.start());
    await frame(100, 1);
    startDataset();
    vi.mocked(result.close).mockImplementationOnce(() => { result.landmarks[0][0].x = 999; });
    await frame(6210, 2);
    await act(async () => root.unmount());
    expect(recorder.getView(now).status).toBe('INTERRUPTED');
    expect(JSON.parse(recorder.exportJson()).samples[0].landmarks[0].x).toBe(0.5);
    expect(result.close).toHaveBeenCalledTimes(2);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(model.close).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  it('logs drawing failures, closes the result, and interrupts the recorder without losing its snapshot', async () => {
    await act(async () => camera.start());
    await frame(100, 1);
    startDataset();
    const cause = new Error('canvas failed');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    drawing.drawConnectors.mockImplementationOnce(() => { throw cause; });
    await frame(6210, 2);
    expect(errorLog).toHaveBeenCalledWith('[Pose] frame processing failed', cause);
    expect(result.close).toHaveBeenCalledTimes(2);
    expect(camera.status).toBe('STOPPED');
    expect(recorder.getView(now).status).toBe('INTERRUPTED');
    expect(JSON.parse(recorder.exportJson()).samples).toHaveLength(1);
  });
});
