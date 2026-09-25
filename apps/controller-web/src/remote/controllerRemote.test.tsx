import { act, createRef, StrictMode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalibrationRemoteState } from '@plank-stork/protocol';
import { usePoseCamera } from '../camera/usePoseCamera';
import { PoseCamera } from '../components/PoseCamera';
import { testSocket } from './testSocket';
import { features, prototypes, RECORD_STARTS } from '../pose/actions/testFixtures';
import { POSE_ACTIONS } from '../pose/actions/poseActionTypes';
import { KneeMotionValidation } from '../pose/motion/kneeMotionValidation';

vi.mock('../camera/usePoseCamera', () => ({ usePoseCamera: vi.fn() }));

describe('controller remote lifecycle', () => {
  let root: Root; let container: HTMLDivElement; let now: number;
  let socket: ReturnType<typeof testSocket>;
  let callbacks: Parameters<typeof usePoseCamera>[0];
  let camera: ReturnType<typeof usePoseCamera>;
  const snapshot = () => socket.emit.mock.calls.filter(([event]) => event === 'calibration:state:publish').at(-1)![1] as CalibrationRemoteState;
  const request = async (event: string, requestId = event) => act(async () => socket.receive(event, { requestId, timestamp: Date.now() }));
  async function advance(ms: number) { now += ms; await act(async () => vi.advanceTimersByTime(ms)); }
  function inference(values = features()) {
    const points = Array.from({ length: 33 }, () => ({ x: 0.5 + (values.deltaHipCenterX ?? 0), y: 0.5 + (values.deltaHipCenterY ?? 0), z: 0, visibility: 0.9 }));
    const world = points.map((point) => ({ ...point }));
    world[23].z = (values.deltaHipDepthDifference ?? 0) / 2; world[24].z = -(values.deltaHipDepthDifference ?? 0) / 2;
    callbacks?.onFrame?.({ timestamp: now, videoTime: now / 1000, landmarks: points, worldLandmarks: world });
  }
  async function readyActions() {
    await request('calibration:action:start:requested');
    for (let elapsed = 50; elapsed <= 15000; elapsed += 50) {
      await advance(50);
      const index = RECORD_STARTS.findIndex((start) => elapsed >= start - 1000 && elapsed < start + 1500);
      inference(index < 0 ? features() : prototypes()[POSE_ACTIONS[index]]!.features);
    }
    await request('calibration:sync:requested');
    expect(Object.values(snapshot().actionCalibration.readiness)).toEqual([true, true, true, true]);
  }
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

  it('starts validation remotely only after READY, ignores duplicates, publishes compact state and resets', async () => {
    await request('validation:start:requested', 'before-neutral');
    expect(snapshot().lastCommandError).toBe('NEUTRAL_NOT_FROZEN');
    await freezeNeutral();
    await request('validation:start:requested', 'before-actions');
    expect(snapshot().lastCommandError).toBe('ACTION_NOT_READY');
    await readyActions();
    await request('validation:start:requested', 'start');
    expect(snapshot().validation).toMatchObject({ status: 'ACTIVE', phase: 'PREPARE', remainingMs: 2000 });
    await advance(100);
    await request('validation:start:requested', 'start');
    await request('validation:start:requested', 'another-click');
    expect(snapshot().validation.remainingMs).toBe(1900);
    await advance(1900); inference();
    await request('calibration:sync:requested');
    expect(snapshot().validation).toEqual({ status: 'ACTIVE', phase: 'RECORD_NEUTRAL', expectedAction: 'NONE', remainingMs: 1500, recordedFrames: 1 });
    expect(JSON.stringify(snapshot())).not.toMatch(/landmarks|rawFeatures|smoothedFeatures|samples|actionPrototypes/);
    await advance(1500);
    await request('calibration:sync:requested');
    expect(snapshot().validation).toMatchObject({ phase: 'MOVE', expectedAction: 'TWIST_LEFT' });
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-pressed]')!.click());
    await request('calibration:sync:requested');
    expect(snapshot().validation.expectedAction).toBe('TWIST_LEFT');
    await request('validation:reset:requested');
    expect(snapshot().validation).toMatchObject({ status: 'IDLE', recordedFrames: 0 });
    expect(Object.values(snapshot().actionCalibration.readiness)).toEqual([true, true, true, true]);
    await request('validation:start:requested', 'second-run');
    await request('calibration:action:reset:requested');
    expect(snapshot().validation.status).toBe('IDLE');
  });

  it('cleans remote listeners/timers under StrictMode and cannot handle requests after unmount', async () => {
    const events = ['motion:validation:start:requested', 'motion:validation:reset:requested', 'validation:start:requested', 'validation:reset:requested', 'connect', 'calibration:sync:requested', 'calibration:neutral:start:requested', 'calibration:action:start:requested', 'calibration:action:reset:requested'];
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

  it('runs motion validation without Action calibration, publishes compact stages and downloads only on the controller', async () => {
    const read = vi.spyOn(KneeMotionValidation.prototype, 'recordFrame');
    await freezeNeutral();
    expect(snapshot().actionCalibration.status).toBe('IDLE');
    await request('motion:validation:start:requested', 'motion');
    expect(snapshot().motionValidation).toMatchObject({ status: 'ACTIVE', phase: 'PREPARE', remainingMs: 2000 });
    await advance(100);
    await request('motion:validation:start:requested', 'motion-duplicate');
    expect(snapshot().motionValidation.remainingMs).toBe(1900);
    const mirror = container.querySelector<HTMLButtonElement>('button[aria-pressed]')!;
    await act(async () => mirror.click());
    for (let elapsed = 150; elapsed <= 15000; elapsed += 50) { await advance(50); inference(); }
    await request('calibration:sync:requested');
    expect(snapshot().motionValidation).toEqual({ status: 'COMPLETED', phase: 'COMPLETED', expectedMotion: null, remainingMs: 0, recordedFrames: 260 });
    expect(snapshot().actionCalibration.status).toBe('IDLE');
    expect(JSON.stringify(snapshot())).not.toMatch(/landmarks|samples|neutralCorridor|crossingExperiments|velocity|features/);
    const engine = read.mock.contexts.at(-1)!;
    if (!(engine instanceof KneeMotionValidation)) throw new Error('Missing motion engine');
    expect(JSON.parse(engine.exportJson())).toMatchObject({ previewMirrored: true, status: 'COMPLETED' });
    await advance(250);
    expect(container.querySelector('[aria-label="Motion summary"]')).not.toBeNull();
    const createUrl = vi.fn(() => 'blob:motion-test'), revokeUrl = vi.fn();
    vi.stubGlobal('URL', class extends URL { static createObjectURL = createUrl; static revokeObjectURL = revokeUrl; });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const download = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Download Motion Validation JSON')!;
    await act(async () => download.click());
    expect(createUrl).toHaveBeenCalledWith(expect.any(Blob)); expect(click).toHaveBeenCalledOnce();
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toMatch(/^plank-stork-knee-motion-.*\.json$/);
    await act(async () => root.unmount());
    await advance(1000);
    expect(revokeUrl).toHaveBeenCalledWith('blob:motion-test');
    expect(engine.getView(now)).toMatchObject({ status: 'IDLE', recordedFrames: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects motion before Neutral/pose readiness and resets on command, Neutral recalibration and Camera Stop', async () => {
    await request('motion:validation:start:requested', 'before-neutral');
    expect(snapshot().lastCommandError).toBe('NEUTRAL_NOT_FROZEN');
    await freezeNeutral();
    vi.mocked(camera.getRecordingContext).mockReturnValue(null);
    await request('motion:validation:start:requested', 'no-pose');
    expect(snapshot().lastCommandError).toBe('POSE_NOT_DETECTED');
    vi.mocked(camera.getRecordingContext).mockReturnValue({ delegate: 'CPU', videoWidth: 1280, videoHeight: 720 });
    await request('motion:validation:start:requested', 'first');
    await advance(2000); inference();
    await request('calibration:sync:requested');
    expect(snapshot().motionValidation.recordedFrames).toBe(1);
    await request('calibration:action:reset:requested');
    expect(snapshot().motionValidation.status).toBe('ACTIVE');
    await request('motion:validation:reset:requested');
    expect(snapshot().motionValidation).toMatchObject({ status: 'IDLE', recordedFrames: 0 });
    await request('motion:validation:start:requested', 'second');
    await request('calibration:neutral:start:requested', 'recalibrate-for-motion');
    expect(snapshot().motionValidation).toMatchObject({ status: 'IDLE', recordedFrames: 0 });
    for (let index = 0; index < 20; index++) { await advance(50); inference(); }
    await request('motion:validation:start:requested', 'third');
    expect(snapshot().motionValidation.status).toBe('ACTIVE');
    await act(async () => camera.stop());
    expect(snapshot().motionValidation).toMatchObject({ status: 'IDLE', recordedFrames: 0 });
  });
});
