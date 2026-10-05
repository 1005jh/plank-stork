import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MultiSignalAnalysis } from './MultiSignalAnalysis';
import { fullV3Trial } from '../replay/testFixtures';

const { download, clear } = vi.hoisted(() => ({ download: vi.fn(), clear: vi.fn() }));
vi.mock('../replay/useLocalDownload', () => ({ useLocalDownload: () => ({ download, clear }) }));
let root: Root | null, container: HTMLDivElement;
const button = (name: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === name)!;
function file(name: string, text: () => Promise<string>) {
  const f = new File([''], name, { type: 'application/json' }); Object.defineProperty(f, 'text', { value: text }); return f;
}
async function select(files: File[]) {
  const input = container.querySelector('input')!; Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
async function assign(index: number, role: string) {
  await act(async () => { const select = container.querySelectorAll('select')[index]; select.value = role; select.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function settled() {
  for (let i = 0; i < 400; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    if (!container.querySelector('[role="status"]')) return;
  }
  throw new Error('analysis did not settle');
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container);
  root = createRoot(container); await act(async () => root!.render(<MultiSignalAnalysis />));
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount()); container.remove(); vi.clearAllMocks(); vi.unstubAllGlobals();
});
describe('STEP 4J saved-capture analysis UI', () => {
  it('never infers roles from filenames; exports 491 configs locally and invalidates after role edits', async () => {
    const { session } = await fullV3Trial(), fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await select(['clean인가요.json', '3차검증2.json', 'live.json'].map((name, i) => file(name, async () => JSON.stringify({ ...session, captureId: `fixture-${i}` }))));
    expect([...container.querySelectorAll('select')].map((s) => s.value)).toEqual(['UNASSIGNED', 'UNASSIGNED', 'UNASSIGNED']);
    expect(button('Run Multi-Signal Analysis').disabled).toBe(true);
    await assign(0, 'REFERENCE_OLD_CLEAN'); await assign(1, 'STRESS'); await assign(2, 'REFERENCE_LIVE');
    await act(async () => button('Run Multi-Signal Analysis').click()); await settled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('/ 491'); expect(container.textContent).toContain('Flexion signal by stage / limb');
    await act(async () => button('Download Multi-Signal JSON').click()); expect(download).toHaveBeenCalledOnce();
    const json = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(download.mock.calls[0][0]); });
    const result = JSON.parse(json);
    expect(result.strategies).toHaveLength(491); expect(result.inputs.map((i: { role: string }) => i.role)).toEqual(['REFERENCE_OLD_CLEAN', 'STRESS', 'REFERENCE_LIVE']);
    expect(result.liveReplayParity.every((p: { matched: boolean }) => p.matched)).toBe(true);
    expect(json).not.toMatch(/"(landmarks|worldLandmarks|samples)":/); expect(fetch).not.toHaveBeenCalled();
    await act(async () => button('Next multi-signal configs').click()); expect(container.textContent).toContain('51–100 / 491');
    expect(container.textContent).toContain('F 8°/');
    await assign(2, 'UNASSIGNED'); expect(button('Download Multi-Signal JSON').disabled).toBe(true);
  }, 15000);
  it('shows a parity failure and cannot export a sweep that used mismatched LIVE evidence', async () => {
    const { session } = await fullV3Trial(); session!.liveResult.trials[0].result.events[0].tMs++;
    await select([file('bad.json', async () => JSON.stringify(session))]); await assign(0, 'REFERENCE_LIVE');
    await act(async () => button('Run Multi-Signal Analysis').click()); await settled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('LIVE_V3_PARITY_MISMATCH');
    expect(button('Download Multi-Signal JSON').disabled).toBe(true);
  });
  it('cancels pending sweeps on cancel/reset/unmount without a download or stale report', async () => {
    const json = JSON.stringify((await fullV3Trial()).session);
    await select([file('a.json', async () => json)]); await assign(0, 'REFERENCE_LIVE');
    await act(async () => button('Run Multi-Signal Analysis').click());
    await act(async () => button('Cancel Multi-Signal Analysis').click()); await settled();
    expect(button('Download Multi-Signal JSON').disabled).toBe(true);
    await act(async () => button('Run Multi-Signal Analysis').click());
    await act(async () => button('Reset Multi-Signal Analysis').click()); await settled();
    expect(button('Run Multi-Signal Analysis').disabled).toBe(true); expect(container.querySelector('select')).toBeNull();
    await select([file('again.json', async () => json)]); await assign(0, 'REFERENCE_LIVE');
    await act(async () => button('Run Multi-Signal Analysis').click());
    await act(async () => root!.unmount()); root = null;
    await act(async () => { await new Promise((done) => setTimeout(done, 10)); });
    expect(container.textContent).toBe(''); expect(download).not.toHaveBeenCalled();
  });
  it('discards pending file reads on replacement/reset/unmount and reports invalid JSON', async () => {
    const json = JSON.stringify((await fullV3Trial()).session); let resolve!: (value: string) => void;
    const pending = () => file('pending.json', () => new Promise((done) => { resolve = done; }));
    await select([pending()]); await select([file('bad.json', async () => 'not json')]);
    await act(async () => resolve(json)); expect(container.querySelector('[role="alert"]')).not.toBeNull(); expect(container.querySelector('select')).toBeNull();
    await select([pending()]); await act(async () => button('Reset Multi-Signal Analysis').click()); await act(async () => resolve(json));
    expect(container.querySelector('select')).toBeNull();
    await select([pending()]); await act(async () => root!.unmount()); root = null; await act(async () => resolve(json));
    expect(download).not.toHaveBeenCalled(); expect(container.textContent).toBe('');
  });
});
