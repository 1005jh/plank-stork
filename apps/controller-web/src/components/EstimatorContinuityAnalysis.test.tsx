import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EstimatorContinuityAnalysis } from './EstimatorContinuityAnalysis';
import { fullV3Trial } from '../replay/testFixtures';
import { decodeEstimatorFrames, runEstimator, validateEstimatorMedia } from '../estimator/estimatorInference';
import { estimatorAnchors, analyzeEstimator, compareEstimators } from '../estimator/estimatorAnalysis';
vi.mock('../estimator/estimatorInference', async (original) => ({ ...await original<typeof import('../estimator/estimatorInference')>(), decodeEstimatorFrames: vi.fn(), runEstimator: vi.fn() }));
vi.mock('../estimator/estimatorAnalysis', async (original) => ({ ...await original<typeof import('../estimator/estimatorAnalysis')>(), estimatorAnchors: vi.fn(), analyzeEstimator: vi.fn(), compareEstimators: vi.fn() }));
const { download, clear } = vi.hoisted(() => ({ download: vi.fn(), clear: vi.fn() }));
vi.mock('../replay/useLocalDownload', () => ({ useLocalDownload: () => ({ download, clear }) }));
let root: Root | null, container: HTMLDivElement;
const button = (name: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === name)!;
async function select(index: number, files: File[]) {
  const input = container.querySelectorAll('input')[index]; Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
async function setup(valid = true) {
  const session = (await fullV3Trial()).session!; session.pose.delegate = 'GPU';
  const json = new File([], 'REFERENCE_LIVE_1.json'); Object.defineProperty(json, 'text', { value: async () => JSON.stringify(session) });
  await select(0, [json]);
  expect(container.querySelector('select')!.value).toBe('UNASSIGNED');
  await act(async () => { const el = container.querySelector('select')!; el.value = 'REFERENCE_LIVE_1'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await select(1, [new File([], valid ? session.video.filename : 'wrong.webm')]);
}
async function settle() { for (let i = 0; i < 30; i++) { await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); if (!container.querySelector('[role="status"]')) return; } throw new Error('UI did not settle'); }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container);
  root = createRoot(container); await act(async () => root!.render(<EstimatorContinuityAnalysis />));
  vi.mocked(estimatorAnchors).mockReturnValue([{ trialId: 1, anchors: [] }]);
  vi.mocked(decodeEstimatorFrames).mockResolvedValue({ timestamps: [0], sequence: { decodedFrameCount: 1, firstTimestamp: 0, lastTimestamp: 0, timestampHash: 'hash', timestampUnit: 'media PTS milliseconds' } });
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); container.remove(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe('separate estimator experiment UI', () => {
  it('rejects media mismatch before decode or inference, regardless of manual role', async () => {
    await setup(false); await act(async () => button('1. Validate Media Pair').click()); await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Replay JSON과 다른 capture');
    expect(button('2. Decode Frames').disabled).toBe(true); expect(decodeEstimatorFrames).not.toHaveBeenCalled(); expect(runEstimator).not.toHaveBeenCalled();
  });
  it('orders decode and all three variant steps and only downloads locally', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); await setup();
    await act(async () => button('1. Validate Media Pair').click()); await settle();
    expect(button('3. Run FULL_VIDEO_CONTROL').disabled).toBe(true);
    await act(async () => button('2. Decode Frames').click()); await settle();
    expect(button('3. Run FULL_VIDEO_CONTROL').disabled).toBe(false); expect(button('4. Run FULL_IMAGE').disabled).toBe(true);
    vi.mocked(runEstimator).mockImplementation(async (file, session, variant, plan) => ({ variant, sequence: plan.sequence,
      frames: [], mediaIdentity: validateEstimatorMedia(session, file), frameSequenceParity: true, config: {} as never, clock: 'decoded media PTS * 1000 = existing VIDEO replay capture tMs mapping' }));
    vi.mocked(analyzeEstimator).mockImplementation((input, run) => ({ input: { filename: input.filename, captureId: input.session.captureId, role: input.role },
      variant: run.variant, sequence: run.sequence, trials: [], mediaIdentity: run.mediaIdentity, frameSequenceParity: true, performance: {} as never }));
    for (const name of ['3. Run FULL_VIDEO_CONTROL', '4. Run FULL_IMAGE', '5. Run HEAVY_VIDEO']) { await act(async () => button(name).click()); await settle(); }
    expect(runEstimator).toHaveBeenCalledTimes(3); expect(button('6. Compare Estimators').disabled).toBe(false);
    vi.mocked(compareEstimators).mockReturnValue({ attribution: 'INSUFFICIENT_EVIDENCE', perVariant: [], step: '4O' } as never);
    await act(async () => button('6. Compare Estimators').click()); await act(async () => button('Download Estimator Report').click());
    expect(download).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
    await act(async () => button('Reset Estimator Analysis').click()); expect(button('Download Estimator Report').disabled).toBe(true);
  });
  it.each(['Cancel Estimator Analysis', 'Reset Estimator Analysis', 'unmount'])('aborts in-flight resources on %s without publishing stale output', async (action) => {
    await setup(); await act(async () => button('1. Validate Media Pair').click()); await settle();
    let signal: AbortSignal | undefined, resolve!: (value: Awaited<ReturnType<typeof decodeEstimatorFrames>>) => void;
    vi.mocked(decodeEstimatorFrames).mockImplementation((_file, _session, s) => { signal = s; return new Promise((r) => { resolve = r; }); });
    await act(async () => button('2. Decode Frames').click()); expect(signal?.aborted).toBe(false);
    if (action === 'unmount') { await act(async () => root!.unmount()); root = null; }
    else await act(async () => button(action).click());
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve({ timestamps: [0], sequence: {} as never }));
    if (root) expect(button('3. Run FULL_VIDEO_CONTROL').disabled).toBe(true);
    expect(runEstimator).not.toHaveBeenCalled();
  });
});
