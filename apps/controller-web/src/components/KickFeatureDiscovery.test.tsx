import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KickFeatureDiscovery } from './KickFeatureDiscovery';
import { discoveryFixture } from '../discovery/testFixtures';

const { download, clear } = vi.hoisted(() => ({ download: vi.fn(), clear: vi.fn() }));
vi.mock('../replay/useLocalDownload', () => ({ useLocalDownload: () => ({ download, clear }) }));
let root: Root | null, container: HTMLDivElement;
const button = (name: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === name)!;
function file(name: string, text: () => Promise<string>) {
  const file = new File([''], name, { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: text }); return file;
}
async function select(files: File[]) {
  const input = container.querySelector('input')!;
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
async function settled() {
  for (let i = 0; i < 100; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    if (!container.querySelector('[role="status"]')) return;
  }
  throw new Error('analysis did not settle');
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<KickFeatureDiscovery />));
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container.remove(); vi.clearAllMocks(); vi.unstubAllGlobals();
});

describe('local Feature Discovery UI', () => {
  it('accepts multiple captures, displays each identity/aggregate and downloads summary-only JSON', async () => {
    const session = await discoveryFixture(), stress = structuredClone(session); stress.captureId = 'stress-capture';
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(container.querySelector('input')?.multiple).toBe(true);
    await select([file('clean인가요.json', async () => JSON.stringify(session)), file('3차검증2.json', async () => JSON.stringify(stress))]);
    await settled();
    expect(container.textContent).toContain('2 datasets'); expect(container.textContent).toContain('Aggregate');
    expect(container.textContent).toContain('clean인가요.json'); expect(container.textContent).toContain('stress-capture');
    expect(container.textContent).toContain('EXPLORATORY'); expect(container.textContent).toContain('universal threshold');
    await act(async () => button('Download Feature Discovery JSON').click());
    expect(download).toHaveBeenCalledOnce(); expect(download.mock.calls[0][1]).toMatch(/^plank-stork-feature-discovery-.*\.json$/);
    const exported = await new Promise<string>((resolve) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(download.mock.calls[0][0]);
    });
    const data = JSON.parse(exported);
    expect(data.inputs.map((i: { filename: string }) => i.filename)).toEqual(['clean인가요.json', '3차검증2.json']);
    expect(data.perDataset).toHaveLength(2); expect(data.aggregate.length).toBeGreaterThan(10);
    expect(exported).not.toContain('"landmarks"'); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects Diagnostic v3 visibly, keeps valid-file summaries and clears them on a new selection', async () => {
    const session = await discoveryFixture();
    await select([file('diagnostic.json', async () => '{"version":3}'), file('clean.json', async () => JSON.stringify(session))]);
    await settled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('STEP 4F version 1');
    expect(container.textContent).toContain('1 datasets'); expect(button('Download Feature Discovery JSON').disabled).toBe(false);
    await select([file('broken.json', async () => 'not json')]); await settled();
    expect(container.textContent).not.toContain('clean.json'); expect(button('Download Feature Discovery JSON').disabled).toBe(true);
  });
  it('reassesses explicit temporal roles, switches trim/2D views and exports summary-only temporal results', async () => {
    const session = await discoveryFixture();
    await select([file('renamed.json', async () => JSON.stringify(session))]); await settled();
    const role = container.querySelector<HTMLSelectElement>('[aria-label="Temporal role renamed.json trial 1"]')!;
    expect(role.value).toBe('UNASSIGNED');
    await act(async () => { role.value = 'CLEAN'; role.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container.textContent).toContain('1 CLEAN trials');
    const window = container.querySelector<HTMLSelectElement>('[aria-label="Temporal window"]')!;
    await act(async () => { window.value = 'TRIMMED'; window.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container.textContent).toContain('TRIMMED — Y evidence');
    const confirmation = container.querySelector<HTMLSelectElement>('[aria-label="Temporal confirmation"]')!;
    await act(async () => { confirmation.value = '0.5'; confirmation.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => button('Download Feature Temporal Discovery JSON').click());
    const exported = await new Promise<string>((resolve) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(download.mock.calls[0][0]);
    });
    const data = JSON.parse(exported);
    expect(data.feature).toBe('deltaDyNorm'); expect(data.inputs[0].role).toBe('CLEAN');
    expect(data.rulesClean).toHaveLength(392); expect(data.perDataset[0].stages).toHaveLength(18);
    expect(data.perDataset[0].stages.some((s: { observable: boolean }) => !s.observable)).toBe(true);
    expect(exported).not.toContain('"landmarks"'); expect(exported).not.toContain('"series"');
    await act(async () => button('Reset Feature Discovery').click());
    expect(container.querySelector('[aria-label="Temporal window"]')).toBeNull();
  });
  it('warns with no CLEAN, shares explicit roles with shadow, exports all configs and invalidates results after role changes', async () => {
    const session = await discoveryFixture();
    await select([file('clean인가요.json', async () => JSON.stringify(session)), file('3차검증2.json', async () => JSON.stringify(session))]); await settled();
    const roles = [...container.querySelectorAll<HTMLSelectElement>('select[aria-label^="Temporal role"]')];
    expect(roles.map((r) => r.value)).toEqual(['UNASSIGNED', 'UNASSIGNED']);
    await act(async () => button('Run Temporal Validation').click());
    expect(container.textContent).toContain('No CLEAN dataset selected');
    await act(async () => { roles[0].value = 'CLEAN'; roles[0].dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { roles[1].value = 'STRESS'; roles[1].dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container.textContent).not.toContain('No CLEAN dataset selected');
    expect(container.textContent).toContain('Role: CLEAN'); expect(container.textContent).toContain('Role: STRESS');
    await act(async () => button('Run Shadow Validation').click()); await settled();
    expect(button('Download Y Kick Shadow Result JSON').disabled).toBe(false);
    expect(container.textContent).toContain('288');
    await act(async () => button('Download Y Kick Shadow Result JSON').click());
    const exported = await new Promise<string>((resolve) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(download.mock.calls[0][0]);
    });
    const data = JSON.parse(exported);
    expect(data.inputs.map((i: { role: string }) => i.role)).toEqual(['CLEAN', 'STRESS']);
    expect(data.configs).toHaveLength(288); expect(data.perConfig).toHaveLength(288);
    expect(exported).not.toMatch(/"(landmarks|worldLandmarks|frames)":/);
    await act(async () => { roles[0].value = 'UNASSIGNED'; roles[0].dispatchEvent(new Event('change', { bubbles: true })); });
    expect(button('Download Y Kick Shadow Result JSON').disabled).toBe(true);
    expect(container.textContent).toContain('No CLEAN dataset selected');
  });
  it('cancels pending shadow work on reset/unmount without publishing old results', async () => {
    const session = await discoveryFixture();
    await select([file('capture.json', async () => JSON.stringify(session))]); await settled();
    await act(async () => button('Run Shadow Validation').click());
    await act(async () => button('Cancel Shadow Validation').click());
    await settled(); expect(button('Download Y Kick Shadow Result JSON').disabled).toBe(true);
    await act(async () => button('Run Shadow Validation').click());
    await act(async () => button('Reset Feature Discovery').click());
    await settled(); expect(button('Run Shadow Validation').disabled).toBe(true);
    await select([file('again.json', async () => JSON.stringify(session))]); await settled();
    await act(async () => button('Run Shadow Validation').click());
    await act(async () => root!.unmount()); root = null;
    await act(async () => { await new Promise((done) => setTimeout(done, 10)); });
    expect(download).not.toHaveBeenCalled(); expect(container.textContent).toBe('');
  });
  it('shows low world/angle coverage while image coverage and stage limb details stay available', async () => {
    const session = await discoveryFixture();
    session.poseFrames.forEach((f) => { f.worldLandmarks = []; f.landmarks[27].visibility = 0; f.landmarks[28].visibility = 0; });
    await select([file('stress.json', async () => JSON.stringify(session))]); await settled();
    expect(container.textContent).toContain('LOW / MISSING COVERAGE'); expect(container.textContent).toContain('0.0%');
    const details = container.querySelector('details')!;
    await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle')); });
    expect(container.textContent).toContain('Stage × feature × side'); expect(container.textContent).toContain('Correct side margin');
    expect(container.textContent).toContain('KNEE_RIGHT');
  });
  it('reset and unmount discard pending file reads without publishing stale results', async () => {
    const session = JSON.stringify(await discoveryFixture());
    let resolve!: (text: string) => void;
    await select([file('pending.json', () => new Promise<string>((done) => { resolve = done; }))]);
    await act(async () => { await new Promise((done) => setTimeout(done, 10)); });
    await act(async () => button('Reset Feature Discovery').click());
    await act(async () => resolve(session));
    expect(container.textContent).not.toContain('datasets ·'); expect(button('Download Feature Discovery JSON').disabled).toBe(true);
    expect(clear).toHaveBeenCalled();
    await select([file('pending-again.json', () => new Promise<string>((done) => { resolve = done; }))]);
    await act(async () => { await new Promise((done) => setTimeout(done, 10)); });
    await act(async () => root!.unmount()); root = null;
    await act(async () => resolve(session));
    expect(download).not.toHaveBeenCalled(); expect(container.textContent).toBe('');
  });
});
