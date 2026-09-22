import { act, createRef, StrictMode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalibrationRemoteState } from '@plank-stork/protocol';
import { usePoseCamera } from '../camera/usePoseCamera';
import { PoseCamera } from '../components/PoseCamera';
import { testSocket } from './testSocket';

vi.mock('../camera/usePoseCamera', () => ({ usePoseCamera: vi.fn() }));

describe('controller remote lifecycle', () => {
  let root: Root; let container: HTMLDivElement; let now: number;
  let socket: ReturnType<typeof testSocket>;
  let callbacks: Parameters<typeof usePoseCamera>[0];
  let camera: ReturnType<typeof usePoseCamera>;
  const snapshot = () => socket.emit.mock.calls.filter(([event]) => event === 'calibration:state:publish').at(-1)![1] as CalibrationRemoteState;
  const request = async (event: string, requestId = event) => act(async () => socket.receive(event, { requestId, timestamp: Date.now() }));
  async function advance(ms: number) { now += ms; await act(async () => vi.advanceTimersByTime(ms)); }
  async function freezeNeutral() {
    await request('calibration:neutral:start:requested');
    const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
    for (let index = 0; index < 20; index++) {
      await advance(50);
      callbacks?.onFrame?.({ timestamp: now, videoTime: now / 1000, landmarks: points, worldLandmarks: points });
    }
    await request('calibration:sync:requested');
    expect(snapshot().neutral.frozen).toBe(true);
  }

  beforeEach(async () => {
    vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now);
    socket = testSocket();
    camera = {
      videoRef: createRef(), canvasRef: createRef(), status: 'RUNNING', error: null, delegate: 'CPU', start: vi.fn(),
      stop: vi.fn(() => { camera.status = 'STOPPED'; callbacks?.onCameraStopped?.(); }),
      getRecordingContext: vi.fn(() => ({ delegate: 'CPU' as const, videoWidth: 1280, videoHeight: 720 })),
      metrics: { cameraFps: 30, renderFps: 60, inferenceFps: 30, averageInferenceMs: 15, detected: true,
        visibility: [], signalLandmarks: [], width: 1280, height: 720 },
    };
    vi.mocked(usePoseCamera).mockImplementation((value) => {
      callbacks = value;
      useEffect(() => () => callbacks?.onCameraStopped?.(), []);
      return camera;
    });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(<StrictMode><PoseCamera socket={socket.asSocket()} /></StrictMode>));
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove(); vi.clearAllTimers(); vi.useRealTimers();
    vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals();
  });

  it('answers sync immediately, publishes at 250ms, and does not emit per inference', async () => {
    socket.emit.mockClear();
    const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
    for (let index = 0; index < 6; index++) {
      await advance(30);
      callbacks?.onFrame?.({ timestamp: now, videoTime: now / 1000, landmarks: points, worldLandmarks: points });
    }
    expect(socket.emit).not.toHaveBeenCalled();
    await advance(70);
    expect(socket.emit).toHaveBeenCalledTimes(1);
    await request('calibration:sync:requested');
    expect(socket.emit).toHaveBeenCalledTimes(2);
    expect(snapshot().controller).toEqual({ cameraRunning: true, poseDetected: true });
    socket.connected = false;
    await advance(1000);
    expect(socket.emit).toHaveBeenCalledTimes(2);
    socket.connected = true;
    await request('connect');
    expect(socket.emit).toHaveBeenCalledTimes(3);
  });

  it('rejects missing pose and non-frozen Action, then starts the real engines remotely', async () => {
    vi.mocked(camera.getRecordingContext).mockReturnValue(null);
    await request('calibration:neutral:start:requested', 'no-pose');
    expect(snapshot()).toMatchObject({ lastCommandError: 'POSE_NOT_DETECTED', neutral: { collectionState: 'IDLE' } });
    await request('calibration:action:start:requested', 'too-early');
    expect(snapshot().lastCommandError).toBe('NEUTRAL_NOT_FROZEN');
    vi.mocked(camera.getRecordingContext).mockReturnValue({ delegate: 'CPU', videoWidth: 1280, videoHeight: 720 });
    await freezeNeutral();
    await request('calibration:action:start:requested', 'first');
    await advance(500);
    await request('calibration:action:start:requested', 'second');
    expect(snapshot().actionCalibration).toMatchObject({ status: 'ACTIVE', phase: 'PREPARE', remainingMs: 1500 });
  });

  it('keeps Mirror independent, resets Action on Neutral recalibration, and publishes Camera Stop immediately', async () => {
    await freezeNeutral();
    await request('calibration:action:start:requested');
    await advance(2250);
    const before = snapshot();
    const mirror = container.querySelector<HTMLButtonElement>('button[aria-pressed]')!;
    await act(async () => mirror.click());
    await request('calibration:sync:requested');
    expect(snapshot().actionCalibration).toEqual(before.actionCalibration);
    expect(snapshot().actionCalibration.action).toBe('TWIST_LEFT');
    await act(async () => mirror.click());
    await request('calibration:sync:requested');
    expect(snapshot().actionCalibration).toEqual(before.actionCalibration);
    await request('calibration:neutral:start:requested', 'recalibrate');
    expect(snapshot()).toMatchObject({ neutral: { collectionState: 'HIP' }, actionCalibration: { status: 'IDLE' }, classification: { stableAction: 'NONE' } });
    await act(async () => camera.stop());
    expect(snapshot()).toMatchObject({ controller: { cameraRunning: false, poseDetected: false }, neutral: { collectionState: 'IDLE' }, actionCalibration: { status: 'IDLE' }, classification: { stableAction: 'NONE' } });
  });

  it('cleans remote listeners/timers under StrictMode and cannot handle requests after unmount', async () => {
    const events = ['connect', 'calibration:sync:requested', 'calibration:neutral:start:requested', 'calibration:action:start:requested', 'calibration:action:reset:requested'];
    for (const event of events) expect(socket.listenerCount(event)).toBe(1);
    await act(async () => root.unmount());
    await advance(1000);
    expect(vi.getTimerCount()).toBe(0);
    for (const event of events) expect(socket.listenerCount(event)).toBe(0);
    expect(snapshot().controller.cameraRunning).toBe(false);
    socket.emit.mockClear();
    await request('calibration:neutral:start:requested');
    expect(socket.emit).not.toHaveBeenCalled();
  });
});
