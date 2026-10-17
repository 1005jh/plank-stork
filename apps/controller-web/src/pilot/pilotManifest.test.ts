// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { applyPilotCommand, createPilotLedger, currentAttempts } from './pilotLedger';
import { createPilotManifest, parsePilotManifest, serializePilotManifest, validatePilotManifest } from './pilotManifest';
import { canonicalJson } from './pilotSerialization';
import { ledgerAt, register, verifiedArtifact } from './pilotTestFixtures';

async function manifest() { return createPilotManifest(currentAttempts(await ledgerAt())[0]); }
describe('minimal sidecar foundation (structure only)', () => {
  it('represents missing data explicitly and fabricates no hashes, PTS, anchors or annotations', async () => {
    const value = await manifest();
    expect(value).toMatchObject({ attemptId: 'attempt-1', attemptRevision: 1, sessionId: null, split: 'DEVELOPMENT', approvalRef: null,
      registration: { status: 'UNREGISTERED', reference: null }, plan: { version: '4X-PLAN-1', status: 'PROPOSED' },
      identifiers: { source: null, config: null, model: null }, testMedia: { presence: 'MISSING', identity: null }, referenceMedia: null,
      clockMapping: { status: 'UNVERIFIED' }, annotation: { status: 'MISSING' }, evaluationWindow: { status: 'MISSING' }, evaluationStatus: 'NOT_EVALUATED' });
    expect(value.incompleteReasons).toEqual(['CRITERIA_UNREGISTERED', 'CLOCK_UNVERIFIED', 'ANNOTATION_MISSING', 'E_WINDOW_MISSING',
      'SOURCE_IDENTIFIER_MISSING', 'CONFIG_IDENTIFIER_MISSING', 'MODEL_IDENTIFIER_MISSING', 'TEST_MEDIA_MISSING', 'TEST_MEDIA_UNVERIFIED']);
  });
  it('records opaque approval/registration references without approving 4X or asserting HOLDOUT independence', async () => {
    const command = register(); if (command.kind !== 'REGISTER') throw new Error('fixture');
    const ledger = await applyPilotCommand(createPilotLedger('ledger-1'), { ...command, metadata: { ...command.metadata,
      sessionId: 'synthetic-session', split: 'HOLDOUT', approvalRef: 'approval-reference', registrationRef: 'registration-reference' } });
    const result = createPilotManifest(currentAttempts(ledger)[0]);
    expect(result.registration).toEqual({ status: 'REFERENCE_ONLY', reference: 'registration-reference' });
    expect(result.plan.status).toBe('PROPOSED'); expect(result.evaluationStatus).toBe('NOT_EVALUATED');
    expect(result.incompleteReasons).toContain('CRITERIA_UNREGISTERED');
  });
  it.each(['INTERRUPTED', 'SETUP_FAILED', 'ARTIFACT_FAILED'] as const)('retains %s reason and artifact status', async (status) => {
    const attempt = currentAttempts(await ledgerAt(status))[0], value = createPilotManifest(attempt);
    expect(value.failureReasons).toEqual(['SYNTHETIC_FAILURE']); expect(value.testMedia).toEqual(attempt.artifact);
    expect(parsePilotManifest(serializePilotManifest(value))).toEqual(value);
  });
  it('does not equate COMPLETE with capture completion, GT correctness or evaluation PASS', async () => {
    const value = createPilotManifest(currentAttempts(await ledgerAt('COMPLETE'))[0]);
    expect(value.testMedia).toEqual(verifiedArtifact()); expect(value.attemptStatus).toBe('COMPLETE');
    expect(value.evaluationStatus).toBe('NOT_EVALUATED'); expect(value.incompleteReasons).toContain('CLOCK_UNVERIFIED');
  });
  it.each(['PASS', 'PASS_FOR_SCORELESS_SHADOW', 'COMPLETE', 'FAIL'] as const)('rejects unsupported evaluation status %s', async (status) => {
    const value = await manifest();
    expect(() => validatePilotManifest({ ...value, evaluationStatus: status })).toThrow('EVALUATION_NOT_SUPPORTED');
  });
  it.each(['clock', 'annotation', 'window', 'registered', 'approved', 'wrong-version', 'missing-reasons', 'raw-payload'] as const)('rejects fabricated/invalid %s', async (kind) => {
    const value = JSON.parse(canonicalJson(await manifest()));
    if (kind === 'clock') value.clockMapping.status = 'VERIFIED';
    if (kind === 'annotation') value.annotation.status = 'READY';
    if (kind === 'window') value.evaluationWindow = { status: 'COMPLETE', start: 0, end: 120000 };
    if (kind === 'registered') value.registration = { status: 'REGISTERED', reference: 'fake' };
    if (kind === 'approved') value.plan.status = 'APPROVED';
    if (kind === 'wrong-version') value.schemaVersion = 2;
    if (kind === 'missing-reasons') value.incompleteReasons = [];
    if (kind === 'raw-payload') value.landmarks = [];
    expect(() => validatePilotManifest(value)).toThrow();
  });
  it('rejects omitted fields, duplicate reasons and mislabeled failure state', async () => {
    const value = JSON.parse(canonicalJson(await manifest())); delete value.sessionId;
    expect(() => validatePilotManifest(value)).toThrow('UNEXPECTED_FIELDS');
    const original = await manifest();
    expect(() => validatePilotManifest({ ...original, incompleteReasons: [...original.incompleteReasons, 'CLOCK_UNVERIFIED'] })).toThrow('DUPLICATE_REASON');
    expect(() => validatePilotManifest({ ...original, attemptStatus: 'INTERRUPTED' })).toThrow('FAILURE_REASON_MISMATCH');
  });
  it('allows declared identifiers/reference identity only as structural data, still not evaluation', async () => {
    const value = validatePilotManifest({ ...await manifest(), identifiers: { source: 'source-ref', config: 'config-ref', model: 'model-ref' }, referenceMedia: verifiedArtifact() });
    expect(value.evaluationStatus).toBe('NOT_EVALUATED');
    expect(value.clockMapping.status).toBe('UNVERIFIED');
  });
  it('serializes deterministically, isolates inputs and rejects corrupted JSON', async () => {
    const value = await manifest(), text = serializePilotManifest(value), input = JSON.parse(text);
    const validated = validatePilotManifest(input); input.testMedia.presence = 'PRESENT';
    expect(validated).toEqual(value); expect(Object.isFrozen(validated.incompleteReasons)).toBe(true);
    expect(serializePilotManifest(parsePilotManifest(text))).toBe(text);
    expect(() => parsePilotManifest('{broken')).toThrow('INVALID_JSON');
    expect(() => parsePilotManifest(text + '\n')).toThrow('NON_CANONICAL_JSON');
  });
});
