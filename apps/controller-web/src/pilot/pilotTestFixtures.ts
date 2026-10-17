/** Synthetic, no private capture data. Shared only by the three pilot test files. */
import type { AttemptStatus, PilotArtifact, PilotCommand, PilotLedger } from './pilotTypes';
import { applyPilotCommand, createPilotLedger, missingArtifact } from './pilotLedger';
import type { PilotStorage, PilotWriterLock } from './pilotStorage';
import { PilotError } from './pilotSerialization';

export const at = (seconds = 0) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
export const register = (attemptId = 'attempt-1', operationId = `register-${attemptId}`): PilotCommand => ({
  kind: 'REGISTER', operationId, at: at(), metadata: { attemptId, sessionId: null, split: 'DEVELOPMENT',
    approvalRef: null, registrationRef: null, retryOf: null },
});
export const verifiedArtifact = (): PilotArtifact => ({ presence: 'PRESENT', verification: 'VERIFIED',
  identity: { sha256: 'a'.repeat(64), byteLength: 42 }, verificationRef: 'synthetic-integrity-report' });
export const failedArtifact = (): PilotArtifact => ({ presence: 'MISSING', verification: 'FAILED', identity: null, verificationRef: null });
export function transition(status: Exclude<AttemptStatus, 'PLANNED'>, attemptId = 'attempt-1', seconds = 1): PilotCommand {
  return { kind: 'TRANSITION', operationId: `${attemptId}-${status}`, at: at(seconds), attemptId, status,
    reasonCode: status === 'START_REQUESTED' || status === 'COMPLETE' ? null : 'SYNTHETIC_FAILURE',
    artifact: status === 'COMPLETE' ? verifiedArtifact() : status === 'ARTIFACT_FAILED' ? failedArtifact() : missingArtifact() };
}
export async function ledgerAt(status: AttemptStatus = 'PLANNED'): Promise<PilotLedger> {
  let ledger = await applyPilotCommand(createPilotLedger('ledger-1'), register());
  if (status === 'PLANNED') return ledger;
  ledger = await applyPilotCommand(ledger, transition('START_REQUESTED'));
  return status === 'START_REQUESTED' ? ledger : applyPilotCommand(ledger, transition(status, 'attempt-1', 2));
}
export class MemoryStorage implements PilotStorage {
  data = new Map<string, string>();
  readError = false;
  writeError = false;
  afterWrite: (() => void) | null = null;
  getItem(key: string) { if (this.readError) throw new Error('SecurityError'); return this.data.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.writeError) throw new Error('QuotaExceededError');
    this.data.set(key, value); this.afterWrite?.();
  }
}
export class SingleWriterLock implements PilotWriterLock {
  held = new Set<string>();
  async acquire(key: string) {
    if (this.held.has(key)) throw new PilotError('WRITER_CONFLICT');
    this.held.add(key); return () => { this.held.delete(key); };
  }
}
