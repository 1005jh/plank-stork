// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BodyLocalAnalysis } from './BodyLocalAnalysis';
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
  } throw new Error('Body-local analysis did not settle');
}
async function readBlob() {
  return new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(download.mock.calls.at(-1)![0]); });
}
beforeEach(async () => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container);
  root = createRoot(container); await act(async () => root!.render(<BodyLocalAnalysis />)); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); container.remove(); vi.useRealTimers(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('separate STEP4M local analysis UI', () => {
  it('requires manual roles, exports distributions before comparing, and downloads only locally', async () => {
    const { session } = await fullV3Trial(), fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await select(['old.json', 'stress.json', 'live1.json', 'live2.json', 'REFERENCE_LIVE_3.json'].map((name, i) => file(name, async () => JSON.stringify({ ...session, captureId: `capture-${i}` }))));
    expect([...container.querySelectorAll('select')].map((s) => s.value)).toEqual(Array(5).fill('UNASSIGNED'));
    expect(button('Inspect Body-local Features').disabled).toBe(true); expect(button('Compare Candidate Families').disabled).toBe(true);
    for (const [i, role] of ['REFERENCE_OLD_CLEAN', 'STRESS', 'REFERENCE_LIVE_1', 'REFERENCE_LIVE_2', 'REFERENCE_LIVE_3'].entries()) await assign(i, role);
    await act(async () => button('Inspect Body-local Features').click()); await settle();
    expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.textContent).toContain('Per-stage / label distributions');
    expect(container.textContent).toContain('REFERENCE_LIVE_3');
    await act(async () => button('Download Body-local JSON').click());
    const evidence = JSON.parse(await readBlob()); expect(evidence).not.toHaveProperty('candidateFamilyResults');
    expect(evidence.analysisStatus).toBe('POST_FAILURE_EXPLORATORY'); expect(evidence.references).toHaveLength(5);
    expect(button('Compare Causal Temporal Candidates').disabled).toBe(true);
    await act(async () => button('Compare Candidate Families').click()); await settle();
    expect(container.textContent).toContain('256 configs');
    await act(async () => button('Download Body-local JSON').click()); const result = JSON.parse(await readBlob());
    expect(result.candidateFamilyResults).toHaveLength(256); expect(result).not.toHaveProperty('holdoutValidation');
    expect(result.settings.runtime.staleMs).toBe(400); expect(fetch).not.toHaveBeenCalled();
    await assign(4, 'UNASSIGNED'); expect(button('Download Body-local JSON').disabled).toBe(true); expect(button('Compare Candidate Families').disabled).toBe(true);
  }, 15000);
  it('stops on LIVE parity mismatch before evidence or strategies can be downloaded', async () => {
    const { session } = await fullV3Trial(); session!.liveResult.trials[0].result.events[0].tMs++;
    await select([file('bad.json', async () => JSON.stringify(session))]); await assign(0, 'REFERENCE_LIVE_3');
    await act(async () => button('Inspect Body-local Features').click()); await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('LIVE_V3_PARITY_MISMATCH');
    expect(button('Compare Candidate Families').disabled).toBe(true); expect(button('Download Body-local JSON').disabled).toBe(true);
  });
  it('cancels pending strategy work on cancel/reset/unmount without publishing stale results', async () => {
    const json = JSON.stringify((await fullV3Trial()).session);
    for (const action of ['Cancel Body-local Analysis', 'Reset Body-local Analysis', 'unmount']) {
      await select([file('test.json', async () => json)]); await assign(0, 'REFERENCE_LIVE_1');
      await act(async () => button('Inspect Body-local Features').click()); await settle();
      vi.useFakeTimers(); await act(async () => button('Compare Candidate Families').click());
      await act(async () => { if (action === 'unmount') { root!.unmount(); root = null; } else button(action).click(); });
      await act(async () => vi.runAllTimersAsync()); vi.useRealTimers();
      expect(container.textContent).not.toContain('256 configs'); expect(download).not.toHaveBeenCalled();
    }
  });
  it('invalidates pending reads on replacement and reset and rejects malformed files', async () => {
    let resolve!: (s: string) => void; const json = JSON.stringify((await fullV3Trial()).session), pending = () => file('pending.json', () => new Promise((r) => { resolve = r; }));
    await select([pending()]); await select([file('invalid.json', async () => 'not json')]); await act(async () => resolve(json));
    expect(container.querySelector('[role="alert"]')).not.toBeNull(); expect(container.querySelector('select')).toBeNull();
    await select([pending()]); await act(async () => button('Reset Body-local Analysis').click()); await act(async () => resolve(json));
    expect(container.querySelector('select')).toBeNull(); expect(download).not.toHaveBeenCalled();
  });
});
