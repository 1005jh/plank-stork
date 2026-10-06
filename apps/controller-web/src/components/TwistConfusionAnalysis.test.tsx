import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwistConfusionAnalysis } from './TwistConfusionAnalysis';
import { fullV3Trial } from '../replay/testFixtures';
const { download, clear } = vi.hoisted(() => ({ download: vi.fn(), clear: vi.fn() }));
vi.mock('../replay/useLocalDownload', () => ({ useLocalDownload: () => ({ download, clear }) }));
let root: Root | null, container: HTMLDivElement;
const button = (name: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === name)!;
function file(name: string, text: () => Promise<string>) { const f = new File([''], name); Object.defineProperty(f, 'text', { value: text }); return f; }
async function select(files: File[]) {
  const input = container.querySelector('input')!; Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
async function assign(index: number, role: string) {
  await act(async () => { const input = container.querySelectorAll('select')[index]; input.value = role; input.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function settle() {
  for (let i = 0; i < 400; i++) {
    await act(async () => { await new Promise((done) => setTimeout(done, 5)); });
    if (!container.querySelector('[role="status"]')) return;
  } throw new Error('Twist analysis did not settle');
}
async function readBlob() {
  return new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(download.mock.calls.at(-1)![0]); });
}
beforeEach(async () => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container);
  root = createRoot(container); await act(async () => root!.render(<TwistConfusionAnalysis />)); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); container.remove(); vi.useRealTimers(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('separate STEP4L local analysis UI', () => {
  it('requires manual roles and measured distributions first; HOLDOUT alias always exports post-failure provenance', async () => {
    const { session } = await fullV3Trial(), fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await select(['old.json', 'stress.json', 'live1.json', 'live2.json', 'REFERENCE_LIVE_3_HOLDOUT.json'].map((name, i) => file(name, async () => JSON.stringify({ ...session, captureId: `capture-${i}` }))));
    expect([...container.querySelectorAll('select')].map((s) => s.value)).toEqual(Array(5).fill('UNASSIGNED'));
    expect(button('Analyze Twist/Kick Confusion').disabled).toBe(true); expect(button('Compare Twist Entry Guards').disabled).toBe(true);
    for (const [i, role] of ['REFERENCE_OLD_CLEAN', 'STRESS', 'REFERENCE_LIVE_1', 'REFERENCE_LIVE_2_INDEPENDENT', 'REFERENCE_LIVE_3_HOLDOUT'].entries()) await assign(i, role);
    await act(async () => button('Analyze Twist/Kick Confusion').click()); await settle();
    expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.textContent).toContain('Stage distributions');
    expect(container.textContent).toContain('REFERENCE_LIVE_3_HOLDOUT_FAILURE');
    await act(async () => button('Download Twist JSON').click());
    const evidence = JSON.parse(await readBlob()); expect(evidence).not.toHaveProperty('strategyResults');
    expect(evidence.analysisStatus).toBe('POST_FAILURE_EXPLORATORY'); expect(evidence.references).toHaveLength(5);
    await act(async () => button('Download Twist Traces CSV').click()); expect(await readBlob()).toContain('relativeToCandidateStartMs');
    await act(async () => button('Compare Twist Entry Guards').click()); await settle();
    expect(container.textContent).toContain('28 exploratory configs');
    await act(async () => button('Download Twist JSON').click()); const result = JSON.parse(await readBlob());
    expect(result.strategyResults).toHaveLength(28); expect(result).not.toHaveProperty('holdoutValidation');
    expect(result.settings.integrity.velocity).toBe(12); expect(fetch).not.toHaveBeenCalled();
    await assign(4, 'UNASSIGNED'); expect(button('Download Twist JSON').disabled).toBe(true); expect(button('Compare Twist Entry Guards').disabled).toBe(true);
  }, 15000);
  it('stops on LIVE parity mismatch before evidence or strategies can be downloaded', async () => {
    const { session } = await fullV3Trial(); session!.liveResult.trials[0].result.events[0].tMs++;
    await select([file('bad.json', async () => JSON.stringify(session))]); await assign(0, 'REFERENCE_LIVE_3_HOLDOUT_FAILURE');
    await act(async () => button('Analyze Twist/Kick Confusion').click()); await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('LIVE_V3_PARITY_MISMATCH');
    expect(button('Compare Twist Entry Guards').disabled).toBe(true); expect(button('Download Twist JSON').disabled).toBe(true);
  });
  it('cancels pending strategy work on cancel/reset/unmount without publishing stale results', async () => {
    const json = JSON.stringify((await fullV3Trial()).session);
    for (const action of ['Cancel Twist Analysis', 'Reset Twist Analysis', 'unmount']) {
      await select([file('test.json', async () => json)]); await assign(0, 'REFERENCE_LIVE_1');
      await act(async () => button('Analyze Twist/Kick Confusion').click()); await settle();
      vi.useFakeTimers(); await act(async () => button('Compare Twist Entry Guards').click());
      await act(async () => { if (action === 'unmount') { root!.unmount(); root = null; } else button(action).click(); });
      await act(async () => vi.runAllTimersAsync()); vi.useRealTimers();
      expect(container.textContent).not.toContain('28 exploratory configs'); expect(download).not.toHaveBeenCalled();
    }
  });
  it('invalidates pending reads on replacement and reset and rejects malformed files', async () => {
    let resolve!: (s: string) => void; const json = JSON.stringify((await fullV3Trial()).session), pending = () => file('pending.json', () => new Promise((r) => { resolve = r; }));
    await select([pending()]); await select([file('invalid.json', async () => 'not json')]); await act(async () => resolve(json));
    expect(container.querySelector('[role="alert"]')).not.toBeNull(); expect(container.querySelector('select')).toBeNull();
    await select([pending()]); await act(async () => button('Reset Twist Analysis').click()); await act(async () => resolve(json));
    expect(container.querySelector('select')).toBeNull(); expect(download).not.toHaveBeenCalled();
  });
});
