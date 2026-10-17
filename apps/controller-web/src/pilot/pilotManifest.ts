import type { PilotAttempt, PilotManifest } from './pilotTypes';
import { ATTEMPT_STATUSES, validateArtifact, validateAttempt } from './pilotLedger';
import { canonicalJson, detached, exactObject, frozen, id, nullableId, parseCanonicalJson, reason, requirePilot } from './pilotSerialization';

const REQUIRED_INCOMPLETE = ['CRITERIA_UNREGISTERED', 'CLOCK_UNVERIFIED', 'ANNOTATION_MISSING', 'E_WINDOW_MISSING'];
function reasonList(value: unknown): asserts value is string[] {
  requirePilot(Array.isArray(value), 'INVALID_REASONS'); value.forEach(reason);
  requirePilot(new Set(value).size === value.length, 'DUPLICATE_REASON');
}
function incompleteReasons(identifiers: PilotManifest['identifiers'], media: PilotManifest['testMedia']) {
  return [...REQUIRED_INCOMPLETE,
    ...Object.entries(identifiers).filter(([, value]) => value === null).map(([key]) => `${key.toUpperCase()}_IDENTIFIER_MISSING`),
    ...(media.presence === 'MISSING' ? ['TEST_MEDIA_MISSING'] : []),
    ...(media.verification !== 'VERIFIED' ? ['TEST_MEDIA_UNVERIFIED'] : [])];
}
/** Structural validation ONLY. Does not inspect files, approve registration, align clocks or judge GT. */
export function validatePilotManifest(input: unknown): PilotManifest {
  const value = detached(input), v = exactObject(value, ['schemaVersion', 'kind', 'attemptId', 'attemptRevision', 'attemptStatus',
    'sessionId', 'split', 'approvalRef', 'registration', 'plan', 'guide', 'identifiers', 'testMedia', 'referenceMedia',
    'clockMapping', 'annotation', 'evaluationWindow', 'evaluationStatus', 'failureReasons', 'incompleteReasons']);
  requirePilot(v.schemaVersion === 1, 'SCHEMA_VERSION_MISMATCH');
  requirePilot(v.kind === 'PILOT_SIDECAR_FOUNDATION', 'INVALID_MANIFEST_KIND');
  id(v.attemptId); nullableId(v.sessionId); nullableId(v.approvalRef);
  requirePilot(Number.isSafeInteger(v.attemptRevision) && (v.attemptRevision as number) > 0, 'INVALID_REVISION');
  requirePilot(ATTEMPT_STATUSES.includes(v.attemptStatus as PilotAttempt['status']), 'INVALID_STATUS');
  requirePilot(typeof v.split === 'string' && ['DEVELOPMENT', 'REGRESSION', 'HOLDOUT'].includes(v.split), 'INVALID_SPLIT');
  const registration = exactObject(v.registration, ['status', 'reference']);
  if (registration.status === 'UNREGISTERED') requirePilot(registration.reference === null, 'UNREGISTERED_REFERENCE');
  else { requirePilot(registration.status === 'REFERENCE_ONLY', 'REGISTRATION_NOT_SUPPORTED'); id(registration.reference); }
  const plan = exactObject(v.plan, ['version', 'status']), guide = exactObject(v.guide, ['version']);
  requirePilot(plan.version === '4X-PLAN-1' && plan.status === 'PROPOSED' && guide.version === '4X-GT-1', 'UNAPPROVED_CRITERIA');
  const identifiers = exactObject(v.identifiers, ['source', 'config', 'model']); Object.values(identifiers).forEach(nullableId);
  validateArtifact(v.testMedia); if (v.referenceMedia !== null) validateArtifact(v.referenceMedia);
  requirePilot(exactObject(v.clockMapping, ['status']).status === 'UNVERIFIED', 'CLOCK_VERIFICATION_NOT_SUPPORTED');
  requirePilot(exactObject(v.annotation, ['status']).status === 'MISSING', 'ANNOTATION_NOT_SUPPORTED');
  requirePilot(exactObject(v.evaluationWindow, ['status']).status === 'MISSING', 'E_WINDOW_NOT_SUPPORTED');
  requirePilot(v.evaluationStatus === 'NOT_EVALUATED', 'EVALUATION_NOT_SUPPORTED');
  reasonList(v.failureReasons); reasonList(v.incompleteReasons);
  const failed = ['SETUP_FAILED', 'ARTIFACT_FAILED', 'INTERRUPTED'].includes(v.attemptStatus as string);
  requirePilot(failed ? v.failureReasons.length > 0 : v.failureReasons.length === 0, 'FAILURE_REASON_MISMATCH');
  if (v.attemptStatus === 'COMPLETE') requirePilot(v.testMedia.verification === 'VERIFIED', 'COMPLETE_REQUIRES_ARTIFACT_CLAIM');
  if (v.attemptStatus === 'ARTIFACT_FAILED') requirePilot(v.testMedia.verification === 'FAILED', 'ARTIFACT_FAILURE_REQUIRED');
  if (v.attemptStatus === 'PLANNED' || v.attemptStatus === 'START_REQUESTED') {
    requirePilot(v.testMedia.presence === 'MISSING' && v.testMedia.verification === 'UNVERIFIED', 'PREPARATION_ARTIFACT');
  }
  const expected = incompleteReasons(identifiers as PilotManifest['identifiers'], v.testMedia);
  requirePilot(expected.every((r) => (v.incompleteReasons as string[]).includes(r)), 'MISSING_INCOMPLETE_REASON');
  return frozen(value as PilotManifest);
}
/** Copies only allowlisted metadata; no media hashes, clocks, annotations or approval are invented. */
export function createPilotManifest(input: PilotAttempt): PilotManifest {
  const attempt = detached(input); validateAttempt(attempt);
  const identifiers = { source: null, config: null, model: null };
  return validatePilotManifest({
    schemaVersion: 1, kind: 'PILOT_SIDECAR_FOUNDATION', attemptId: attempt.attemptId, attemptRevision: attempt.revision,
    attemptStatus: attempt.status, sessionId: attempt.sessionId, split: attempt.split, approvalRef: attempt.approvalRef,
    registration: attempt.registrationRef === null ? { status: 'UNREGISTERED', reference: null }
      : { status: 'REFERENCE_ONLY', reference: attempt.registrationRef },
    plan: { version: '4X-PLAN-1', status: 'PROPOSED' }, guide: { version: '4X-GT-1' }, identifiers,
    testMedia: attempt.artifact, referenceMedia: null,
    clockMapping: { status: 'UNVERIFIED' }, annotation: { status: 'MISSING' }, evaluationWindow: { status: 'MISSING' },
    evaluationStatus: 'NOT_EVALUATED', failureReasons: attempt.reasonCode === null ? [] : [attempt.reasonCode],
    incompleteReasons: incompleteReasons(identifiers, attempt.artifact),
  });
}
export function serializePilotManifest(value: PilotManifest) { return canonicalJson(validatePilotManifest(value)); }
export function parsePilotManifest(text: string) { return validatePilotManifest(parseCanonicalJson(text)); }
