import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePoseCamera } from '../camera/usePoseCamera';
import { PoseCamera } from './PoseCamera';
import { PoseFeatureAnalysis } from '../pose/features/poseFeatureAnalysis';

vi.mock('../camera/usePoseCamera', () => ({ usePoseCamera: vi.fn() }));

describe('Pose signal debug panel', () => {
  let root: Root;
  let container: HTMLDivElement;
  let camera: ReturnType<typeof usePoseCamera>;
  let callbacks: Parameters<typeof usePoseCamera>[0];
  let now: number;

  async function advance(ms: number) {
    now += ms;
    await act(async () => vi.advanceTimersByTime(ms));
  }

  function sendFrame(offset = 0, missing = false, leftKneeVisibility = 0.9) {
    const points = Array.from({ length: 33 }, () => ({ x: 0.5 + offset, y: 0.5, z: 0, visibility: 0.9 }));
    points[25].visibility = leftKneeVisibility;
    callbacks?.onFrame?.({ timestamp: now, videoTime: now / 1000, landmarks: missing ? [] : points, worldLandmarks: missing ? [] : points });
  }

  function button(text: string) {
    return [...container.querySelectorAll('button')].find((item) => item.textContent === text)!;
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    camera = {
      videoRef: createRef<HTMLVideoElement>(),
      canvasRef: createRef<HTMLCanvasElement>(),
      status: 'RUNNING', error: null, delegate: 'CPU', start: vi.fn(), stop: vi.fn(),
      getRecordingContext: vi.fn(() => null),
      metrics: {
        cameraFps: 30, renderFps: 60, inferenceFps: 30, averageInferenceMs: 12.3,
        detected: true, visibility: Array(8).fill(0.9), width: 1280, height: 720,
        signalLandmarks: [
          { x: 0.12345, y: 0, z: -0.12345, visibility: 0.9996, worldX: 1.23456, worldY: -2.5, worldZ: 0 },
          { x: 0.4, y: 0.5, z: -0.6, visibility: 0.7, worldX: null, worldY: null, worldZ: null },
          null, null,
        ],
      },
    };
    vi.mocked(usePoseCamera).mockImplementation((nextCallbacks) => { callbacks = nextCallbacks; return camera; });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<PoseCamera />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('formats the four hip/knee rows to three decimals, preserving zero, sign, and missing fields', () => {
    const table = container.querySelector('.signal-table')!;
    const rows = [...table.querySelectorAll('tbody tr')];
    expect(rows.map((row) => row.querySelector('th')?.textContent)).toEqual([
      '23 LEFT_HIP', '24 RIGHT_HIP', '25 LEFT_KNEE', '26 RIGHT_KNEE',
    ]);
    expect([...table.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual([
      'Landmark', 'x', 'y', 'z', 'visibility', 'worldX', 'worldY', 'worldZ',
    ]);
    expect([...rows[0].querySelectorAll('td')].map((cell) => cell.textContent)).toEqual([
      '0.123', '0.000', '-0.123', '1.000', '1.235', '-2.500', '0.000',
    ]);
    expect([...rows[1].querySelectorAll('td')].map((cell) => cell.textContent)).toEqual([
      '0.400', '0.500', '-0.600', '0.700', '-', '-', '-',
    ]);
    expect([...rows[2].querySelectorAll('td')].map((cell) => cell.textContent)).toEqual(Array(7).fill('-'));
    expect(container.textContent).toContain('Delegate: CPU');
    expect(container.textContent).toContain('Pose inference FPS30.0');
    expect(container.textContent).toContain('Average inference time (ms)12.3');
  });

  it('toggles only the shared preview transform without changing coordinates or restarting the camera', async () => {
    const preview = container.querySelector('.pose-preview')!;
    const video = container.querySelector('video')!;
    const canvas = container.querySelector('canvas')!;
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-pressed]')!;
    const originalValues = container.querySelector('.signal-table')!.textContent;
    const originalMetrics = JSON.stringify(camera.metrics);
    expect(video.parentElement).toBe(preview);
    expect(canvas.parentElement).toBe(preview);
    expect(preview.classList.contains('is-mirrored')).toBe(true);
    expect(toggle.textContent).toBe('Mirror ON');
    await act(async () => toggle.click());
    expect(toggle.textContent).toBe('Mirror OFF');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(preview.classList.contains('is-mirrored')).toBe(false);
    expect(container.querySelector('.signal-table')!.textContent).toBe(originalValues);
    expect(JSON.stringify(camera.metrics)).toBe(originalMetrics);
    expect(container.querySelector('video')).toBe(video);
    expect(container.querySelector('canvas')).toBe(canvas);
    await act(async () => toggle.click());
    expect(toggle.textContent).toBe('Mirror ON');
    expect(preview.classList.contains('is-mirrored')).toBe(true);
    expect(camera.start).not.toHaveBeenCalled();
    expect(camera.stop).not.toHaveBeenCalled();
  });

  it('displays dashes for every field after the pose disappears', async () => {
    camera.metrics = { ...camera.metrics, detected: false, signalLandmarks: Array(4).fill(null) };
    await act(async () => root.render(<PoseCamera />));
    expect(container.textContent).toContain('Pose: NOT DETECTED');
    expect([...container.querySelectorAll('.signal-table td')].map((cell) => cell.textContent))
      .toEqual(Array(28).fill('-'));
  });

  it('throttles feature display to 250 ms and keeps calibrated raw/delta/smoothed values through Mirror toggles', async () => {
    vi.mocked(camera.getRecordingContext).mockReturnValue({ delegate: 'CPU', videoWidth: 1280, videoHeight: 720 });
    await act(async () => button('Calibrate Neutral').click());
    expect(container.textContent).toContain('Status: CALIBRATING');
    const before = container.querySelector('.feature-raw-table')!.textContent;
    const renderCount = vi.mocked(usePoseCamera).mock.calls.length;
    for (let index = 1; index <= 4; index++) { await advance(50); sendFrame(); }
    expect(container.querySelector('.feature-raw-table')!.textContent).toBe(before);
    expect(vi.mocked(usePoseCamera).mock.calls.length).toBe(renderCount);
    for (let index = 5; index <= 20; index++) {
      await advance(50);
      sendFrame();
      if (index === 10) await act(async () => button('Mirror ON').click());
      if (index === 15) await act(async () => button('Mirror OFF').click());
    }
    await advance(250);
    expect(container.textContent).toContain('Status: CALIBRATED');
    expect(container.querySelector('[aria-label="Calibration readiness"]')?.textContent).toContain('HIP20 / 20READY');
    expect(container.querySelector('.feature-raw-table')?.textContent).toContain('hipCenterX0.500');
    expect(container.querySelector('.feature-baseline-table')?.textContent).toContain('hipCenterX0.50020');
    expect(container.querySelector('.feature-delta-table')?.textContent).toContain('deltaHipCenterX0.0000.000');
    const values = container.querySelector('.features-panel')!.textContent;
    await act(async () => button('Mirror ON').click());
    expect(container.querySelector('.features-panel')!.textContent).toBe(values);
    await act(async () => button('Mirror OFF').click());
    expect(container.querySelector('.features-panel')!.textContent).toBe(values);
    // Feed the same untransformed body coordinates after each preview setting.
    sendFrame(0.1);
    await advance(250);
    expect(container.querySelector('.feature-delta-table')!.textContent).toContain('deltaHipCenterX0.1000.100');
    expect(container.textContent).toContain('Smoothed: VALID');
    sendFrame(0.1);
    await advance(10);
    sendFrame(0, true);
    // The previous valid data is only 250 ms old: it must already be masked, not wait for expiry.
    await advance(240);
    expect(container.textContent).toContain('Smoothed: STALE');
    expect([...container.querySelectorAll('.feature-delta-table td')].every((cell) => cell.textContent === '-')).toBe(true);
    sendFrame(0.1);
    await advance(250);
    expect(container.textContent).toContain('Smoothed: VALID');
    expect(container.querySelector('.feature-delta-table')!.textContent).toContain('deltaHipCenterX0.1000.100');
  });

  it('shows independent HIP / LEFT KNEE / RIGHT KNEE readiness after HIP calibration finishes', async () => {
    vi.mocked(camera.getRecordingContext).mockReturnValue({ delegate: 'CPU', videoWidth: 1280, videoHeight: 720 });
    await act(async () => button('Calibrate Neutral').click());
    for (let index = 0; index < 20; index++) { await advance(50); sendFrame(0, false, 0.49); }
    await advance(250);
    expect(container.textContent).toContain('Status: CALIBRATED');
    const readiness = () => container.querySelector('[aria-label="Calibration readiness"]')!.textContent;
    expect(readiness()).toContain('HIP20 / 20READY');
    expect(readiness()).toContain('LEFT KNEE0 / 20PARTIAL');
    expect(readiness()).toContain('RIGHT KNEE20 / 20READY');
    expect(container.querySelector('.feature-delta-table')!.textContent).toContain('deltaLeftKneeRelativeX--');
    expect(container.textContent).toContain('Status: CALIBRATED / FINISHING');
    expect(container.textContent).toContain('Finalizing knee calibration...');
    for (let index = 0; index < 8; index++) { await advance(50); sendFrame(0, false, 0.5); }
    await advance(100);
    expect(readiness()).toContain('LEFT KNEE8 / 20PARTIAL');
    expect(container.textContent).toContain('Neutral을 계속 유지');
    for (let index = 0; index < 12; index++) { await advance(15); sendFrame(0, false, 0.5); }
    await advance(70);
    expect(readiness()).toContain('LEFT KNEE20 / 20READY');
    expect(container.querySelector('.feature-delta-table')!.textContent).toContain('deltaLeftKneeRelativeX0.0000.000');
    expect(container.textContent).toContain('Calibration frozen');
    expect(container.textContent).not.toContain('Finalizing knee calibration...');
  });

  it('shows frozen PARTIAL knees after the deadline and restarts calibration with the button', async () => {
    vi.mocked(camera.getRecordingContext).mockReturnValue({ delegate: 'CPU', videoWidth: 1280, videoHeight: 720 });
    await act(async () => button('Calibrate Neutral').click());
    for (let index = 0; index < 20; index++) { await advance(50); sendFrame(0, false, 0.49); }
    await advance(250);
    expect(container.textContent).toContain('Finalizing knee calibration... 0.8s remaining');
    for (let index = 0; index < 8; index++) { await advance(50); sendFrame(); }
    await advance(350);
    expect(container.textContent).toContain('Calibration frozen');
    expect(container.textContent).not.toContain('Status: CALIBRATED / FINISHING');
    expect(container.querySelector('[aria-label="Calibration readiness"]')?.textContent).toContain('LEFT KNEE8 / 20PARTIAL');
    const frozen = container.querySelector('.feature-baseline-table')!.textContent;
    for (let index = 0; index < 20; index++) { await advance(50); sendFrame(0.3); }
    await advance(250);
    expect(container.querySelector('.feature-baseline-table')!.textContent).toBe(frozen);
    expect(container.querySelector('.feature-delta-table')!.textContent).toContain('deltaLeftKneeRelativeX--');
    await act(async () => button('Calibrate Neutral').click());
    expect(container.textContent).toContain('Status: CALIBRATING');
    expect(container.textContent).not.toContain('Calibration frozen');
    expect(container.textContent).toContain('Smoothed: UNAVAILABLE');
    expect(container.querySelector('[aria-label="Calibration readiness"]')?.textContent).toContain('HIP0 / 20PARTIAL');
    expect(container.querySelector('.feature-baseline-table')?.textContent).toContain('hipCenterX-0');
  });

  it('stops active calibration and recording together on camera release, with no baseline reused after restart', async () => {
    vi.mocked(camera.getRecordingContext).mockReturnValue({ delegate: 'CPU', videoWidth: 1280, videoHeight: 720 });
    await act(async () => button('Start Guided Recording').click());
    await advance(6000);
    await act(async () => button('Calibrate Neutral').click());
    sendFrame();
    await advance(250);
    expect(container.textContent).toContain('Status: CALIBRATING');
    camera.stop = vi.fn(() => { callbacks?.onCameraStopped?.(); });
    await act(async () => root.render(<PoseCamera />));
    await act(async () => button('Stop Camera').click());
    await advance(250);
    expect(container.textContent).toContain('Status: NOT CALIBRATED');
    expect(container.querySelector('[aria-label="Calibration readiness"]')?.textContent).toContain('HIP0 / 20PARTIAL');
    expect(container.textContent).toContain('INTERRUPTED');
    expect(container.textContent).toContain('1 samples / 0 dropped');
    for (let index = 0; index < 25; index++) { await advance(50); sendFrame(); }
    expect(container.textContent).toContain('Status: NOT CALIBRATED');
    expect(container.textContent).toContain('1 samples / 0 dropped');
  });

  it('clears calibration and smoothing buffers and UI timers on unmount', async () => {
    const reset = vi.spyOn(PoseFeatureAnalysis.prototype, 'reset');
    const view = vi.spyOn(PoseFeatureAnalysis.prototype, 'getView');
    vi.mocked(camera.getRecordingContext).mockReturnValue({ delegate: 'CPU', videoWidth: 1280, videoHeight: 720 });
    await act(async () => button('Calibrate Neutral').click());
    for (let index = 0; index < 20; index++) { await advance(50); sendFrame(); }
    await advance(250);
    expect(container.textContent).toContain('Status: CALIBRATED');
    // Observe the real engine held by the hook, then verify cleanup clears its state.
    const analysis = view.mock.contexts.at(-1)!;
    if (!(analysis instanceof PoseFeatureAnalysis)) throw new Error('Feature analysis instance was not observed');
    await act(async () => root.unmount());
    expect(reset).toHaveBeenCalled();
    expect(analysis.getView(now)).toMatchObject({ status: 'NOT CALIBRATED', baseline: null, sampleCount: 0 });
    expect(Object.values(analysis.getView(now).smoothed.values).every((value) => value === null)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
