// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPilotLedger, currentAttempts, exportPilotLedger, parsePilotLedger, serializePilotLedger } from './pilotLedger';
import { browserPilotWriterLock, openBrowserPilotLedgerStore, PilotLedgerStore } from './pilotStorage';
import { canonicalJson } from './pilotSerialization';
import { at, ledgerAt, MemoryStorage, register, SingleWriterLock, transition } from './pilotTestFixtures';

let storage: MemoryStorage, locks: SingleWriterLock;
const handles: PilotLedgerStore[] = [];
const key = 'pilot-test';
async function open() {
  const handle = await PilotLedgerStore.open({ storage, writerLock: locks, key, ledgerId: 'ledger-1', recoveredAt: at(100), recoveryId: 'reload' });
  handles.push(handle); return handle;
}
beforeEach(() => { storage = new MemoryStorage(); locks = new SingleWriterLock(); });
afterEach(() => { handles.splice(0).forEach((store) => store.close()); vi.unstubAllGlobals(); });

describe('durable single-writer ledger adapter', () => {
  it('persists registration before acknowledging it and recovers an open attempt on reload', async () => {
    const first = await open();
    const original = await first.apply(register());
    expect(await parsePilotLedger(storage.getItem(key)!)).toEqual(original);
    first.close();
    const second = await open(), recovered = second.snapshot();
    expect(recovered.revisions[0]).toEqual(original.revisions[0]);
    expect(currentAttempts(recovered)[0]).toMatchObject({ status: 'INTERRUPTED', reasonCode: 'RELOAD_INTERRUPTED', revision: 2 });
    expect(await parsePilotLedger(storage.getItem(key)!)).toEqual(recovered);
    second.close();
    expect((await open()).snapshot()).toEqual(recovered);
  });
  it.each(['SETUP_FAILED', 'ARTIFACT_FAILED', 'INTERRUPTED', 'COMPLETE'] as const)('does not rewrite terminal %s on reload', async (status) => {
    const ledger = await ledgerAt(status), raw = await serializePilotLedger(ledger); storage.data.set(key, raw);
    expect((await open()).snapshot()).toEqual(ledger);
    expect(storage.getItem(key)).toBe(raw);
  });
  it('rejects concurrent cooperating writers; ownership is released explicitly', async () => {
    const first = await open();
    await expect(open()).rejects.toThrow('WRITER_CONFLICT');
    first.close(); first.close();
    const second = await open();
    expect(second.snapshot().revisions).toHaveLength(0);
    expect(() => first.snapshot()).toThrow('STORE_CLOSED');
  });
  it('rejects overlapping operations on one handle without losing the admitted operation', async () => {
    const store = await open(), first = store.apply(register());
    await expect(store.apply(register('attempt-2'))).rejects.toThrow('STORE_BUSY');
    expect(currentAttempts(await first).map((a) => a.attemptId)).toEqual(['attempt-1']);
  });
  it('refuses an operation whose handle was closed during asynchronous hashing', async () => {
    const store = await open(), pending = store.apply(register()); store.close();
    await expect(pending).rejects.toThrow('STORE_CLOSED');
    expect(storage.getItem(key)).toBeNull();
  });
  it('does not write after invalid commands and keeps the writer usable', async () => {
    const store = await open(); await store.apply(register()); const raw = storage.getItem(key);
    await expect(store.apply(register())).rejects.toThrow('DUPLICATE_OPERATION');
    expect(storage.getItem(key)).toBe(raw);
    expect(currentAttempts(await store.apply(transition('START_REQUESTED')))[0].status).toBe('START_REQUESTED');
  });
  it('reports quota failure and never advances acknowledged memory or storage', async () => {
    const store = await open(); await store.apply(register());
    const before = store.snapshot(), raw = storage.getItem(key); storage.writeError = true;
    await expect(store.apply(transition('START_REQUESTED'))).rejects.toThrow('STORAGE_WRITE_FAILED');
    expect(storage.getItem(key)).toBe(raw); expect(currentAttempts(before)[0].status).toBe('PLANNED');
    expect(() => store.snapshot()).toThrow('STORE_REOPEN_REQUIRED');
    await expect(store.apply(transition('START_REQUESTED'))).rejects.toThrow('STORE_REOPEN_REQUIRED');
    store.close(); storage.writeError = false;
    const reopened = (await open()).snapshot();
    expect(reopened.revisions.map((r) => r.attempt.status)).toEqual(['PLANNED', 'INTERRUPTED']);
  });
  it('quarantines an uncertain successful write when readback fails, then validates on reopen', async () => {
    const store = await open(), before = store.snapshot(); storage.afterWrite = () => { storage.readError = true; };
    await expect(store.apply(register())).rejects.toThrow('STORAGE_READ_FAILED');
    expect(before.revisions).toHaveLength(0);
    expect(() => store.snapshot()).toThrow('STORE_REOPEN_REQUIRED');
    expect(storage.data.has(key)).toBe(true); // No destructive rollback of a possibly durable revision.
    store.close(); storage.readError = false; storage.afterWrite = null;
    const recovered = (await open()).snapshot();
    expect(recovered.revisions.map((r) => r.attempt.status)).toEqual(['PLANNED', 'INTERRUPTED']);
  });
  it('rejects a storage replacement detected during readback without overwriting it again', async () => {
    const store = await open(); storage.afterWrite = () => storage.data.set(key, 'external-write');
    await expect(store.apply(register())).rejects.toThrow('STORAGE_CONFLICT');
    expect(storage.getItem(key)).toBe('external-write');
    expect(() => store.snapshot()).toThrow('STORE_REOPEN_REQUIRED');
  });
  it.each(['removed', 'changed', 'rolled-back'] as const)('rejects an observed out-of-band %s ledger', async (kind) => {
    const store = await open(); await store.apply(register()); const earlier = storage.getItem(key)!;
    await store.apply(transition('START_REQUESTED'));
    if (kind === 'removed') storage.data.delete(key);
    if (kind === 'changed') storage.data.set(key, 'external');
    if (kind === 'rolled-back') storage.data.set(key, earlier);
    const external = storage.getItem(key);
    await expect(store.apply(transition('INTERRUPTED', 'attempt-1', 2))).rejects.toThrow('STORAGE_CONFLICT');
    expect(storage.getItem(key)).toBe(external);
  });
  it.each(['invalid-json', 'version', 'old-revision', 'reversed-revision', 'wrong-ledger', 'duplicate-id'] as const)('refuses %s recovery and preserves the original bytes', async (kind) => {
    const value = JSON.parse(await serializePilotLedger(await ledgerAt('START_REQUESTED')));
    if (kind === 'version') value.schemaVersion = 2;
    if (kind === 'old-revision') value.revisions[0].attempt.approvalRef = 'changed';
    if (kind === 'reversed-revision') value.revisions[1].revision = 1;
    if (kind === 'wrong-ledger') value.ledgerId = 'other';
    if (kind === 'duplicate-id') value.revisions[1].kind = 'REGISTER';
    const raw = kind === 'invalid-json' ? '{broken' : canonicalJson(value); storage.data.set(key, raw);
    await expect(open()).rejects.toThrow();
    expect(storage.getItem(key)).toBe(raw); expect(locks.held.size).toBe(0);
  });
  it('does not return a recovered state if the recovery revision cannot be persisted', async () => {
    const raw = await serializePilotLedger(await ledgerAt('START_REQUESTED')); storage.data.set(key, raw); storage.writeError = true;
    await expect(open()).rejects.toThrow('STORAGE_WRITE_FAILED');
    expect(storage.getItem(key)).toBe(raw); expect(locks.held.size).toBe(0);
    storage.writeError = false;
    expect(currentAttempts((await open()).snapshot())[0].reasonCode).toBe('RELOAD_INTERRUPTED');
  });
  it('reports a localStorage security read error and releases the writer lock', async () => {
    storage.readError = true;
    await expect(open()).rejects.toThrow('STORAGE_READ_FAILED'); expect(locks.held.size).toBe(0);
  });
  it.each(['changed', 'security-error'] as const)('does not expose a stale acknowledged snapshot after %s', async (kind) => {
    const store = await open(); await store.apply(register());
    const before = store.snapshot();
    if (kind === 'changed') storage.data.set(key, 'external'); else storage.readError = true;
    expect(() => store.snapshot()).toThrow(kind === 'changed' ? 'STORAGE_CONFLICT' : 'STORAGE_READ_FAILED');
    expect(() => store.snapshot()).toThrow('STORE_REOPEN_REQUIRED');
    expect(currentAttempts(before)[0].status).toBe('PLANNED');
  });
  it('restores a validated export only to absent storage, interrupting open attempts', async () => {
    const text = await exportPilotLedger(await ledgerAt(), at(2)), store = await open();
    const restored = await store.restoreExport(text);
    expect(restored.revisions.map((r) => r.attempt.status)).toEqual(['PLANNED', 'INTERRUPTED']);
    await expect(store.restoreExport(text)).rejects.toThrow('RESTORE_REQUIRES_ABSENT_STORAGE');
    expect(await parsePilotLedger(storage.getItem(key)!)).toEqual(restored);
  });
  it('does not restore invalid exports, different identities or overwrite an empty stored ledger', async () => {
    const store = await open();
    await expect(store.restoreExport('{bad')).rejects.toThrow('INVALID_JSON'); expect(storage.getItem(key)).toBeNull();
    await expect(store.restoreExport(await exportPilotLedger(createPilotLedger('other-ledger'), at(2)))).rejects.toThrow('LEDGER_ID_MISMATCH');
    expect(storage.getItem(key)).toBeNull();
    store.close();
    storage.data.set(key, await serializePilotLedger((await open()).snapshot()));
    handles.at(-1)!.close();
    const existing = await open();
    await expect(existing.restoreExport(await exportPilotLedger(await ledgerAt(), at(2)))).rejects.toThrow('RESTORE_REQUIRES_ABSENT_STORAGE');
  });
});

describe('browser adapter capability boundary', () => {
  it('requires Web Locks instead of claiming atomic localStorage compare-and-swap', () => {
    vi.stubGlobal('navigator', {});
    expect(browserPilotWriterLock).toThrow('WRITER_LOCK_UNAVAILABLE');
  });
  it('holds the browser lock until explicit release and rejects an unavailable lock', async () => {
    let held = false;
    const request = vi.fn(async (_name, options, callback) => {
      expect(options).toEqual({ mode: 'exclusive', ifAvailable: true });
      if (held) return callback(null);
      held = true;
      try { return await callback({ name: 'synthetic-lock' }); } finally { held = false; }
    });
    vi.stubGlobal('navigator', { locks: { request } });
    const writer = browserPilotWriterLock(), release = await writer.acquire(key);
    await expect(writer.acquire(key)).rejects.toThrow('WRITER_CONFLICT');
    expect(request.mock.calls[0][0]).toBe('plank-stork:pilot:pilot-test');
    release(); await Promise.resolve(); await Promise.resolve();
    const releaseAgain = await writer.acquire(key); releaseAgain();
  });
  it('reports an inaccessible browser storage property without touching capture APIs', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('SecurityError'); } });
    try {
      expect(() => openBrowserPilotLedgerStore({ key, ledgerId: 'ledger-1', recoveredAt: at(2), recoveryId: 'reload' })).toThrow('STORAGE_READ_FAILED');
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});
