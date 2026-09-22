import { act, createRef, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePoseCamera } from '../camera/usePoseCamera';
import { PoseCamera } from './PoseCamera';
import { PoseActionAnalysis } from '../pose/actions/poseActionAnalysis';
import { features, input, prototypes, RECORD_STARTS } from '../pose/actions/testFixtures';
import { POSE_ACTIONS, type ActionFeatures } from '../pose/actions/poseActionTypes';

vi.mock('../camera/usePoseCamera', () => ({ usePoseCamera: vi.fn() }));

describe('action panel and live camera integration', () => {
  let root: Root;
  let container: HTMLDivElement;
  let callbacks: Parameters<typeof usePoseCamera>[0];
  let now: number;
  let camera: ReturnType<typeof usePoseCamera>;

  const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === label)!;
  const panel = () => container.querySelector('.actions-panel')!;

  async function advance(ms: number) {
    now += ms;
    await act(async () => vi.advanceTimersByTime(ms));
  }

  function frame(values = features()) {
    const points = Array.from({ length: 33 }, () => ({ x: 0.5 + (values.deltaHipCenterX ?? 0), y: 0.5 + (values.deltaHipCenterY ?? 0), z: 0, visibility: 0.9 }));
    const world = points.map((point) => ({ ...point }));
    world[23].z = (values.deltaHipDepthDifference ?? 0) / 2;
    world[24].z = -(values.deltaHipDepthDifference ?? 0) / 2;
    callbacks?.onFrame?.({ timestamp: now, videoTime: now / 1000, landmarks: points, worldLandmarks: world });
  }

  async function neutralCalibration() {
    await act(async () => button('Calibrate Neutral').click());
    for (let index = 0; index < 20; index++) { await advance(50); frame(); }
    await advance(250);
    expect(button('Start Action Calibration').disabled).toBe(false);
  }

  async function actionCalibration() {
    await act(async () => button('Start Action Calibration').click());
    const renders = vi.mocked(usePoseCamera).mock.calls.length;
    for (let elapsed = 50; elapsed <= 15000; elapsed += 50) {
      await advance(50);
      const index = RECORD_STARTS.findIndex((start) => elapsed >= start - 1000 && elapsed < start + 1500);
      frame(index < 0 ? features() : prototypes()[POSE_ACTIONS[index]]!.features);
      if (elapsed === 200) expect(vi.mocked(usePoseCamera).mock.calls.length).toBe(renders);
      if (elapsed === 2500 || elapsed === 7500) {
        const previous = panel().textContent;
        await act(async () => button(elapsed === 2500 ? 'Mirror ON' : 'Mirror OFF').click());
        expect(panel().textContent).toBe(previous);
      }
    }
    await advance(250);
    expect(panel().textContent).toContain('Action Calibration: READY');
    expect([...panel().querySelectorAll('[aria-label="Action prototype readiness"] tbody tr')].every((row) => row.textContent?.includes('READY'))).toBe(true);
  }

  async function hold(values: ActionFeatures) {
    for (let index = 0; index < 16; index++) { await advance(50); frame(values); }
    await advance(200);
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    camera = {
      videoRef: createRef<HTMLVideoElement>(), canvasRef: createRef<HTMLCanvasElement>(),
      status: 'RUNNING', error: null, delegate: 'CPU', start: vi.fn(),
      stop: vi.fn(() => { callbacks?.onCameraStopped?.(); }),
      getRecordingContext: () => ({ delegate: 'CPU', videoWidth: 1280, videoHeight: 720 }),
      metrics: { cameraFps: 30, renderFps: 60, inferenceFps: 30, averageInferenceMs: 15,
        detected: true, visibility: Array(8).fill(0.9), signalLandmarks: Array(4).fill(null), width: 1280, height: 720 },
    };
    vi.mocked(usePoseCamera).mockImplementation((value) => { callbacks = value; return camera; });
    container = document.createElement('div'); document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<StrictMode><PoseCamera /></StrictMode>));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals();
  });

  it('guides per-inference calibration, classifies live actions, keeps Mirror independent, and invalidates on Neutral recalibration', async () => {
    expect(button('Start Action Calibration').disabled).toBe(true);
    expect(panel().textContent).toContain('Action calibration requires frozen Neutral calibration.');
    await neutralCalibration();
    await actionCalibration();
    await hold(prototypes().TWIST_LEFT!.features);
    expect(panel().textContent).toContain('Raw ActionTWIST_LEFT');
    expect(panel().textContent).toContain('Stable ActionTWIST_LEFT');
    const before = panel().textContent;
    await act(async () => button('Mirror ON').click());
    expect(panel().textContent).toBe(before);
    await act(async () => button('Mirror OFF').click());
    expect(panel().textContent).toBe(before);
    await act(async () => button('Calibrate Neutral').click());
    await advance(250);
    expect(panel().textContent).toContain('Action Calibration: IDLE');
    expect(panel().textContent).toContain('Stable ActionNONE');
    expect(panel().textContent).toContain('NOT_CALIBRATED');
    expect([...panel().querySelectorAll('[aria-label="Action prototype values"] td')].every((cell) => cell.textContent === '-')).toBe(true);
  });

  it('resets action samples and state when Camera Stop is pressed', async () => {
    await neutralCalibration();
    await actionCalibration();
    await hold(prototypes().KNEE_RIGHT!.features);
    expect(panel().textContent).toContain('Stable ActionKNEE_RIGHT');
    await act(async () => button('Stop Camera').click());
    await advance(250);
    expect(panel().textContent).toContain('Action Calibration: IDLE');
    expect(panel().textContent).toContain('Raw ActionNONE');
    expect(panel().textContent).toContain('Stable ActionNONE');
    expect(button('Start Action Calibration').disabled).toBe(true);
  });

  it('clears action buffers and timers on StrictMode unmount', async () => {
    const read = vi.spyOn(PoseActionAnalysis.prototype, 'getView');
    await neutralCalibration();
    await act(async () => button('Start Action Calibration').click());
    for (let elapsed = 50; elapsed <= 3000; elapsed += 50) { await advance(50); frame(prototypes().TWIST_LEFT!.features); }
    await advance(250);
    const analysis = read.mock.contexts.at(-1);
    const currentInput = read.mock.calls.at(-1)![0];
    if (!(analysis instanceof PoseActionAnalysis)) throw new Error('Missing analysis instance');
    expect(analysis.getView(currentInput, now).calibration.status).toBe('RUNNING');
    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    expect(analysis.getView(input(now), now).calibration).toMatchObject({ status: 'IDLE', prototypes: { TWIST_LEFT: null } });
    expect(analysis.getView(input(now), now).classification.stableAction).toBe('NONE');
  });
});
