/** A caller must use a new clock ID after a page/monotonic-clock restart. Never a WebM PTS domain. */
export interface ControllerClockDomain {
  readonly kind: 'CONTROLLER_MONOTONIC';
  readonly id: string;
  readonly unit: 'ms';
}
export interface EvaluationWindowContext {
  readonly attemptId: string;
  readonly clockDomain: ControllerClockDomain;
}
export interface EvaluationWindowPlan {
  readonly purpose: 'PILOT_PROPOSAL' | 'CONFIRMATORY_PROPOSAL';
  readonly durationMs: number;
  readonly criteriaStatus: 'PROPOSED';
  readonly registrationStatus: 'NOT_REGISTERED';
}
export interface ControllerObservation extends EvaluationWindowContext {
  readonly observedAtMs: number;
}
/** Continuous recording coverage declared by a future caller, NOT inferred from two frame timestamps. */
export interface ControllerRecordedInterval {
  readonly startMs: number;
  readonly endMs: number;
}
export interface EvaluationWindowEndObservation extends EvaluationWindowContext {
  /** Actual end observation, if available. Null must not be filled from the scheduled deadline. */
  readonly observedEndAtMs: number | null;
  /** When the end/interrupt callback was observed in the same controller clock. */
  readonly callbackAtMs: number;
  /** Original ordered, non-overlapping ranges; preserve gaps and out-of-window tails. */
  readonly recordedIntervals: readonly ControllerRecordedInterval[];
}
export interface EvaluationWindowTermination extends EvaluationWindowEndObservation {
  readonly kind: 'END' | 'INTERRUPT';
  readonly reasonCode: string | null;
}
export type EvaluationWindowStatus = 'PLANNED' | 'RUNNING' | 'CONTROLLER_RECORDED' | 'INCOMPLETE';
export type EvaluationIncompleteReason = 'NOT_STARTED' | 'END_NOT_OBSERVED' | 'INTERRUPTED' |
  'END_OBSERVATION_MISSING' | 'ENDED_EARLY' | 'RECORDING_GAPS';

/** M2 observation contract only. No ledger revision, capture schema, clock mapping or scoring changes. */
export interface EvaluationWindow extends EvaluationWindowContext {
  readonly schemaVersion: 1;
  readonly kind: 'INDEPENDENT_EVALUATION_WINDOW';
  readonly plan: EvaluationWindowPlan;
  readonly start: ControllerObservation | null;
  /** Controller scheduling deadline only; never canonical WebM E_end. */
  readonly scheduledEndAtMs: number | null;
  readonly termination: EvaluationWindowTermination | null;
  /** CONTROLLER_RECORDED means declared controller coverage, not video integrity/GT/evaluation PASS. */
  readonly status: EvaluationWindowStatus;
  readonly incompleteReasons: readonly EvaluationIncompleteReason[];
  readonly coverageBasis: 'CALLER_DECLARED_CONTROLLER_INTERVALS';
  readonly clockMappingStatus: 'UNVERIFIED';
  readonly canonicalWebmWindow: null;
  readonly evaluationStatus: 'NOT_EVALUATED';
}
