import { VideoFrameAccounting } from '../replay/videoReplayMetrics';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplayRunner } from './ReplayRunner';
import { fullTrial } from '../replay/testFixtures';
import { inferReplayVideo } from '../replay/videoReplay';
import type { ReplaySession } from '../replay/replayTypes';

vi.mock('../replay/videoReplay', () => ({ inferReplayVideo: vi.fn() }));
let root: Root, container: HTMLDivElement, session: ReplaySession;
function button(name: string) { return [...container.querySelectorAll('button')].find((button) => button.textContent === name)!; }
async function choose(index: number, file: File) {
  const input = container.querySelectorAll('input')[index];
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
function jsonFile(value = session) {
  const file = new File([''], 'capture.json');
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify(value) }); return file;
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  session = (await fullTrial()).session;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<ReplayRunner />));
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals();
});
describe('Replay Runner isolation and file lifecycle', () => {
  it('runs deterministic and calibration replays without video and clears old results on new JSON', async () => {
    await choose(0, jsonFile());
    expect(button('LANDMARK REPLAY').disabled).toBe(false); expect(button('VIDEO REPLAY').disabled).toBe(true);
    await act(async () => button('LANDMARK REPLAY').click());
    await act(async () => button('CALIBRATION REPLAY').click());
    expect(container.textContent).toContain('Events/time MATCH');
    expect(container.textContent).toContain('Calibration: Neutral MATCH · Kick baseline MATCH');
    await choose(1, new File(['old'], session.video.filename));
    expect(button('VIDEO REPLAY').disabled).toBe(false);
    await choose(0, jsonFile({ ...session, captureId: 'second-capture' }));
    expect(button('VIDEO REPLAY').disabled).toBe(true);
    expect(container.textContent).not.toContain('Events/time MATCH'); expect(container.textContent).not.toContain('Calibration: Neutral MATCH');
    expect(container.textContent).toContain('second-capture'); expect(button('Download Replay Results JSON').disabled).toBe(true);
  });
  it.each(['filename', 'captureId'] as const)('blocks mismatched %s before Video inference without blocking Landmark replay', async (kind) => {
    const loaded = kind === 'captureId' ? { ...session, captureId: 'different-capture' } : session;
    await choose(0, jsonFile(loaded));
    await choose(1, new File(['video'], kind === 'filename' ? 'other-capture.webm' : session.video.filename));
    const mismatch = 'Replay JSON과 다른 capture의 WebM입니다.';
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(mismatch);
    expect(button('VIDEO REPLAY').disabled).toBe(true);
    await act(async () => button('VIDEO REPLAY').click());
    expect(inferReplayVideo).not.toHaveBeenCalled();
    expect(button('LANDMARK REPLAY').disabled).toBe(false);
    await act(async () => button('LANDMARK REPLAY').click());
    expect(container.textContent).toContain('Events/time MATCH');
    expect(container.textContent).toContain(mismatch);
    if (kind === 'captureId') await choose(0, jsonFile(session));
    await choose(1, new File(['video'], session.video.filename));
    expect(container.textContent).not.toContain(mismatch);
    expect(button('VIDEO REPLAY').disabled).toBe(false);
  });

  it('shows total and Guided frame coverage separately and includes diagnostics in local result export', async () => {
    session.video.filename = 'clean인가.webm'; // Custom name must also be declared by the JSON.
    const accounting = new VideoFrameAccounting();
    for (const frame of session.poseFrames) { accounting.accept(frame.tMs); accounting.recordProcessed(frame.tMs); }
    vi.mocked(inferReplayVideo).mockResolvedValue({ frames: session.poseFrames, delegate: 'CPU', modelUrl: session.pose.modelUrl,
      diagnostics: accounting.snapshot(700) });
    let blob: Blob | null = null;
    vi.stubGlobal('URL', { createObjectURL: vi.fn((value: Blob) => { blob = value; return 'blob:local-result'; }), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await choose(0, jsonFile()); await choose(1, new File(['video'], 'clean인가.webm'));
    await act(async () => button('VIDEO REPLAY').click());
    const panel = container.querySelector('[aria-label="Video frame completeness"]')!;
    expect(panel.textContent).toContain(`전체 · Recorded Pose Frames: ${session.poseFrames.length} / Video Processed Frames: ${session.poseFrames.length}`);
    expect(panel.textContent).toContain(`Recorded Pose Frames: ${session.liveResult.trials[0].result.poseFrameCount} / Video Processed Frames: ${session.liveResult.trials[0].result.poseFrameCount}`);
    expect(panel.textContent).toContain('Duplicate timestamps: 0 · Skipped: 0');
    expect(panel.textContent).toContain('Median interval ms'); expect(panel.textContent).toContain('Max interval ms');
    await act(async () => button('Download Replay Results JSON').click());
    const json = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob!); });
    expect(JSON.parse(json).video.videoDiagnostics.guidedInterval.recordedPoseFrameCount).toBe(session.liveResult.trials[0].result.poseFrameCount);
    await choose(1, new File(['new'], 'new.webm'));
    expect(container.querySelector('[aria-label="Video frame completeness"]')).toBeNull();
  });

  it.each(['new-file', 'unmount', 'cancel'] as const)('aborts an active video replay on %s', async (action) => {
    let signal!: AbortSignal;
    vi.mocked(inferReplayVideo).mockImplementation((_video, _file, _session, passed) => {
      signal = passed;
      return new Promise((_resolve, reject) => passed.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError'))));
    });
    await choose(0, jsonFile()); await choose(1, new File(['video'], session.video.filename));
    await act(async () => button('VIDEO REPLAY').click());
    expect(signal.aborted).toBe(false); expect(button('LANDMARK REPLAY').disabled).toBe(true);
    if (action === 'unmount') await act(async () => root.unmount());
    else if (action === 'cancel') await act(async () => button('Cancel Video Replay').click());
    else await choose(1, new File(['different'], 'other.webm'));
    expect(signal.aborted).toBe(true);
    expect(container.textContent).not.toContain('VIDEO: Events/time');
    if (action === 'new-file') {
      expect(container.textContent).toContain('Replay JSON과 다른 capture의 WebM입니다.');
      expect(button('VIDEO REPLAY').disabled).toBe(true);
    }
  });
  it('shows validation errors and keeps replay disabled for a malformed local JSON', async () => {
    await choose(0, jsonFile({ version: 3 } as unknown as ReplaySession));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Replay JSON');
    expect(button('LANDMARK REPLAY').disabled).toBe(true);
  });
});

describe('STEP 4H candidate selection', () => {
  it('runs V3 only on the explicit LANDMARK button, exports X reference and clears it on file replacement', async () => {
    let blob: Blob | null = null;
    vi.stubGlobal('URL', { createObjectURL: vi.fn((value: Blob) => { blob = value; return 'blob:v3'; }), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await choose(0, jsonFile());
    expect(button('Y V3 LANDMARK REPLAY').disabled).toBe(false);
    await act(async () => button('Y V3 LANDMARK REPLAY').click());
    const panel = container.querySelector('[aria-label="Y V3 replay diagnostics"]');
    expect(panel?.textContent).toContain('STORED_V3'); expect(panel?.textContent).toContain('Cross-gap: 0');
    expect(inferReplayVideo).not.toHaveBeenCalled();
    await act(async () => button('Download Replay Results JSON').click());
    const json = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob!); });
    const exported = JSON.parse(json);
    expect(exported.v3.detector).toBe('Y_KICK_V3'); expect(exported.v3.config.experimental).toBe(true);
    expect(exported.v3.legacyX.result.events).toHaveLength(2); // This fixture moves X only.
    expect(exported.v3.result.events).toHaveLength(0);
    expect(exported.landmark).toBeNull(); expect(exported.video).toBeNull();
    await choose(0, jsonFile({ ...session, captureId: 'replacement' }));
    expect(container.querySelector('[aria-label="Y V3 replay diagnostics"]')).toBeNull();
    expect(button('Download Replay Results JSON').disabled).toBe(true);
  });
});
