import type { PilotCommand, PilotLedger } from './pilotTypes';
import { applyPilotCommand, createPilotLedger, importPilotLedger, interruptOpenAttempts, parsePilotLedger, serializePilotLedger } from './pilotLedger';
import { id, PilotError, requirePilot } from './pilotSerialization';

export interface PilotStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
/** Must hold exclusive ownership for the store's lifetime. Tests can inject a deterministic lock. */
export interface PilotWriterLock { acquire(key: string): Promise<() => void> }
export interface PilotStoreOptions {
  storage: PilotStorage;
  writerLock: PilotWriterLock;
  key: string;
  ledgerId: string;
  recoveredAt: string;
  recoveryId: string;
}

function read(storage: PilotStorage, key: string) {
  try { return storage.getItem(key); } catch { throw new PilotError('STORAGE_READ_FAILED'); }
}

/**
 * Cooperating writers require the same origin/key Web Lock. The raw compare/readback also rejects
 * observed out-of-band changes, but localStorage is NOT atomic CAS or an immutable backup.
 * On any uncertain write/conflict the handle fails closed; close/reopen to validate durable state.
 */
export class PilotLedgerStore {
  private busy = false;
  private closed = false;
  private faulted = false;
  private constructor(private readonly options: PilotStoreOptions, private readonly release: () => void,
    private ledger: PilotLedger, private expectedRaw: string | null) {}

  static async open(options: PilotStoreOptions): Promise<PilotLedgerStore> {
    // Copy options: a caller cannot redirect an in-flight operation to another key/storage.
    const settings = { ...options }; id(settings.key); id(settings.ledgerId);
    const release = await settings.writerLock.acquire(settings.key);
    let store: PilotLedgerStore | null = null;
    try {
      const raw = read(settings.storage, settings.key);
      const ledger = raw === null ? createPilotLedger(settings.ledgerId) : await parsePilotLedger(raw);
      requirePilot(ledger.ledgerId === settings.ledgerId, 'LEDGER_ID_MISMATCH');
      store = new PilotLedgerStore(settings, release, ledger, raw);
      const recovered = await interruptOpenAttempts(ledger, settings.recoveredAt, settings.recoveryId);
      if (recovered.revisions.length !== ledger.revisions.length) await store.persist(recovered);
      // Even a read-only open must not return stale data after asynchronous hash validation.
      requirePilot(read(settings.storage, settings.key) === store.expectedRaw, 'STORAGE_CONFLICT');
      return store;
    } catch (error) { if (store) store.close(); else release(); throw error; }
  }
  private usable() {
    requirePilot(!this.closed, 'STORE_CLOSED');
    requirePilot(!this.faulted, 'STORE_REOPEN_REQUIRED');
  }
  snapshot(): PilotLedger {
    this.usable();
    try { requirePilot(read(this.options.storage, this.options.key) === this.expectedRaw, 'STORAGE_CONFLICT'); }
    catch (error) { this.faulted = true; throw error; }
    return this.ledger;
  }
  private async persist(next: PilotLedger) {
    const raw = await serializePilotLedger(next);
    this.usable();
    const { storage, key } = this.options;
    requirePilot(read(storage, key) === this.expectedRaw, 'STORAGE_CONFLICT');
    try { storage.setItem(key, raw); } catch { throw new PilotError('STORAGE_WRITE_FAILED'); }
    requirePilot(read(storage, key) === raw, 'STORAGE_CONFLICT');
    // Only acknowledge the new revision after successful write AND readback; never roll storage back.
    this.expectedRaw = raw; this.ledger = next;
  }
  private async mutate(build: () => Promise<PilotLedger>): Promise<PilotLedger> {
    this.usable(); requirePilot(!this.busy, 'STORE_BUSY'); this.busy = true;
    try {
      const next = await build();
      try { await this.persist(next); }
      catch (error) { this.faulted = true; throw error; }
      return this.snapshot();
    } finally { this.busy = false; }
  }
  apply(command: PilotCommand): Promise<PilotLedger> {
    return this.mutate(() => applyPilotCommand(this.ledger, command));
  }
  /** Explicit restoration only into an absent key. Never overwrites even an empty stored ledger. */
  restoreExport(text: string): Promise<PilotLedger> {
    return this.mutate(async () => {
      requirePilot(this.expectedRaw === null && this.ledger.revisions.length === 0, 'RESTORE_REQUIRES_ABSENT_STORAGE');
      const restored = await importPilotLedger(text);
      requirePilot(restored.ledgerId === this.ledger.ledgerId, 'LEDGER_ID_MISMATCH');
      return interruptOpenAttempts(restored, this.options.recoveredAt, this.options.recoveryId);
    });
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.release();
  }
}

/** No fallback to an uncoordinated writer if Web Locks are unavailable (e.g. an unsupported origin). */
export function browserPilotWriterLock(): PilotWriterLock {
  requirePilot(globalThis.navigator?.locks, 'WRITER_LOCK_UNAVAILABLE');
  const locks = navigator.locks;
  return {
    acquire: (key) => new Promise<() => void>((resolve, reject) => {
      void locks.request(`plank-stork:pilot:${key}`, { mode: 'exclusive', ifAvailable: true }, (lock) => {
        if (!lock) throw new PilotError('WRITER_CONFLICT');
        return new Promise<void>((release) => { resolve(release); });
      }).catch(reject);
    }),
  };
}
/** Explicitly called by a future integration; importing this module never accesses storage. */
export function openBrowserPilotLedgerStore(options: Omit<PilotStoreOptions, 'storage' | 'writerLock'>) {
  let storage: Storage;
  try { storage = globalThis.localStorage; } catch { throw new PilotError('STORAGE_READ_FAILED'); }
  requirePilot(storage, 'STORAGE_UNAVAILABLE');
  return PilotLedgerStore.open({ ...options, storage, writerLock: browserPilotWriterLock() });
}
