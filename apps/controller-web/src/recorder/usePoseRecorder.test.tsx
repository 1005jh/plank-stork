import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PoseRecorder } from '../components/PoseRecorder';
import { usePoseRecorder } from './usePoseRecorder';
import type { PoseDataset, PoseFrame, RecordingCameraContext } from './poseRecorderTypes';

describe('guided recorder UI, speech, and local download', () => {
  let root: Root;
  let container: HTMLDivElement;
  let recorder: ReturnType<typeof usePoseRecorder>;
  let context: RecordingCameraContext | null;
  let now: number;
  let renders: number;
  let json: string;
  let filename: string;
  let speak: ReturnType<typeof vi.fn>;
  let cancel: ReturnType<typeof vi.fn>;

  function Probe() {
    recorder = usePoseRecorder();
    renders++;
    return <PoseRecorder recorder={recorder} canStart={context !== null} onStart={() => recorder.start(context, true)} />;
  }

  async function advance(ms: number) {
    now += ms;
    await act(async () => vi.advanceTimersByTime(ms));
  }

  const rawFrame = (timestamp: number): PoseFrame => ({
    timestamp, videoTime: timestamp / 1000,
    landmarks: Array.from({ length: 33 }, () => ({ x: 0.123456789, y: 0.5, z: -0.25, visibility: 0.9 })),
    worldLandmarks: Array.from({ length: 33 }, () => ({ x: -0.1, y: 0.2, z: 0.3 })),
  });

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    now = 0;
    renders = 0;
    json = '';
    filename = '';
    context = { delegate: 'CPU', videoWidth: 1280, videoHeight: 720 };
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    speak = vi.fn();
    cancel = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak, cancel });
    vi.stubGlobal('SpeechSynthesisUtterance', class { lang = ''; constructor(public text: string) {} });
    const OriginalBlob = Blob;
    vi.stubGlobal('Blob', class extends OriginalBlob {
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        json = String(parts[0]);
      }
    });
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn(() => 'blob:pose-test');
      static revokeObjectURL = vi.fn();
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<StrictMode><Probe /></StrictMode>));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('blocks recording when the raw camera/pose context is unavailable', async () => {
    context = null;
    await act(async () => root.render(<StrictMode><Probe /></StrictMode>));
    const start = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Start Guided Recording')!;
    expect(start.disabled).toBe(true);
    await act(async () => recorder.start(null, true));
    expect(recorder.view.status).toBe('IDLE');
    expect(recorder.error).toContain('Pose가 감지');
    expect(speak).not.toHaveBeenCalled();
  });

  it('guides each stage, captures raw frames without renders, and downloads complete JSON locally', async () => {
    await act(async () => recorder.start(context, true));
    expect(recorder.view.stage?.phase).toBe('PREPARE');
    expect(speak.mock.calls.at(-1)?.[0].text).toBe('준비하세요');
    await advance(5000);
    expect(recorder.view.stage?.phase).toBe('STABILIZE');
    expect(container.textContent).toContain('자세 안정화 중');
    expect(speak.mock.calls.at(-1)?.[0].text).toBe('자세 안정화 중');
    recorder.recordFrame(rawFrame(now));
    recorder.recordFrame({ ...rawFrame(now + 1), landmarks: [] });
    await advance(1000);
    expect(recorder.view.totalSamples).toBe(0);
    expect(recorder.view.droppedPoseFrameCount).toBe(0);
    expect(speak.mock.calls.at(-1)?.[0].text).toBe('기본 플랭크');
    const renderCount = renders;
    for (let index = 0; index < 30; index++) recorder.recordFrame(rawFrame(now + index));
    recorder.recordFrame({ ...rawFrame(now + 30), landmarks: [] });
    expect(renders).toBe(renderCount);
    expect(recorder.view.totalSamples).toBe(0);
    await advance(100);
    expect(recorder.view.totalSamples).toBe(30);
    expect(recorder.view.droppedPoseFrameCount).toBe(1);
    await advance(2900);
    expect(recorder.view.stage).toMatchObject({ phase: 'TRANSITION', nextLabel: 'TWIST_LEFT' });
    expect(speak.mock.calls.at(-1)?.[0].text).toContain('기본 자세를 거쳐 왼쪽 트위스트');
    recorder.recordFrame(rawFrame(now));
    for (const spoken of ['왼쪽 트위스트', '기본 자세를 거쳐 오른쪽 트위스트', '오른쪽 트위스트',
      '기본 자세를 거쳐 왼쪽 니킥', '왼쪽 니킥', '기본 자세를 거쳐 오른쪽 니킥', '오른쪽 니킥', '기록 완료']) {
      await advance(3000);
      expect(speak.mock.calls.at(-1)?.[0].text).toBe(spoken);
    }
    expect(recorder.view.status).toBe('COMPLETED');
    expect(container.querySelector('[aria-label="Recorded samples per label"] tbody')?.children).toHaveLength(5);
    await act(async () => recorder.download());
    const dataset = JSON.parse(json) as PoseDataset;
    expect(dataset).toMatchObject({ version: 1, model: 'pose_landmarker_full', delegate: 'CPU',
      videoWidth: 1280, videoHeight: 720, previewMirrored: true, status: 'COMPLETED', droppedPoseFrameCount: 1 });
    expect(dataset.samples).toHaveLength(30);
    expect(dataset.samples[0].landmarks[0].x).toBe(0.123456789);
    expect(dataset.sampleCounts.NEUTRAL).toBe(30);
    expect(dataset.droppedPoseFrameCounts.NEUTRAL).toBe(1);
    expect(container.textContent).toContain('30 samples / 1 dropped');
    expect(Number.isFinite(dataset.timeOrigin)).toBe(true);
    expect(filename).toMatch(/^plank-stork-pose-.*\.json$/);
    expect(container.querySelector('a')).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await advance(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pose-test');
  });

  it.each(['unsupported', 'throws'])('continues recording when speech is %s', async (mode) => {
    if (mode === 'unsupported') vi.stubGlobal('speechSynthesis', undefined);
    else speak.mockImplementation(() => { throw new Error('speech unavailable'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await act(async () => recorder.start(context, false));
    await advance(6000);
    recorder.recordFrame(rawFrame(now));
    await advance(27000);
    expect(recorder.view.status).toBe('COMPLETED');
    expect(recorder.view.totalSamples).toBe(1);
    expect(recorder.error).toBeNull();
  });

  it('interrupts safely and resets an active dataset without recording further frames', async () => {
    await act(async () => recorder.start(context, false));
    await advance(6000);
    recorder.recordFrame(rawFrame(now));
    recorder.interrupt();
    recorder.recordFrame(rawFrame(now + 1));
    await advance(100);
    expect(recorder.view.status).toBe('INTERRUPTED');
    expect(recorder.view.totalSamples).toBe(1);
    await act(async () => recorder.reset());
    expect(recorder.view.status).toBe('IDLE');
    expect(recorder.view.totalSamples).toBe(0);
    await act(async () => recorder.start(context, true));
    expect(recorder.view.stage?.phase).toBe('PREPARE');
    await act(async () => recorder.reset());
    recorder.recordFrame(rawFrame(now + 6000));
    await advance(10000);
    expect(recorder.view.totalSamples).toBe(0);
    expect(recorder.view.status).toBe('IDLE');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels countdown timers and speech on unmount', async () => {
    await act(async () => recorder.start(context, true));
    expect(vi.getTimerCount()).toBe(1);
    const cancelsBefore = cancel.mock.calls.length;
    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    expect(cancel.mock.calls.length).toBeGreaterThan(cancelsBefore);
  });
});
