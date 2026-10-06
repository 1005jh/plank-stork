import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrityAnalysis } from './IntegrityAnalysis';
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
  } throw new Error('Integrity analysis did not settle');
}
async function readBlob() {
  return new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(download.mock.calls.at(-1)![0]); });
}
beforeEach(async () => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container);
  root = createRoot(container); await act(async () => root!.render(<IntegrityAnalysis />)); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); container.remove(); vi.useRealTimers(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('local integrity feature/guard UI', () => {
  it('allows an explicit HOLDOUT role, disables its sweep and exports only the pre-registered acceptance', async () => {
    const json = JSON.stringify((await fullV3Trial()).session);
    await select([file('REFERENCE_LIVE_3_HOLDOUT.json', async () => json)]);
    const selector = container.querySelector('select')!;
    expect(selector.value).toBe('UNASSIGNED');
    expect([...selector.options].map((o) => o.value)).toContain('REFERENCE_LIVE_3_HOLDOUT');
    await assign(0, 'REFERENCE_LIVE_3_HOLDOUT');
    expect(button('Validate HOLDOUT · velocity12').disabled).toBe(true);
    await act(async () => button('Inspect Integrity Features').click()); await settle();
    expect(button('Run Integrity Guard Comparison').disabled).toBe(true);
    expect(button('Download Integrity Traces CSV').disabled).toBe(true);
    expect(button('Validate HOLDOUT · velocity12').disabled).toBe(false);
    await act(async () => button('Validate HOLDOUT · velocity12').click()); await settle();
    expect(container.textContent).toContain('Y guard safety: FAIL');
    expect(container.textContent).toContain('Expected-limb kick guard activations:');
    await act(async () => button('Download Integrity JSON').click()); const result = JSON.parse(await readBlob());
    expect(result).not.toHaveProperty('strategies'); expect(result.references).toEqual([]);
    expect(result.holdoutValidation).toMatchObject({ role: 'REFERENCE_LIVE_3_HOLDOUT', preRegisteredConfig: { velocity: 12 },
      acceptance: { yGuardSafetyPass: false, fullCandidatePass: false } });
    expect(result.holdoutValidation.perFixture[0].liveReplayParity.matched).toBe(true);
    await assign(0, 'UNASSIGNED'); expect(button('Download Integrity JSON').disabled).toBe(true);
    expect(button('Validate HOLDOUT · velocity12').disabled).toBe(true);
  });
  it('keeps mixed-input HOLDOUT out of all37 exploratory results and preserves its separate report', async () => {
    const { session } = await fullV3Trial();
    await select([file('old.json', async () => JSON.stringify(session)), file('holdout.json', async () => JSON.stringify({ ...session, captureId: 'holdout' }))]);
    await assign(0, 'REFERENCE_LIVE_1'); await assign(1, 'REFERENCE_LIVE_3_HOLDOUT');
    await act(async () => button('Inspect Integrity Features').click()); await settle();
    await act(async () => button('Validate HOLDOUT · velocity12').click()); await settle();
    await act(async () => button('Run Integrity Guard Comparison').click()); await settle();
    await act(async () => button('Download Integrity JSON').click()); const result = JSON.parse(await readBlob());
    expect(result.inputs.map((i: { role: string }) => i.role)).toEqual(['REFERENCE_LIVE_1']);
    expect(result.strategies).toHaveLength(37);
    for (const s of result.strategies) for (const mode of [s.yOnly, s.fixedFlexionDiagnostic]) {
      expect(mode.perFixture).toHaveLength(1); expect(mode.perFixture[0].input.role).toBe('REFERENCE_LIVE_1');
    }
    expect(result.holdoutValidation.perFixture).toHaveLength(1);
  }, 15000);
  it('blocks HOLDOUT on parity mismatch without exporting an acceptance', async () => {
    const { session } = await fullV3Trial(); session!.liveResult.trials[0].result.events[0].tMs++;
    await select([file('bad-holdout.json', async () => JSON.stringify(session))]); await assign(0, 'REFERENCE_LIVE_3_HOLDOUT');
    await act(async () => button('Inspect Integrity Features').click()); await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('LIVE_V3_PARITY_MISMATCH');
    expect(button('Validate HOLDOUT · velocity12').disabled).toBe(true);
    expect(button('Download Integrity JSON').disabled).toBe(true);
    expect(container.textContent).not.toContain('Y guard safety:');
  });
  it('cancels a pending HOLDOUT evaluation on cancel/reset/unmount', async () => {
    const json = JSON.stringify((await fullV3Trial()).session);
    for (const action of ['Cancel Integrity Analysis', 'Reset Integrity Analysis', 'unmount']) {
      await select([file('holdout.json', async () => json)]); await assign(0, 'REFERENCE_LIVE_3_HOLDOUT');
      await act(async () => button('Inspect Integrity Features').click()); await settle();
      vi.useFakeTimers(); await act(async () => button('Validate HOLDOUT · velocity12').click());
      await act(async () => { if (action === 'unmount') { root!.unmount(); root = null; } else button(action).click(); });
      await act(async () => vi.runAllTimersAsync()); vi.useRealTimers();
      expect(container.textContent).not.toContain('Y guard safety:'); expect(download).not.toHaveBeenCalled();
    }
  });
  it('requires explicit roles, presents distributions before the bounded sweep, and exports trace CSV/JSON locally', async () => {
    const { session } = await fullV3Trial(), fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await select(['clean.json', 'stress.json', 'live1.json', 'independent.json'].map((name, i) => file(name, async () => JSON.stringify({ ...session, captureId: `capture-${i}` }))));
    expect([...container.querySelectorAll('select')].map((s) => s.value)).toEqual(Array(4).fill('UNASSIGNED'));
    expect(button('Inspect Integrity Features').disabled).toBe(true); expect(button('Run Integrity Guard Comparison').disabled).toBe(true);
    for (const [i, role] of ['REFERENCE_OLD_CLEAN', 'STRESS', 'REFERENCE_LIVE_1', 'REFERENCE_LIVE_2_INDEPENDENT'].entries()) await assign(i, role);
    await act(async () => button('Inspect Integrity Features').click()); await settle();
    expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.textContent).toContain('Integrity distributions');
    expect(container.textContent).toContain('Entry ±500ms'); expect(container.textContent).not.toContain('viableIntegrityConfigs:');
    await act(async () => button('Download Integrity Traces CSV').click()); expect(await readBlob()).toContain('YVelocity');
    await act(async () => button('Download Integrity JSON').click()); expect(JSON.parse(await readBlob())).not.toHaveProperty('strategies');
    await act(async () => button('Run Integrity Guard Comparison').click()); await settle();
    expect(container.textContent).toContain('37 configs including NONE'); expect(container.textContent).toContain('FIXED_Y_OR_FLEXION');
    await act(async () => button('Download Integrity JSON').click()); const result = JSON.parse(await readBlob());
    expect(result.strategies).toHaveLength(37); expect(result.settings.fixedFlexion).toMatchObject({ flexEnter: 15, flexDwellMs: 67 });
    expect(result.inputs.map((i: { role: string }) => i.role)).toEqual(['REFERENCE_OLD_CLEAN', 'STRESS', 'REFERENCE_LIVE_1', 'REFERENCE_LIVE_2_INDEPENDENT']);
    expect(fetch).not.toHaveBeenCalled();
    await assign(3, 'UNASSIGNED'); expect(button('Download Integrity JSON').disabled).toBe(true); expect(button('Run Integrity Guard Comparison').disabled).toBe(true);
  }, 15000);
  it('stops before feature/sweep export when primary replay parity differs', async () => {
    const { session } = await fullV3Trial(); session!.liveResult.trials[0].result.events[0].tMs++;
    await select([file('bad.json', async () => JSON.stringify(session))]); await assign(0, 'REFERENCE_LIVE_2_INDEPENDENT');
    await act(async () => button('Inspect Integrity Features').click()); await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('LIVE_V3_PARITY_MISMATCH');
    expect(button('Run Integrity Guard Comparison').disabled).toBe(true); expect(button('Download Integrity JSON').disabled).toBe(true);
  });
  it('cancels pending sweeps on cancel/reset/unmount without stale results', async () => {
    const json = JSON.stringify((await fullV3Trial()).session);
    async function prepare() { await select([file('test.json', async () => json)]); await assign(0, 'REFERENCE_LIVE_1');
      await act(async () => button('Inspect Integrity Features').click()); await settle(); }
    await prepare(); vi.useFakeTimers(); await act(async () => button('Run Integrity Guard Comparison').click()); await act(async () => button('Cancel Integrity Analysis').click());
    await act(async () => vi.runAllTimersAsync()); vi.useRealTimers();
    expect(button('Download Integrity JSON').disabled).toBe(true);
    await prepare(); vi.useFakeTimers(); await act(async () => button('Run Integrity Guard Comparison').click()); await act(async () => button('Reset Integrity Analysis').click());
    await act(async () => vi.runAllTimersAsync()); vi.useRealTimers();
    expect(container.querySelector('select')).toBeNull();
    await prepare(); vi.useFakeTimers(); await act(async () => button('Run Integrity Guard Comparison').click()); await act(async () => root!.unmount()); root = null;
    await act(async () => vi.runAllTimersAsync()); vi.useRealTimers(); expect(container.textContent).toBe(''); expect(download).not.toHaveBeenCalled();
  });
  it('invalidates pending reads on replacement/reset/unmount and reports invalid files', async () => {
    let resolve!: (s: string) => void; const json = JSON.stringify((await fullV3Trial()).session), pending = () => file('pending.json', () => new Promise((r) => { resolve = r; }));
    await select([pending()]); await select([file('invalid.json', async () => 'not json')]); await act(async () => resolve(json));
    expect(container.querySelector('[role="alert"]')).not.toBeNull(); expect(container.querySelector('select')).toBeNull();
    await select([pending()]); await act(async () => button('Reset Integrity Analysis').click()); await act(async () => resolve(json));
    expect(container.querySelector('select')).toBeNull();
    await select([pending()]); await act(async () => root!.unmount()); root = null; await act(async () => resolve(json)); expect(download).not.toHaveBeenCalled();
  });
});
