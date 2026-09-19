import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePoseCamera } from '../camera/usePoseCamera';
import { PoseCamera } from './PoseCamera';

vi.mock('../camera/usePoseCamera', () => ({ usePoseCamera: vi.fn() }));

describe('Pose signal debug panel', () => {
  let root: Root;
  let container: HTMLDivElement;
  let camera: ReturnType<typeof usePoseCamera>;

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    camera = {
      videoRef: createRef<HTMLVideoElement>(),
      canvasRef: createRef<HTMLCanvasElement>(),
      status: 'RUNNING', error: null, delegate: 'CPU', start: vi.fn(), stop: vi.fn(),
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
    vi.mocked(usePoseCamera).mockReturnValue(camera);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<PoseCamera />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
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
});
