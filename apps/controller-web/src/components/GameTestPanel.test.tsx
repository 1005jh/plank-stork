import { act, createRef, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io } from 'socket.io-client';
import type { CalibrationRemoteState } from '@plank-stork/protocol';
import { GameTestPanel } from './GameTestPanel';
import App from '../App';
import { usePoseCamera } from '../camera/usePoseCamera';
import { testSocket } from '../remote/testSocket';

vi.mock('socket.io-client', () => ({ io: vi.fn() }));
vi.mock('../camera/usePoseCamera', () => ({ usePoseCamera: vi.fn() }));

describe('local game panel and existing controller composition', () => {
  let root: Root, container: HTMLDivElement, now: number;
  let socket: ReturnType<typeof testSocket> & { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
  let camera: ReturnType<typeof usePoseCamera>, callbacks: Parameters<typeof usePoseCamera>[0];
  const button = (label: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === label)!;
  const panel = () => [...container.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === 'Local Game Test')!;
  const value = (label: string) => panel().querySelector(`[aria-label="${label}"]`)!.textContent;
  function click(label: string) { act(() => button(label).click()); }
  function press(key: string, release = true) {
    now += 20;
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
      if (release) window.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true }));
    });
  }
  function render(app = false) { act(() => root.render(<StrictMode>{app ? <App /> : <GameTestPanel />}</StrictMode>)); }
  function snapshot() {
    act(() => socket.receive('calibration:sync:requested', { requestId: 'inspect', timestamp: 0 }));
    return socket.emit.mock.calls.filter(([name]) => name === 'calibration:state:publish').at(-1)![1] as CalibrationRemoteState;
  }
  beforeEach(() => {
    vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    now = 100; vi.spyOn(performance, 'now').mockImplementation(() => now);
    socket = Object.assign(testSocket(), { connect: vi.fn(), disconnect: vi.fn() });
    socket.connected = false;
    vi.mocked(io).mockReturnValue(socket.asSocket());
    camera = {
      videoRef: createRef(), canvasRef: createRef(), status: 'STOPPED', error: null, delegate: null,
      start: vi.fn(), stop: vi.fn(() => { camera.status = 'STOPPED'; callbacks?.onCameraStopped?.(); }),
      getCaptureContext: vi.fn(() => null),
      getRecordingContext: vi.fn(() => camera.status === 'RUNNING' ? { delegate: 'CPU' as const, videoWidth: 1280, videoHeight: 720 } : null),
      metrics: { cameraFps: 0, renderFps: 0, inferenceFps: 0, averageInferenceMs: null, detected: false,
        visibility: [], signalLandmarks: [], width: 0, height: 0 },
    };
    vi.mocked(usePoseCamera).mockImplementation((options) => { callbacks = options; return camera; });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove();
    vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals();
  });

  it('plays the fixed sequence with wrong feedback and a labelled TEST result without camera or Socket', () => {
    render();
    expect(value('Game status')).toBe('IDLE'); expect(value('Test score')).toBe('0 / 4');
    expect(value('Game progress')).toBe('0 / 4');
    press('ArrowLeft'); expect(value('Test score')).toBe('0 / 4');
    click('Start Game');
    expect(document.activeElement).toBe(panel());
    expect(button('Start Game').disabled).toBe(true);
    expect(value('Game status')).toBe('RUNNING'); expect(value('Current target')).toBe('LEFT');
    expect(value('Game progress')).toBe('1 / 4');
    press('ArrowRight');
    expect(value('Test score')).toBe('0 / 4'); expect(value('Current target')).toBe('LEFT');
    expect(value('Game feedback')).toBe('WRONG · 오답: RIGHT (target LEFT)');
    for (const [i, key] of ['ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight'].entries()) {
      press(key); expect(value('Test score')).toBe(`${i + 1} / 4`);
      expect(panel().textContent).toContain('TEST INPUT — KEYBOARD');
    }
    expect(value('Game status')).toBe('COMPLETED'); expect(value('Game progress')).toBe('4 / 4');
    expect(value('Current target')).toBe('—');
    expect(value('Game feedback')).toBe('CORRECT · 정답: RIGHT (target RIGHT)');
    expect(panel().textContent).toContain('COMPLETED — TEST INPUT — KEYBOARD · 테스트 점수 4 / 4');
    expect(panel().textContent).toContain('실제 운동 기록이 아닙니다');
    press('ArrowLeft'); expect(value('Test score')).toBe('4 / 4');
    expect(io).not.toHaveBeenCalled(); expect(usePoseCamera).not.toHaveBeenCalled();
  });

  it('rerender/held keys and double Start cannot restart progress; Reset gets a fresh run', () => {
    render(); click('Start Game');
    const firstRun = panel().querySelector('details p')!.textContent!;
    press('ArrowLeft', false); render(); press('ArrowLeft', false); click('Start Game');
    expect(value('Test score')).toBe('1 / 4');
    expect(panel().textContent).toContain('Accepted actions: 1');
    expect(panel().querySelector('details')!.textContent).toContain(firstRun);
    click('Reset Game');
    expect(value('Game status')).toBe('IDLE'); expect(value('Game feedback')).toBe('—');
    expect(value('Test score')).toBe('0 / 4');
    press('ArrowRight'); expect(value('Test score')).toBe('0 / 4');
    click('Start Game');
    expect(panel().querySelector('details')!.textContent).not.toContain(firstRun);
    press('ArrowLeft'); expect(value('Test score')).toBe('1 / 4');
    expect(panel().textContent).toContain('Last sequence: 1');
  });

  it('completes inside the actual App with STOPPED camera and DISCONNECTED Socket', () => {
    render(true);
    expect(container.textContent).toContain('Camera: STOPPED');
    expect(container.textContent).toContain('Socket: DISCONNECTED');
    expect(container.querySelector('.pose-panel h2')!.textContent).toBe('Pose Landmark POC');
    expect(button('LEFT').disabled).toBe(true); expect(button('RIGHT').disabled).toBe(true);
    click('Start Game');
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight']) press(key);
    expect(value('Game status')).toBe('COMPLETED');
    expect(value('Test score')).toBe('4 / 4');
    expect(camera.start).not.toHaveBeenCalled(); expect(camera.getRecordingContext).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
    expect(container.querySelector('video')).not.toBeNull();
  });

  it('preserves Socket LEFT/RIGHT sends/receives and never turns their echoes into game actions', () => {
    render(true);
    act(() => { socket.connected = true; socket.receive('connect'); });
    click('Start Game');
    socket.emit.mockClear();
    click('LEFT'); click('RIGHT');
    expect(socket.emit.mock.calls).toEqual([
      ['control:test', { direction: 'LEFT', timestamp: expect.any(Number) }],
      ['control:test', { direction: 'RIGHT', timestamp: expect.any(Number) }],
    ]);
    for (const direction of ['LEFT', 'RIGHT']) act(() => socket.receive('control:test:received', { direction, timestamp: 123 }));
    expect(container.querySelector('main > dl')!.textContent).toContain('Last directionRIGHT');
    expect(value('Test score')).toBe('0 / 4'); expect(panel().textContent).toContain('Accepted actions: 0');
    button('LEFT').focus(); press('ArrowLeft');
    expect(value('Test score')).toBe('0 / 4');
    panel().focus(); press('ArrowLeft'); expect(value('Test score')).toBe('1 / 4');
    // STEP 4V publishes the locally approved score; control:test echoes still never score.
    const gameMessages = socket.emit.mock.calls.filter(([name]) => String(name).startsWith('game:'));
    expect(gameMessages).toHaveLength(1);
    expect(gameMessages[0]).toEqual(['game:state:publish', expect.objectContaining({ score: 1, targetIndex: 1,
      provenance: { kind: 'TEST', method: 'KEYBOARD' } })]);
    act(() => { socket.connected = false; socket.receive('disconnect'); });
    press('ArrowRight'); expect(value('Test score')).toBe('2 / 4');
  });

  it('keeps calibration/Camera Stop independent from Game Reset and keeps remote lifecycle cleanup', async () => {
    render(true);
    camera.status = 'RUNNING'; camera.metrics.detected = true;
    act(() => { socket.connected = true; socket.receive('connect'); });
    render(true); click('Calibrate Neutral');
    const neutral = snapshot().neutral;
    expect(neutral.collectionState).toBe('HIP');
    click('Start Game'); press('ArrowLeft'); click('Reset Game');
    expect(snapshot().neutral).toEqual(neutral);
    expect(camera.stop).not.toHaveBeenCalled(); expect(camera.start).not.toHaveBeenCalled();
    click('Start Game'); press('ArrowLeft');
    click('Stop Camera'); render(true);
    expect(snapshot().controller.cameraRunning).toBe(false);
    expect(snapshot().neutral.collectionState).toBe('IDLE');
    expect(value('Game status')).toBe('RUNNING'); expect(value('Test score')).toBe('1 / 4');
    panel().focus(); press('ArrowRight'); expect(value('Test score')).toBe('2 / 4');
    expect(socket.listenerCount('calibration:neutral:start:requested')).toBe(1);
    expect(socket.listenerCount('control:test:received')).toBe(1);
    // App includes asynchronous capture shutdown; flush its cleanup/microtasks too.
    await act(async () => root.unmount());
    expect(socket.listenerCount('calibration:neutral:start:requested')).toBe(0);
    expect(socket.listenerCount('control:test:received')).toBe(0);
    // jsdom queues media-element tasks via setImmediate when the existing <video> mounts.
    // Drain due DOM tasks without advancing any application interval; leaked timers still fail.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(vi.getTimerCount()).toBe(0);
    const emitted = socket.emit.mock.calls.length;
    press('ArrowLeft'); expect(socket.emit).toHaveBeenCalledTimes(emitted);
  });
});
