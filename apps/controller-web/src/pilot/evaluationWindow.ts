import { canonicalJson, detached, exactObject, frozen, id, parseCanonicalJson, reason, requirePilot } from './pilotSerialization';
import type { ControllerObservation, ControllerRecordedInterval, EvaluationIncompleteReason, EvaluationWindow,
  EvaluationWindowContext, EvaluationWindowEndObservation, EvaluationWindowPlan, EvaluationWindowStatus } from './evaluationWindowTypes';

/** Preserves the proposed future confirmatory duration; no confirmatory collection is executed here. */
export const CONFIRMATORY_E_DURATION_MS = 120_000;
const CONTEXT_KEYS = ['attemptId', 'clockDomain'];
const END_KEYS = [...CONTEXT_KEYS, 'observedEndAtMs', 'callbackAtMs', 'recordedIntervals'];

function controllerMs(value: unknown): asserts value is number {
  requirePilot(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER && !Object.is(value, -0), 'INVALID_CONTROLLER_TIME');
}
function validateContext(value: Record<string, unknown>) {
  id(value.attemptId);
  const clock = exactObject(value.clockDomain, ['kind', 'id', 'unit']); id(clock.id);
  requirePilot(clock.kind === 'CONTROLLER_MONOTONIC' && clock.unit === 'ms', 'INVALID_CLOCK_DOMAIN');
}
function requireSameContext(value: Record<string, unknown>, window: EvaluationWindowContext) {
  validateContext(value);
  requirePilot(value.attemptId === window.attemptId, 'ATTEMPT_MISMATCH');
  requirePilot(canonicalJson(value.clockDomain) === canonicalJson(window.clockDomain), 'CLOCK_DOMAIN_MISMATCH');
}
function validatePlan(value: unknown): asserts value is EvaluationWindowPlan {
  const plan = exactObject(value, ['purpose', 'durationMs', 'criteriaStatus', 'registrationStatus']);
  requirePilot(plan.criteriaStatus === 'PROPOSED' && plan.registrationStatus === 'NOT_REGISTERED', 'UNAPPROVED_EVALUATION_PLAN');
  requirePilot(plan.purpose === 'PILOT_PROPOSAL' || plan.purpose === 'CONFIRMATORY_PROPOSAL', 'INVALID_WINDOW_PURPOSE');
  controllerMs(plan.durationMs);
  if (plan.purpose === 'CONFIRMATORY_PROPOSAL') requirePilot(plan.durationMs === CONFIRMATORY_E_DURATION_MS, 'INVALID_CONFIRMATORY_DURATION');
  else requirePilot(plan.durationMs > 0 && plan.durationMs <= CONFIRMATORY_E_DURATION_MS, 'INVALID_PILOT_DURATION');
}
function validateStart(value: unknown, window: EvaluationWindowContext): asserts value is ControllerObservation {
  const start = exactObject(value, [...CONTEXT_KEYS, 'observedAtMs']);
  requireSameContext(start, window); controllerMs(start.observedAtMs);
}
function validateEnd(value: Record<string, unknown>, window: EvaluationWindow) {
  requireSameContext(value, window);
  requirePilot(window.start !== null, 'WINDOW_NOT_STARTED');
  controllerMs(value.callbackAtMs);
  requirePilot(value.callbackAtMs >= window.start.observedAtMs, 'TIME_REVERSAL');
  if (value.observedEndAtMs !== null) {
    controllerMs(value.observedEndAtMs);
    requirePilot(value.observedEndAtMs >= window.start.observedAtMs && value.observedEndAtMs <= value.callbackAtMs, 'TIME_REVERSAL');
  }
  requirePilot(Array.isArray(value.recordedIntervals), 'INVALID_RECORDED_INTERVALS');
  let previousEnd: number | null = null;
  for (const item of value.recordedIntervals) {
    const interval = exactObject(item, ['startMs', 'endMs']);
    controllerMs(interval.startMs); controllerMs(interval.endMs);
    requirePilot(interval.startMs < interval.endMs, 'INVALID_RECORDED_INTERVAL');
    // No sorting/merging/coercion: reversed, duplicate or overlapping evidence is rejected.
    requirePilot(previousEnd === null || interval.startMs >= previousEnd, 'INTERVAL_ORDER_OR_OVERLAP');
    requirePilot(interval.endMs <= (value.observedEndAtMs ?? value.callbackAtMs), 'INTERVAL_AFTER_OBSERVATION');
    previousEnd = interval.endMs;
  }
}
/** Only subtract explicitly supplied coverage from the planned controller interval. No interpolation. */
function coverageGaps(start: number, end: number, intervals: readonly ControllerRecordedInterval[]) {
  const gaps: ControllerRecordedInterval[] = [];
  let cursor = start;
  for (const interval of intervals) {
    const left = Math.max(start, interval.startMs), right = Math.min(end, interval.endMs);
    if (right <= left) continue;
    if (left > cursor) gaps.push({ startMs: cursor, endMs: left });
    cursor = right;
  }
  if (cursor < end) gaps.push({ startMs: cursor, endMs: end });
  return gaps;
}
function summary(window: EvaluationWindow): { status: EvaluationWindowStatus; incompleteReasons: EvaluationIncompleteReason[] } {
  if (window.start === null) return { status: 'PLANNED', incompleteReasons: ['NOT_STARTED'] };
  if (window.termination === null) return { status: 'RUNNING', incompleteReasons: ['END_NOT_OBSERVED'] };
  const end = window.termination, reasons: EvaluationIncompleteReason[] = [];
  if (end.kind === 'INTERRUPT') reasons.push('INTERRUPTED');
  if (end.observedEndAtMs === null) reasons.push('END_OBSERVATION_MISSING');
  else if (end.observedEndAtMs < window.scheduledEndAtMs!) reasons.push('ENDED_EARLY');
  if (coverageGaps(window.start.observedAtMs, window.scheduledEndAtMs!, end.recordedIntervals).length) reasons.push('RECORDING_GAPS');
  return { status: reasons.length ? 'INCOMPLETE' : 'CONTROLLER_RECORDED', incompleteReasons: reasons };
}

/** Strict structural/history validation; it cannot authenticate the caller's coverage declarations. */
export function validateEvaluationWindow(input: unknown): EvaluationWindow {
  const value = detached(input), v = exactObject(value, ['schemaVersion', 'kind', ...CONTEXT_KEYS, 'plan', 'start', 'scheduledEndAtMs',
    'termination', 'status', 'incompleteReasons', 'coverageBasis', 'clockMappingStatus', 'canonicalWebmWindow', 'evaluationStatus']);
  requirePilot(v.schemaVersion === 1, 'SCHEMA_VERSION_MISMATCH');
  requirePilot(v.kind === 'INDEPENDENT_EVALUATION_WINDOW', 'INVALID_WINDOW_KIND');
  validateContext(v); validatePlan(v.plan);
  requirePilot(v.coverageBasis === 'CALLER_DECLARED_CONTROLLER_INTERVALS', 'INVALID_COVERAGE_BASIS');
  requirePilot(v.clockMappingStatus === 'UNVERIFIED' && v.canonicalWebmWindow === null, 'CLOCK_MAPPING_NOT_IMPLEMENTED');
  requirePilot(v.evaluationStatus === 'NOT_EVALUATED', 'EVALUATION_NOT_SUPPORTED');
  const window = value as EvaluationWindow;
  if (v.start === null) {
    requirePilot(v.scheduledEndAtMs === null && v.termination === null, 'WINDOW_NOT_STARTED');
  } else {
    validateStart(v.start, window);
    controllerMs(v.scheduledEndAtMs);
    requirePilot(v.scheduledEndAtMs === v.start.observedAtMs + v.plan.durationMs && v.scheduledEndAtMs > v.start.observedAtMs, 'INVALID_SCHEDULED_END');
    if (v.termination !== null) {
      const end = exactObject(v.termination, [...END_KEYS, 'kind', 'reasonCode']);
      requirePilot(end.kind === 'END' || end.kind === 'INTERRUPT', 'INVALID_TERMINATION_KIND');
      if (end.kind === 'INTERRUPT') reason(end.reasonCode);
      else requirePilot(end.reasonCode === null, 'UNEXPECTED_REASON');
      validateEnd(end, window);
    }
  }
  const expected = summary(window);
  requirePilot(v.status === expected.status && canonicalJson(v.incompleteReasons) === canonicalJson(expected.incompleteReasons), 'WINDOW_STATUS_MISMATCH');
  return frozen(window);
}

export function createEvaluationWindow(context: EvaluationWindowContext, plan: EvaluationWindowPlan): EvaluationWindow {
  const source = detached(context); exactObject(source, CONTEXT_KEYS);
  return validateEvaluationWindow({ ...source, schemaVersion: 1, kind: 'INDEPENDENT_EVALUATION_WINDOW', plan,
    start: null, scheduledEndAtMs: null, termination: null, status: 'PLANNED', incompleteReasons: ['NOT_STARTED'],
    coverageBasis: 'CALLER_DECLARED_CONTROLLER_INTERVALS', clockMappingStatus: 'UNVERIFIED', canonicalWebmWindow: null, evaluationStatus: 'NOT_EVALUATED' });
}
export function startEvaluationWindow(input: EvaluationWindow, observation: ControllerObservation): EvaluationWindow {
  const window = validateEvaluationWindow(input), start = detached(observation);
  requirePilot(window.start === null, 'WINDOW_ALREADY_STARTED');
  validateStart(start, window);
  return validateEvaluationWindow({ ...window, start, scheduledEndAtMs: start.observedAtMs + window.plan.durationMs,
    status: 'RUNNING', incompleteReasons: ['END_NOT_OBSERVED'] });
}
function terminate(input: EvaluationWindow, observation: EvaluationWindowEndObservation, kind: 'END' | 'INTERRUPT', reasonCode: string | null) {
  const window = validateEvaluationWindow(input), end = detached(observation);
  requirePilot(window.start !== null, 'WINDOW_NOT_STARTED');
  requirePilot(window.termination === null, 'WINDOW_ALREADY_TERMINATED');
  exactObject(end, END_KEYS); validateEnd(end as unknown as Record<string, unknown>, window);
  if (kind === 'INTERRUPT') reason(reasonCode);
  const next: EvaluationWindow = { ...window, termination: { ...end, kind, reasonCode } };
  return validateEvaluationWindow({ ...next, ...summary(next) });
}
/** Late callbacks never extend the schedule; no coverage is assumed if recordedIntervals is empty. */
export function endEvaluationWindow(window: EvaluationWindow, observation: EvaluationWindowEndObservation): EvaluationWindow {
  return terminate(window, observation, 'END', null);
}
/** Interruptions are terminal INCOMPLETE even if declared coverage happens to reach the deadline. */
export function interruptEvaluationWindow(window: EvaluationWindow, observation: EvaluationWindowEndObservation, reasonCode: string): EvaluationWindow {
  return terminate(window, observation, 'INTERRUPT', reasonCode);
}

/** null = not started. Gaps mean unreported controller coverage, not inferred physical video loss. */
export function controllerCoverageGaps(input: EvaluationWindow): readonly ControllerRecordedInterval[] | null {
  const window = validateEvaluationWindow(input);
  return window.start === null ? null : frozen(coverageGaps(window.start.observedAtMs, window.scheduledEndAtMs!, window.termination?.recordedIntervals ?? []));
}
/** Planned controller membership ONLY. This is never a scoring/observation/PASS decision. */
export function containsPlannedControllerTime(input: EvaluationWindow, observation: ControllerObservation): boolean {
  const window = validateEvaluationWindow(input), point = detached(observation);
  validateStart(point, window);
  requirePilot(window.start !== null, 'WINDOW_NOT_STARTED');
  return point.observedAtMs >= window.start.observedAtMs && point.observedAtMs < window.scheduledEndAtMs!;
}
/** Membership additionally supported by declared coverage; missing gaps remain false. */
export function containsRecordedControllerTime(input: EvaluationWindow, observation: ControllerObservation): boolean {
  const window = validateEvaluationWindow(input), point = detached(observation);
  if (!containsPlannedControllerTime(window, point)) return false;
  return window.termination?.recordedIntervals.some((span) => point.observedAtMs >= span.startMs && point.observedAtMs < span.endMs) ?? false;
}
export function serializeEvaluationWindow(input: EvaluationWindow): string { return canonicalJson(validateEvaluationWindow(input)); }
export function parseEvaluationWindow(text: string): EvaluationWindow { return validateEvaluationWindow(parseCanonicalJson(text)); }
