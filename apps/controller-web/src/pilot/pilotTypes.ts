/** Private, low-frequency metadata only. IDs/reason codes must not contain personal data. */
export type ResearchSplit = 'DEVELOPMENT' | 'REGRESSION' | 'HOLDOUT';
/**
 * PLANNED: intent registered before preparation/permission. START_REQUESTED: request only, not recording.
 * SETUP_FAILED: preparation failed. ARTIFACT_FAILED: artifact bookkeeping failed (bytes may be absent).
 * INTERRUPTED: aborted/unresolved intent, including reload. Failures cannot be reopened or overwritten.
 * COMPLETE: explicit administrative closure with an external integrity reference; NOT capture/GT PASS.
 */
export type AttemptStatus = 'PLANNED' | 'START_REQUESTED' | 'INTERRUPTED' | 'SETUP_FAILED' | 'ARTIFACT_FAILED' | 'COMPLETE';

/** VERIFIED is an externally supplied integrity claim, not verification performed by this module. */
export interface PilotArtifact {
  readonly presence: 'MISSING' | 'PRESENT';
  readonly verification: 'UNVERIFIED' | 'VERIFIED' | 'FAILED';
  readonly identity: { readonly sha256: string; readonly byteLength: number } | null;
  readonly verificationRef: string | null;
}

export interface AttemptMetadata {
  readonly attemptId: string;
  readonly sessionId: string | null;
  readonly split: ResearchSplit;
  /** Opaque references only: recording one does not approve/register the STEP 4X criteria. */
  readonly approvalRef: string | null;
  readonly registrationRef: string | null;
  readonly retryOf: string | null;
}

export interface PilotAttempt extends AttemptMetadata {
  readonly schemaVersion: 1;
  readonly createdAt: string;
  /** Global ledger revision at which this snapshot was recorded. */
  readonly revision: number;
  readonly status: AttemptStatus;
  readonly reasonCode: string | null;
  readonly artifact: PilotArtifact;
}

export type PilotCommand = {
  readonly operationId: string;
  readonly at: string;
} & ({ readonly kind: 'REGISTER'; readonly metadata: AttemptMetadata } | {
  readonly kind: 'TRANSITION';
  readonly attemptId: string;
  readonly status: Exclude<AttemptStatus, 'PLANNED'>;
  readonly reasonCode: string | null;
  readonly artifact: PilotArtifact;
});

export interface PilotRevision {
  readonly revision: number;
  readonly operationId: string;
  readonly at: string;
  readonly kind: PilotCommand['kind'];
  readonly previousHash: string | null;
  readonly attempt: PilotAttempt;
  readonly hash: string;
}

/** All snapshots are retained; current attempts are derived, never a second mutable source of truth. */
export interface PilotLedger {
  readonly schemaVersion: 1;
  readonly ledgerId: string;
  readonly revisions: readonly PilotRevision[];
  readonly headHash: string | null;
}

export interface PilotLedgerExport {
  readonly schemaVersion: 1;
  readonly kind: 'PILOT_LEDGER_EXPORT';
  readonly exportedAt: string;
  readonly ledger: PilotLedger;
  readonly sha256: string;
}

/** Foundation only: intentionally cannot represent registered criteria, verified clocks or evaluation PASS. */
export interface PilotManifest {
  readonly schemaVersion: 1;
  readonly kind: 'PILOT_SIDECAR_FOUNDATION';
  readonly attemptId: string;
  readonly attemptRevision: number;
  readonly attemptStatus: AttemptStatus;
  readonly sessionId: string | null;
  readonly split: ResearchSplit;
  readonly approvalRef: string | null;
  readonly registration: { readonly status: 'UNREGISTERED'; readonly reference: null } |
    { readonly status: 'REFERENCE_ONLY'; readonly reference: string };
  readonly plan: { readonly version: '4X-PLAN-1'; readonly status: 'PROPOSED' };
  readonly guide: { readonly version: '4X-GT-1' };
  readonly identifiers: { readonly source: string | null; readonly config: string | null; readonly model: string | null };
  readonly testMedia: PilotArtifact;
  /** null = no reference selection; MISSING = selected but absent. */
  readonly referenceMedia: PilotArtifact | null;
  readonly clockMapping: { readonly status: 'UNVERIFIED' };
  readonly annotation: { readonly status: 'MISSING' };
  readonly evaluationWindow: { readonly status: 'MISSING' };
  readonly evaluationStatus: 'NOT_EVALUATED';
  readonly failureReasons: readonly string[];
  readonly incompleteReasons: readonly string[];
}
