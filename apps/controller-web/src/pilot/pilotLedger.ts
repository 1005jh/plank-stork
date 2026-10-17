import type { AttemptMetadata, AttemptStatus, PilotArtifact, PilotAttempt, PilotCommand, PilotLedger, PilotLedgerExport, PilotRevision } from './pilotTypes';
import { canonicalJson, detached, exactObject, frozen, hashString, id, isoTime, jsonSha256, nullableId, parseCanonicalJson, reason, requirePilot } from './pilotSerialization';

const METADATA_KEYS = ['attemptId', 'sessionId', 'split', 'approvalRef', 'registrationRef', 'retryOf'];
export const ATTEMPT_STATUSES: readonly AttemptStatus[] = Object.freeze(['PLANNED', 'START_REQUESTED', 'INTERRUPTED', 'SETUP_FAILED', 'ARTIFACT_FAILED', 'COMPLETE']);
/** No RECORDING/READY states: this foundation does not observe or run a capture. */
const TRANSITIONS: Record<AttemptStatus, readonly AttemptStatus[]> = {
  PLANNED: ['START_REQUESTED', 'SETUP_FAILED', 'INTERRUPTED'],
  START_REQUESTED: ['SETUP_FAILED', 'ARTIFACT_FAILED', 'INTERRUPTED', 'COMPLETE'],
  SETUP_FAILED: [], ARTIFACT_FAILED: [], INTERRUPTED: [], COMPLETE: [],
};
export function isTerminal(status: AttemptStatus) { return TRANSITIONS[status].length === 0; }
export function missingArtifact(): PilotArtifact {
  return frozen({ presence: 'MISSING', verification: 'UNVERIFIED', identity: null, verificationRef: null });
}
export function validateArtifact(value: unknown): asserts value is PilotArtifact {
  const v = exactObject(value, ['presence', 'verification', 'identity', 'verificationRef']);
  requirePilot(v.presence === 'MISSING' || v.presence === 'PRESENT', 'INVALID_ARTIFACT');
  requirePilot(typeof v.verification === 'string' && ['UNVERIFIED', 'VERIFIED', 'FAILED'].includes(v.verification), 'INVALID_ARTIFACT');
  nullableId(v.verificationRef);
  if (v.identity !== null) {
    const identity = exactObject(v.identity, ['sha256', 'byteLength']); hashString(identity.sha256);
    requirePilot(Number.isSafeInteger(identity.byteLength) && (identity.byteLength as number) > 0, 'INVALID_ARTIFACT_SIZE');
  }
  if (v.presence === 'MISSING') requirePilot(v.identity === null && v.verification !== 'VERIFIED', 'MISSING_ARTIFACT_IDENTITY');
  if (v.verification === 'VERIFIED') requirePilot(v.presence === 'PRESENT' && v.identity !== null && v.verificationRef !== null, 'VERIFICATION_REFERENCE_REQUIRED');
  if (v.verification === 'UNVERIFIED') requirePilot(v.verificationRef === null, 'UNVERIFIED_REFERENCE');
}
export function validateMetadata(value: unknown): asserts value is AttemptMetadata {
  const v = exactObject(value, METADATA_KEYS);
  id(v.attemptId); nullableId(v.sessionId); nullableId(v.approvalRef); nullableId(v.registrationRef); nullableId(v.retryOf);
  requirePilot(typeof v.split === 'string' && ['DEVELOPMENT', 'REGRESSION', 'HOLDOUT'].includes(v.split), 'INVALID_SPLIT');
}
function metadata(attempt: PilotAttempt): AttemptMetadata {
  return { attemptId: attempt.attemptId, sessionId: attempt.sessionId, split: attempt.split,
    approvalRef: attempt.approvalRef, registrationRef: attempt.registrationRef, retryOf: attempt.retryOf };
}
export function validateAttempt(value: unknown): asserts value is PilotAttempt {
  const v = exactObject(value, [...METADATA_KEYS, 'schemaVersion', 'createdAt', 'revision', 'status', 'reasonCode', 'artifact']);
  requirePilot(v.schemaVersion === 1, 'SCHEMA_VERSION_MISMATCH');
  validateMetadata(Object.fromEntries(METADATA_KEYS.map((key) => [key, v[key]])));
  isoTime(v.createdAt);
  requirePilot(Number.isSafeInteger(v.revision) && (v.revision as number) > 0, 'INVALID_REVISION');
  requirePilot(ATTEMPT_STATUSES.includes(v.status as AttemptStatus), 'INVALID_STATUS');
  validateArtifact(v.artifact);
  if (['INTERRUPTED', 'SETUP_FAILED', 'ARTIFACT_FAILED'].includes(v.status as string)) reason(v.reasonCode);
  else requirePilot(v.reasonCode === null, 'UNEXPECTED_REASON');
  if (v.status === 'PLANNED' || v.status === 'START_REQUESTED') requirePilot(canonicalJson(v.artifact) === canonicalJson(missingArtifact()), 'PREPARATION_ARTIFACT');
  if (v.status === 'ARTIFACT_FAILED') requirePilot(v.artifact.verification === 'FAILED', 'ARTIFACT_FAILURE_REQUIRED');
  // Administrative artifact closure only; never camera completion, GT quality or evaluation PASS.
  if (v.status === 'COMPLETE') requirePilot(v.artifact.verification === 'VERIFIED', 'COMPLETE_REQUIRES_ARTIFACT_CLAIM');
}
function revisionBody(revision: PilotRevision) {
  const { hash: _hash, ...body } = revision;
  return body;
}
async function revisionHash(ledgerId: string, body: Omit<PilotRevision, 'hash'>) {
  return jsonSha256({ domain: 'PILOT_LEDGER_REVISION_V1', ledgerId, ...body });
}
function verifyFlow(attempt: PilotAttempt, kind: PilotCommand['kind'], at: string, latest: Map<string, PilotAttempt>) {
  const prior = latest.get(attempt.attemptId);
  if (kind === 'REGISTER') {
    requirePilot(!prior, 'DUPLICATE_ATTEMPT_ID');
    requirePilot(attempt.status === 'PLANNED' && attempt.createdAt === at, 'INVALID_REGISTRATION');
    if (attempt.retryOf !== null) {
      const failed = latest.get(attempt.retryOf);
      requirePilot(failed && isTerminal(failed.status) && failed.status !== 'COMPLETE', 'INVALID_RETRY');
    }
  } else {
    requirePilot(prior, 'UNKNOWN_ATTEMPT');
    requirePilot(TRANSITIONS[prior.status].includes(attempt.status), 'ILLEGAL_TRANSITION');
    requirePilot(canonicalJson(metadata(prior)) === canonicalJson(metadata(attempt)) && prior.createdAt === attempt.createdAt, 'ATTEMPT_METADATA_CHANGED');
  }
}

export function createPilotLedger(ledgerId: string): PilotLedger {
  id(ledgerId);
  return frozen({ schemaVersion: 1, ledgerId, revisions: [], headHash: null });
}
/** Verifies every revision's schema, history and SHA; returns a detached frozen value.
 * Hashes are not signatures: a rewritten chain or valid older prefix needs an external trusted head
 * to detect. This foundation does not claim cold-start rollback detection or immutable storage.
 */
export async function validatePilotLedger(input: unknown): Promise<PilotLedger> {
  const value = detached(input), v = exactObject(value, ['schemaVersion', 'ledgerId', 'revisions', 'headHash']);
  requirePilot(v.schemaVersion === 1, 'SCHEMA_VERSION_MISMATCH'); id(v.ledgerId);
  requirePilot(Array.isArray(v.revisions), 'INVALID_REVISIONS');
  const latest = new Map<string, PilotAttempt>(), operations = new Set<string>();
  let previousHash: string | null = null, previousAt: string | null = null;
  for (let i = 0; i < v.revisions.length; i++) {
    const r = exactObject(v.revisions[i], ['revision', 'operationId', 'at', 'kind', 'previousHash', 'attempt', 'hash']);
    id(r.operationId); isoTime(r.at); hashString(r.hash); validateAttempt(r.attempt);
    requirePilot(r.kind === 'REGISTER' || r.kind === 'TRANSITION', 'INVALID_REVISION_KIND');
    requirePilot(r.revision === i + 1 && r.attempt.revision === r.revision, 'REVISION_SEQUENCE');
    requirePilot(r.previousHash === previousHash, 'PREVIOUS_HASH_MISMATCH');
    requirePilot(!operations.has(r.operationId), 'DUPLICATE_OPERATION');
    requirePilot(previousAt === null || Date.parse(r.at) >= Date.parse(previousAt), 'TIME_REVERSAL');
    verifyFlow(r.attempt, r.kind, r.at, latest);
    const revision = v.revisions[i] as PilotRevision;
    requirePilot(await revisionHash(v.ledgerId, revisionBody(revision)) === r.hash, 'REVISION_HASH_MISMATCH');
    latest.set(r.attempt.attemptId, r.attempt); operations.add(r.operationId); previousHash = r.hash; previousAt = r.at;
  }
  requirePilot(v.headHash === previousHash, 'HEAD_HASH_MISMATCH');
  return frozen(value as PilotLedger);
}
/** Read only from an already validated ledger. No separate mutable current-state cache. */
export function currentAttempts(ledger: PilotLedger): readonly PilotAttempt[] {
  const latest = new Map<string, PilotAttempt>();
  for (const revision of ledger.revisions) latest.set(revision.attempt.attemptId, revision.attempt);
  return frozen(detached([...latest.values()]));
}
function validateCommand(value: unknown): asserts value is PilotCommand {
  requirePilot(value !== null && typeof value === 'object', 'INVALID_COMMAND');
  const kind = (value as Record<string, unknown>).kind;
  const v = exactObject(value, kind === 'REGISTER' ? ['kind', 'operationId', 'at', 'metadata'] : ['kind', 'operationId', 'at', 'attemptId', 'status', 'reasonCode', 'artifact']);
  id(v.operationId); isoTime(v.at);
  if (kind === 'REGISTER') validateMetadata(v.metadata);
  else { requirePilot(kind === 'TRANSITION', 'INVALID_COMMAND'); id(v.attemptId); validateArtifact(v.artifact); }
}
export async function applyPilotCommand(input: PilotLedger, command: PilotCommand): Promise<PilotLedger> {
  // Snapshot inputs before the first await, so caller mutation cannot change the proposed operation.
  const cmd = detached(command); validateCommand(cmd);
  const ledger = await validatePilotLedger(input);
  requirePilot(!ledger.revisions.some((r) => r.operationId === cmd.operationId), 'DUPLICATE_OPERATION');
  const revision = ledger.revisions.length + 1, attempts = new Map(currentAttempts(ledger).map((a) => [a.attemptId, a]));
  let attempt: PilotAttempt;
  if (cmd.kind === 'REGISTER') attempt = { ...cmd.metadata, schemaVersion: 1, createdAt: cmd.at, revision, status: 'PLANNED', reasonCode: null, artifact: missingArtifact() };
  else {
    const prior = attempts.get(cmd.attemptId); requirePilot(prior, 'UNKNOWN_ATTEMPT');
    attempt = { ...prior, revision, status: cmd.status, reasonCode: cmd.reasonCode, artifact: cmd.artifact };
  }
  validateAttempt(attempt); verifyFlow(attempt, cmd.kind, cmd.at, attempts);
  const last = ledger.revisions.at(-1);
  requirePilot(!last || Date.parse(cmd.at) >= Date.parse(last.at), 'TIME_REVERSAL');
  const body = { revision, operationId: cmd.operationId, at: cmd.at, kind: cmd.kind, previousHash: ledger.headHash, attempt };
  const hash = await revisionHash(ledger.ledgerId, body);
  return frozen({ ...ledger, revisions: [...ledger.revisions, { ...body, hash }], headHash: hash });
}
/** Recovery appends interruptions for both PLANNED and START_REQUESTED; never resumes an experiment. */
export async function interruptOpenAttempts(input: PilotLedger, at: string, recoveryId: string): Promise<PilotLedger> {
  isoTime(at); id(recoveryId);
  let ledger = await validatePilotLedger(input);
  for (const attempt of currentAttempts(ledger).filter((a) => !isTerminal(a.status))) {
    ledger = await applyPilotCommand(ledger, { kind: 'TRANSITION', operationId: `${recoveryId}:${ledger.revisions.length + 1}`, at,
      attemptId: attempt.attemptId, status: 'INTERRUPTED', reasonCode: 'RELOAD_INTERRUPTED', artifact: attempt.artifact });
  }
  return ledger;
}
export async function serializePilotLedger(ledger: PilotLedger) { return canonicalJson(await validatePilotLedger(ledger)); }
export async function parsePilotLedger(text: string) { return validatePilotLedger(parseCanonicalJson(text)); }

/** Explicit time makes output deterministic for identical inputs. No UI/download or backup claim. */
export async function exportPilotLedger(input: PilotLedger, exportedAt: string): Promise<string> {
  isoTime(exportedAt);
  const ledger = await validatePilotLedger(input);
  const last = ledger.revisions.at(-1);
  requirePilot(!last || Date.parse(exportedAt) >= Date.parse(last.at), 'TIME_REVERSAL');
  const body = { schemaVersion: 1 as const, kind: 'PILOT_LEDGER_EXPORT' as const, exportedAt, ledger };
  return canonicalJson({ ...body, sha256: await jsonSha256(body) });
}
export async function validatePilotExport(input: unknown): Promise<PilotLedgerExport> {
  const value = detached(input), v = exactObject(value, ['schemaVersion', 'kind', 'exportedAt', 'ledger', 'sha256']);
  requirePilot(v.schemaVersion === 1, 'SCHEMA_VERSION_MISMATCH'); requirePilot(v.kind === 'PILOT_LEDGER_EXPORT', 'INVALID_EXPORT_KIND');
  isoTime(v.exportedAt); hashString(v.sha256);
  const ledger = await validatePilotLedger(v.ledger), last = ledger.revisions.at(-1);
  requirePilot(!last || Date.parse(v.exportedAt) >= Date.parse(last.at), 'TIME_REVERSAL');
  requirePilot(await jsonSha256({ schemaVersion: 1, kind: v.kind, exportedAt: v.exportedAt, ledger }) === v.sha256, 'EXPORT_HASH_MISMATCH');
  return frozen(value as PilotLedgerExport);
}
/** Validates only; does not replace, merge or erase a stored ledger. */
export async function importPilotLedger(text: string): Promise<PilotLedger> {
  return (await validatePilotExport(parseCanonicalJson(text))).ledger;
}
