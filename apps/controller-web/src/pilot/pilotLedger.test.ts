// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { applyPilotCommand, ATTEMPT_STATUSES, createPilotLedger, currentAttempts, exportPilotLedger, importPilotLedger,
  interruptOpenAttempts, missingArtifact, parsePilotLedger, serializePilotLedger, validatePilotLedger, validatePilotExport } from './pilotLedger';
import { canonicalJson, detached, jsonSha256, parseCanonicalJson } from './pilotSerialization';
import type { PilotCommand, PilotLedger } from './pilotTypes';
import { at, ledgerAt, register, transition, verifiedArtifact } from './pilotTestFixtures';

describe('pilot attempt history', () => {
  it('registers intent before any capture, with explicit missing/unregistered values', async () => {
    const ledger = await ledgerAt();
    expect(currentAttempts(ledger)).toEqual([{ schemaVersion: 1, attemptId: 'attempt-1', sessionId: null,
      split: 'DEVELOPMENT', approvalRef: null, registrationRef: null, retryOf: null, createdAt: at(), revision: 1,
      status: 'PLANNED', reasonCode: null, artifact: missingArtifact() }]);
    expect(ledger.revisions[0].previousHash).toBeNull();
    expect(ledger.headHash).toBe(ledger.revisions[0].hash);
  });
  it('keeps all older snapshots and creation metadata unchanged', async () => {
    const old = await ledgerAt(), before = canonicalJson(old);
    const started = await applyPilotCommand(old, transition('START_REQUESTED'));
    const complete = await applyPilotCommand(started, transition('COMPLETE', 'attempt-1', 2));
    expect(canonicalJson(old)).toBe(before);
    expect(complete.revisions.map((r) => [r.revision, r.attempt.status])).toEqual([[1, 'PLANNED'], [2, 'START_REQUESTED'], [3, 'COMPLETE']]);
    expect(complete.revisions[0]).toEqual(old.revisions[0]);
    expect(currentAttempts(complete)[0]).toMatchObject({ createdAt: at(), artifact: verifiedArtifact() });
    expect(Object.isFrozen(complete.revisions[2].attempt.artifact.identity)).toBe(true);
    expect(() => { (complete.revisions as unknown[]).pop(); }).toThrow();
  });
  it.each(['SETUP_FAILED', 'ARTIFACT_FAILED', 'INTERRUPTED'] as const)('keeps %s permanently, retry is a new attempt', async (status) => {
    const failed = await ledgerAt(status), retry = register('attempt-2');
    if (retry.kind !== 'REGISTER') throw new Error('fixture');
    const next = await applyPilotCommand(failed, { ...retry, at: at(3), metadata: { ...retry.metadata, retryOf: 'attempt-1' } });
    expect(currentAttempts(next).map((a) => a.status)).toEqual([status, 'PLANNED']);
    expect(next.revisions.slice(0, -1)).toEqual(failed.revisions);
    await expect(applyPilotCommand(failed, { ...register(), operationId: 'new-op', at: at(3) })).rejects.toThrow('DUPLICATE_ATTEMPT_ID');
  });
  it.each(ATTEMPT_STATUSES)('permits only defined transitions from %s', async (from) => {
    const ledger = await ledgerAt(from);
    const allowed = from === 'PLANNED' ? ['START_REQUESTED', 'SETUP_FAILED', 'INTERRUPTED']
      : from === 'START_REQUESTED' ? ['SETUP_FAILED', 'ARTIFACT_FAILED', 'INTERRUPTED', 'COMPLETE'] : [];
    for (const to of ATTEMPT_STATUSES.filter((s) => s !== 'PLANNED')) {
      const command = { ...transition(to, 'attempt-1', 3), operationId: `new-${to}` };
      if (allowed.includes(to)) expect(currentAttempts(await applyPilotCommand(ledger, command))[0].status).toBe(to);
      else await expect(applyPilotCommand(ledger, command)).rejects.toThrow('ILLEGAL_TRANSITION');
    }
  });
  it('rejects duplicate operation IDs even across attempts', async () => {
    const ledger = await ledgerAt();
    await expect(applyPilotCommand(ledger, register())).rejects.toThrow('DUPLICATE_OPERATION');
    await expect(applyPilotCommand(ledger, register('attempt-2', 'register-attempt-1'))).rejects.toThrow('DUPLICATE_OPERATION');
    expect(ledger.revisions).toHaveLength(1);
  });
  it('rejects nonexistent attempts/retry parents and retries of successful attempts', async () => {
    await expect(applyPilotCommand(createPilotLedger('empty'), transition('START_REQUESTED'))).rejects.toThrow('UNKNOWN_ATTEMPT');
    const retry = register('retry'); if (retry.kind !== 'REGISTER') throw new Error('fixture');
    for (const ledger of [createPilotLedger('empty'), await ledgerAt(), await ledgerAt('COMPLETE')]) {
      await expect(applyPilotCommand(ledger, { ...retry, at: at(3), metadata: { ...retry.metadata, retryOf: 'attempt-1' } })).rejects.toThrow('INVALID_RETRY');
    }
  });
  it('requires reasons for failures and an explicit external artifact claim for COMPLETE', async () => {
    const ledger = await ledgerAt('START_REQUESTED');
    await expect(applyPilotCommand(ledger, { ...transition('INTERRUPTED', 'attempt-1', 2), reasonCode: null } as PilotCommand)).rejects.toThrow('INVALID_REASON');
    await expect(applyPilotCommand(ledger, { ...transition('COMPLETE', 'attempt-1', 2), artifact: missingArtifact() } as PilotCommand)).rejects.toThrow('COMPLETE_REQUIRES_ARTIFACT_CLAIM');
    await expect(applyPilotCommand(ledger, { ...transition('ARTIFACT_FAILED', 'attempt-1', 2), artifact: missingArtifact() } as PilotCommand)).rejects.toThrow('ARTIFACT_FAILURE_REQUIRED');
    await expect(applyPilotCommand(ledger, { ...transition('COMPLETE', 'attempt-1', 2), artifact: { ...verifiedArtifact(), verificationRef: null } } as PilotCommand)).rejects.toThrow('VERIFICATION_REFERENCE_REQUIRED');
  });
  it('rejects timestamp reversal and malformed dates without fixing them', async () => {
    const ledger = await ledgerAt('START_REQUESTED');
    await expect(applyPilotCommand(ledger, transition('INTERRUPTED', 'attempt-1', 0))).rejects.toThrow('TIME_REVERSAL');
    await expect(applyPilotCommand(ledger, { ...transition('INTERRUPTED'), at: '2026-02-30T00:00:00.000Z' })).rejects.toThrow('INVALID_TIME');
  });
  it('detaches caller inputs before async hashing', async () => {
    const command = detached(register());
    const pending = applyPilotCommand(createPilotLedger('ledger-1'), command);
    (command as unknown as { metadata: { attemptId: string } }).metadata.attemptId = 'mutated';
    expect(currentAttempts(await pending)[0].attemptId).toBe('attempt-1');
  });
});

describe('SHA chain and strict JSON boundaries', () => {
  it('hashes canonical UTF-8 using actual SHA-256, including the ledger identity', async () => {
    expect(await jsonSha256({ b: 2, a: 1 })).toBe(createHash('sha256').update('{"a":1,"b":2}').digest('hex'));
    const ledger = await ledgerAt(), { hash, ...body } = ledger.revisions[0];
    expect(hash).toBe(createHash('sha256').update(canonicalJson({ domain: 'PILOT_LEDGER_REVISION_V1', ledgerId: 'ledger-1', ...body })).digest('hex'));
    await expect(validatePilotLedger({ ...ledger, ledgerId: 'other-ledger' })).rejects.toThrow('REVISION_HASH_MISMATCH');
  });
  it.each(['old-content', 'previous-hash', 'revision-backwards', 'truncated-tail', 'head', 'schema', 'duplicate-operation'] as const)('rejects %s corruption without rewriting the input', async (kind) => {
    const original = await ledgerAt('COMPLETE');
    const value = JSON.parse(canonicalJson(original));
    if (kind === 'old-content') value.revisions[0].attempt.approvalRef = 'modified';
    if (kind === 'previous-hash') value.revisions[1].previousHash = 'b'.repeat(64);
    if (kind === 'revision-backwards') value.revisions[1].revision = 1;
    if (kind === 'truncated-tail') value.revisions.pop();
    if (kind === 'head') value.headHash = null;
    if (kind === 'schema') value.schemaVersion = 2;
    if (kind === 'duplicate-operation') value.revisions[1].operationId = value.revisions[0].operationId;
    const before = canonicalJson(value);
    await expect(validatePilotLedger(value)).rejects.toThrow();
    expect(canonicalJson(value)).toBe(before);
  });
  it('rejects a freshly rehashed but illegal terminal-to-success history', async () => {
    const failed = JSON.parse(canonicalJson(await ledgerAt('SETUP_FAILED')));
    const body = { revision: 4, operationId: 'rewrite-as-success', at: at(3), kind: 'TRANSITION', previousHash: failed.headHash,
      attempt: { ...failed.revisions[2].attempt, revision: 4, status: 'COMPLETE', reasonCode: null, artifact: verifiedArtifact() } };
    const hash = await jsonSha256({ domain: 'PILOT_LEDGER_REVISION_V1', ledgerId: failed.ledgerId, ...body });
    failed.revisions.push({ ...body, hash }); failed.headHash = hash;
    await expect(validatePilotLedger(failed)).rejects.toThrow('ILLEGAL_TRANSITION');
  });
  it('rejects metadata changes across revisions even if the changed snapshot is rehashed', async () => {
    const value = JSON.parse(canonicalJson(await ledgerAt('START_REQUESTED')));
    value.revisions[1].attempt.split = 'HOLDOUT';
    const { hash: _old, ...body } = value.revisions[1];
    value.headHash = value.revisions[1].hash = await jsonSha256({ domain: 'PILOT_LEDGER_REVISION_V1', ledgerId: value.ledgerId, ...body });
    await expect(validatePilotLedger(value)).rejects.toThrow('ATTEMPT_METADATA_CHANGED');
  });
  it('rejects raw payloads, unknown keys and enum coercion', async () => {
    const ledger = await ledgerAt();
    await expect(validatePilotLedger({ ...ledger, landmarks: [] })).rejects.toThrow('UNEXPECTED_FIELDS');
    const command = register(); if (command.kind !== 'REGISTER') throw new Error('fixture');
    await expect(applyPilotCommand(ledger, { ...command, operationId: 'new', metadata: { ...command.metadata, split: ['DEVELOPMENT'] } } as unknown as PilotCommand)).rejects.toThrow('INVALID_SPLIT');
  });
  it.each([NaN, Infinity, -Infinity, -0, undefined, new Date(), 1n, [, 1], { x: undefined }])('rejects lossy/non-JSON data %s', (value) => {
    expect(() => canonicalJson(value)).toThrow();
  });
  it('rejects cycles/accessors/symbol keys rather than invoking or dropping them', () => {
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow('CYCLIC_JSON');
    const getter = vi.fn(() => 1), accessor = Object.defineProperty({}, 'value', { enumerable: true, get: getter });
    expect(() => canonicalJson(accessor)).toThrow('NON_JSON_OBJECT'); expect(getter).not.toHaveBeenCalled();
    expect(() => canonicalJson({ [Symbol('hidden')]: 1 })).toThrow('NON_JSON_OBJECT');
  });
  it('uses stable key ordering while preserving array order and string content', () => {
    expect(canonicalJson({ z: [2, 1], a: '합성\n"' })).toBe('{"a":"합성\\n\\\"","z":[2,1]}');
    expect(canonicalJson({ z: 2, a: 1 })).toBe(canonicalJson({ a: 1, z: 2 }));
  });
  it('rejects corrupt JSON, duplicate JSON keys, and noncanonical input explicitly', () => {
    expect(() => parseCanonicalJson('{broken')).toThrow('INVALID_JSON');
    expect(() => parseCanonicalJson('{"x":1,"x":2}')).toThrow('NON_CANONICAL_JSON');
    expect(() => parseCanonicalJson('{ "x": 1 }')).toThrow('NON_CANONICAL_JSON');
  });
  it('fails closed when cryptographic hashing is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);
    try { await expect(jsonSha256({})).rejects.toThrow('CRYPTO_UNAVAILABLE'); } finally { vi.unstubAllGlobals(); }
  });
});

describe('recovery and export', () => {
  it('appends interruption for every open intent, preserves terminal failures, and is idempotent', async () => {
    let ledger = await ledgerAt('ARTIFACT_FAILED');
    for (const name of ['planned', 'started']) ledger = await applyPilotCommand(ledger, { ...register(name), at: at(3) });
    ledger = await applyPilotCommand(ledger, transition('START_REQUESTED', 'started', 4));
    const recovered = await interruptOpenAttempts(ledger, at(5), 'reload-1');
    expect(recovered.revisions.slice(0, ledger.revisions.length)).toEqual(ledger.revisions);
    expect(currentAttempts(recovered).map((a) => [a.status, a.reasonCode])).toEqual([
      ['ARTIFACT_FAILED', 'SYNTHETIC_FAILURE'], ['INTERRUPTED', 'RELOAD_INTERRUPTED'], ['INTERRUPTED', 'RELOAD_INTERRUPTED']]);
    expect(await interruptOpenAttempts(recovered, at(6), 'reload-2')).toEqual(recovered);
  });
  it('round-trips all revisions including failed/missing artifacts without mutation', async () => {
    const ledger = await ledgerAt('ARTIFACT_FAILED'), text = await exportPilotLedger(ledger, at(4));
    expect(await exportPilotLedger(ledger, at(4))).toBe(text);
    expect(await importPilotLedger(text)).toEqual(ledger);
    expect((await validatePilotExport(JSON.parse(text))).ledger.revisions).toHaveLength(3);
    expect(await parsePilotLedger(await serializePilotLedger(ledger))).toEqual(ledger);
    expect(JSON.parse(text)).toMatchObject({ schemaVersion: 1, exportedAt: at(4), kind: 'PILOT_LEDGER_EXPORT' });
  });
  it.each(['time', 'hash', 'version', 'nested-revision', 'extra', 'missing'] as const)('rejects invalid export %s', async (kind) => {
    const value = JSON.parse(await exportPilotLedger(await ledgerAt(), at(2)));
    if (kind === 'time') value.exportedAt = at(3);
    if (kind === 'hash') value.sha256 = '0'.repeat(64);
    if (kind === 'version') value.schemaVersion = 2;
    if (kind === 'nested-revision') value.ledger.revisions[0].attempt.sessionId = 'changed';
    if (kind === 'extra') value.video = 'forbidden';
    if (kind === 'missing') delete value.ledger;
    await expect(importPilotLedger(canonicalJson(value))).rejects.toThrow();
  });
  it('accepts a valid old export only as data, without claiming cold-start rollback detection', async () => {
    const old = await ledgerAt();
    await applyPilotCommand(old, transition('START_REQUESTED'));
    // Without an external trusted head, a valid older prefix is indistinguishable from a backup.
    expect(await importPilotLedger(await exportPilotLedger(old, at(2)))).toEqual(old);
  });
});
