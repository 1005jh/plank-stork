// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { CONFIRMATORY_E_DURATION_MS, containsPlannedControllerTime, containsRecordedControllerTime, controllerCoverageGaps,
  createEvaluationWindow, endEvaluationWindow, interruptEvaluationWindow, parseEvaluationWindow, serializeEvaluationWindow,
  startEvaluationWindow, validateEvaluationWindow } from './evaluationWindow';
import type { ControllerObservation, EvaluationWindow, EvaluationWindowContext, EvaluationWindowEndObservation,
  EvaluationWindowPlan } from './evaluationWindowTypes';
import { currentAttempts, serializePilotLedger, validatePilotLedger } from './pilotLedger';
import { createPilotManifest, serializePilotManifest, validatePilotManifest } from './pilotManifest';
import { canonicalJson } from './pilotSerialization';
import { ledgerAt } from './pilotTestFixtures';

// Every time, attempt and coverage span below is synthetic. No camera, timer or capture fixture.
const context = (): EvaluationWindowContext => ({ attemptId: 'attempt-1',
  clockDomain: { kind: 'CONTROLLER_MONOTONIC', id: 'synthetic-page-1', unit: 'ms' } });
const plan = (): EvaluationWindowPlan => ({ purpose: 'PILOT_PROPOSAL', durationMs: 1000,
  criteriaStatus: 'PROPOSED', registrationStatus: 'NOT_REGISTERED' });
const point = (observedAtMs: number): ControllerObservation => ({ ...context(), observedAtMs });
const planned = () => createEvaluationWindow(context(), plan());
const running = () => startEvaluationWindow(planned(), point(1000));
const end = (overrides: Partial<EvaluationWindowEndObservation> = {}): EvaluationWindowEndObservation => ({ ...context(),
  observedEndAtMs: 2000, callbackAtMs: 2000, recordedIntervals: [{ startMs: 1000, endMs: 2000 }], ...overrides });
const complete = () => endEvaluationWindow(running(), end());

describe('independent E state and proposed plan', () => {
  it('begins with no observed time, no canonical PTS and no evaluation result', () => {
    expect(planned()).toMatchObject({ schemaVersion: 1, kind: 'INDEPENDENT_EVALUATION_WINDOW', ...context(), plan: plan(),
      start: null, scheduledEndAtMs: null, termination: null, status: 'PLANNED', incompleteReasons: ['NOT_STARTED'],
      coverageBasis: 'CALLER_DECLARED_CONTROLLER_INTERVALS', clockMappingStatus: 'UNVERIFIED',
      canonicalWebmWindow: null, evaluationStatus: 'NOT_EVALUATED' });
  });
  it('starts without any Guided/detector operation and preserves the original state', () => {
    const before = planned(), text = serializeEvaluationWindow(before);
    const started = startEvaluationWindow(before, point(1000));
    expect(started).toMatchObject({ status: 'RUNNING', start: point(1000), scheduledEndAtMs: 2000,
      termination: null, incompleteReasons: ['END_NOT_OBSERVED'] });
    expect(serializeEvaluationWindow(before)).toBe(text);
    expect(controllerCoverageGaps(started)).toEqual([{ startMs: 1000, endMs: 2000 }]);
  });
  it('records a complete declared controller window without asserting evaluation PASS', () => {
    const value = complete();
    expect(value.status).toBe('CONTROLLER_RECORDED'); expect(value.incompleteReasons).toEqual([]);
    expect(value.termination).toEqual({ ...end(), kind: 'END', reasonCode: null });
    expect(value.evaluationStatus).toBe('NOT_EVALUATED'); expect(value.canonicalWebmWindow).toBeNull();
    expect(value.clockMappingStatus).toBe('UNVERIFIED'); expect(controllerCoverageGaps(value)).toEqual([]);
  });
  it('preserves the 120000ms confirmatory proposal separately from a pilot of the same length', () => {
    expect(CONFIRMATORY_E_DURATION_MS).toBe(120_000);
    const confirmatory = createEvaluationWindow(context(), { ...plan(), purpose: 'CONFIRMATORY_PROPOSAL', durationMs: 120_000 });
    const pilot = createEvaluationWindow(context(), { ...plan(), durationMs: 120_000 });
    expect(confirmatory.plan).toEqual({ purpose: 'CONFIRMATORY_PROPOSAL', durationMs: 120_000,
      criteriaStatus: 'PROPOSED', registrationStatus: 'NOT_REGISTERED' });
    expect(pilot.plan.purpose).toBe('PILOT_PROPOSAL');
    expect(startEvaluationWindow(confirmatory, point(250.5)).scheduledEndAtMs).toBe(120250.5);
    expect(confirmatory.start).toBeNull();
  });
  it.each([0, -1, 120001, NaN, Infinity, -Infinity, -0])('rejects invalid pilot duration %s', (durationMs) => {
    expect(() => createEvaluationWindow(context(), { ...plan(), durationMs })).toThrow();
  });
  it.each([1000, 119999, 120001])('rejects confirmatory proposal duration %s', (durationMs) => {
    expect(() => createEvaluationWindow(context(), { ...plan(), purpose: 'CONFIRMATORY_PROPOSAL', durationMs })).toThrow('INVALID_CONFIRMATORY_DURATION');
  });
  it('rejects duplicate start in running and terminal states', () => {
    for (const value of [running(), complete()]) expect(() => startEvaluationWindow(value, point(1100))).toThrow('WINDOW_ALREADY_STARTED');
  });
  it('rejects end and interrupt before start', () => {
    expect(() => endEvaluationWindow(planned(), end())).toThrow('WINDOW_NOT_STARTED');
    expect(() => interruptEvaluationWindow(planned(), end(), 'SYNTHETIC_STOP')).toThrow('WINDOW_NOT_STARTED');
  });
  it.each(['END', 'INTERRUPT'] as const)('rejects every duplicate termination or restart after %s', (kind) => {
    const value = kind === 'END' ? complete() : interruptEvaluationWindow(running(), end(), 'SYNTHETIC_STOP');
    expect(() => endEvaluationWindow(value, end())).toThrow('WINDOW_ALREADY_TERMINATED');
    expect(() => interruptEvaluationWindow(value, end(), 'OTHER_STOP')).toThrow('WINDOW_ALREADY_TERMINATED');
    expect(() => startEvaluationWindow(value, point(3000))).toThrow('WINDOW_ALREADY_STARTED');
  });
});

describe('controller clock identity and ordering', () => {
  it.each([NaN, Infinity, -Infinity, -1, -0, Number.MAX_SAFE_INTEGER + 1])('rejects invalid controller time %s in all observation positions', (invalid) => {
    expect(() => startEvaluationWindow(planned(), point(invalid))).toThrow();
    expect(() => endEvaluationWindow(running(), end({ observedEndAtMs: invalid }))).toThrow();
    expect(() => endEvaluationWindow(running(), end({ callbackAtMs: invalid }))).toThrow();
    expect(() => endEvaluationWindow(running(), end({ recordedIntervals: [{ startMs: invalid, endMs: 2000 }] }))).toThrow();
    expect(() => endEvaluationWindow(running(), end({ recordedIntervals: [{ startMs: 1000, endMs: invalid }] }))).toThrow();
    expect(() => containsPlannedControllerTime(running(), point(invalid))).toThrow();
  });
  it.each([
    { observedEndAtMs: 999, callbackAtMs: 2000 },
    { observedEndAtMs: null, callbackAtMs: 999 },
    { observedEndAtMs: 2001, callbackAtMs: 2000 },
  ])('rejects reversed end/callback observations %j', (times) => {
    expect(() => endEvaluationWindow(running(), end({ ...times, recordedIntervals: [] }))).toThrow('TIME_REVERSAL');
  });
  it('accepts zero and fractional monotonic times without rounding', () => {
    const value = startEvaluationWindow(createEvaluationWindow(context(), { ...plan(), durationMs: 0.125 }), point(0));
    expect(value.scheduledEndAtMs).toBe(0.125);
    expect(containsPlannedControllerTime(value, point(0))).toBe(true);
    expect(containsPlannedControllerTime(value, point(0.125))).toBe(false);
    expect(startEvaluationWindow(planned(), point(1000.125)).start?.observedAtMs).toBe(1000.125);
  });
  it('rejects deadline overflow or a duration lost to floating point precision', () => {
    expect(() => startEvaluationWindow(planned(), point(Number.MAX_SAFE_INTEGER))).toThrow('INVALID_CONTROLLER_TIME');
    const tiny = createEvaluationWindow(context(), { ...plan(), durationMs: 0.0001 });
    expect(() => startEvaluationWindow(tiny, point(Number.MAX_SAFE_INTEGER - 1))).toThrow('INVALID_SCHEDULED_END');
  });
  it.each(['attempt', 'clock'] as const)('rejects mismatched %s even when numeric timestamps match', (field) => {
    const other = field === 'attempt' ? { ...context(), attemptId: 'attempt-2' }
      : { ...context(), clockDomain: { ...context().clockDomain, id: 'reloaded-page-2' } };
    const code = field === 'attempt' ? 'ATTEMPT_MISMATCH' : 'CLOCK_DOMAIN_MISMATCH';
    expect(() => startEvaluationWindow(planned(), { ...point(1000), ...other })).toThrow(code);
    expect(() => endEvaluationWindow(running(), { ...end(), ...other })).toThrow(code);
    expect(() => interruptEvaluationWindow(running(), { ...end(), ...other }, 'STOP')).toThrow(code);
    expect(() => containsRecordedControllerTime(complete(), { ...point(1500), ...other })).toThrow(code);
    const changed = { ...complete(), start: { ...point(1000), ...other } };
    expect(() => parseEvaluationWindow(canonicalJson(changed))).toThrow(code);
  });
  it.each([
    { kind: 'WEBM_PTS', id: 'synthetic-page-1', unit: 'ms' },
    { kind: 'CONTROLLER_MONOTONIC', id: 'synthetic-page-1', unit: 'seconds' },
    { kind: 'CONTROLLER_MONOTONIC', unit: 'ms' },
  ])('rejects unsupported or incomplete clock domain %j', (clockDomain) => {
    const other = { ...context(), clockDomain } as EvaluationWindowContext;
    expect(() => createEvaluationWindow(other, plan())).toThrow();
    expect(() => startEvaluationWindow(planned(), { ...point(1000), ...other })).toThrow();
    expect(() => endEvaluationWindow(running(), { ...end(), ...other })).toThrow();
    expect(() => validateEvaluationWindow({ ...complete(), clockDomain })).toThrow();
  });
});

describe('actual observation, deadline, callback and missing coverage', () => {
  it('keeps early end INCOMPLETE and preserves the unobserved scheduled tail', () => {
    const value = endEvaluationWindow(running(), end({ observedEndAtMs: 1500, callbackAtMs: 1500,
      recordedIntervals: [{ startMs: 1000, endMs: 1500 }] }));
    expect(value.status).toBe('INCOMPLETE'); expect(value.scheduledEndAtMs).toBe(2000);
    expect(value.incompleteReasons).toEqual(['ENDED_EARLY', 'RECORDING_GAPS']);
    expect(controllerCoverageGaps(value)).toEqual([{ startMs: 1500, endMs: 2000 }]);
  });
  it('does not substitute callback or deadline for an absent actual end observation', () => {
    const value = endEvaluationWindow(running(), end({ observedEndAtMs: null, callbackAtMs: 2250 }));
    expect(value.status).toBe('INCOMPLETE'); expect(value.incompleteReasons).toEqual(['END_OBSERVATION_MISSING']);
    expect(value.termination?.observedEndAtMs).toBeNull();
    expect(value.termination?.callbackAtMs).toBe(2250); expect(value.scheduledEndAtMs).toBe(2000);
  });
  it.each([1500, 2000, 2300])('always keeps interruption at %s INCOMPLETE with its reason', (time) => {
    const value = interruptEvaluationWindow(running(), end({ observedEndAtMs: time, callbackAtMs: time,
      recordedIntervals: [{ startMs: 1000, endMs: time }] }), 'SYNTHETIC_INTERRUPTION');
    expect(value.status).toBe('INCOMPLETE'); expect(value.incompleteReasons).toContain('INTERRUPTED');
    expect(value.termination?.reasonCode).toBe('SYNTHETIC_INTERRUPTION');
    expect(value.scheduledEndAtMs).toBe(2000);
  });
  it('requires an explicit interruption reason', () => {
    expect(() => interruptEvaluationWindow(running(), end(), '')).toThrow('INVALID_REASON');
  });
  it('accepts delayed callback without extending the planned E window', () => {
    const value = endEvaluationWindow(running(), end({ callbackAtMs: 2500 }));
    expect(value.status).toBe('CONTROLLER_RECORDED'); expect(value.scheduledEndAtMs).toBe(2000);
    expect(value.termination).toMatchObject({ observedEndAtMs: 2000, callbackAtMs: 2500 });
    expect(containsPlannedControllerTime(value, point(2200))).toBe(false);
  });
  it('preserves late actual observation and recording tails without turning them into E', () => {
    const spans = [{ startMs: 500, endMs: 2200 }];
    const value = endEvaluationWindow(running(), end({ observedEndAtMs: 2200, callbackAtMs: 2500, recordedIntervals: spans }));
    expect(value.status).toBe('CONTROLLER_RECORDED'); expect(value.termination?.recordedIntervals).toEqual(spans);
    expect(value.termination).toMatchObject({ observedEndAtMs: 2200, callbackAtMs: 2500 });
    expect(value.scheduledEndAtMs).toBe(2000); expect(controllerCoverageGaps(value)).toEqual([]);
    expect(containsRecordedControllerTime(value, point(750))).toBe(false);
    expect(containsRecordedControllerTime(value, point(2100))).toBe(false);
  });
  it('does not let a late callback hide an early actual end', () => {
    const value = endEvaluationWindow(running(), end({ observedEndAtMs: 1500, callbackAtMs: 2500,
      recordedIntervals: [{ startMs: 1000, endMs: 1500 }] }));
    expect(value.incompleteReasons).toEqual(['ENDED_EARLY', 'RECORDING_GAPS']);
  });
  it('never infers continuous coverage from start/end endpoints alone', () => {
    const value = endEvaluationWindow(running(), end({ recordedIntervals: [] }));
    expect(value.status).toBe('INCOMPLETE'); expect(value.incompleteReasons).toEqual(['RECORDING_GAPS']);
    expect(controllerCoverageGaps(value)).toEqual([{ startMs: 1000, endMs: 2000 }]);
    expect(containsRecordedControllerTime(value, point(1500))).toBe(false);
    expect(containsPlannedControllerTime(value, point(1500))).toBe(true);
  });
  it('preserves head, interior and tail gaps including sub-millisecond gaps', () => {
    const value = endEvaluationWindow(running(), end({ recordedIntervals: [
      { startMs: 1100, endMs: 1400 }, { startMs: 1400.001, endMs: 1900 },
    ] }));
    expect(value.status).toBe('INCOMPLETE');
    expect(controllerCoverageGaps(value)).toEqual([
      { startMs: 1000, endMs: 1100 }, { startMs: 1400, endMs: 1400.001 }, { startMs: 1900, endMs: 2000 },
    ]);
  });
  it('accepts adjacent spans but preserves each original span', () => {
    const recordedIntervals = [{ startMs: 1000, endMs: 1500 }, { startMs: 1500, endMs: 2000 }];
    const value = endEvaluationWindow(running(), end({ recordedIntervals }));
    expect(value.status).toBe('CONTROLLER_RECORDED'); expect(controllerCoverageGaps(value)).toEqual([]);
    expect(value.termination?.recordedIntervals).toEqual(recordedIntervals);
  });
  it.each([
    [{ startMs: 1500, endMs: 2000 }, { startMs: 1000, endMs: 1500 }],
    [{ startMs: 1000, endMs: 1600 }, { startMs: 1500, endMs: 2000 }],
    [{ startMs: 1000, endMs: 2000 }, { startMs: 1000, endMs: 2000 }],
    [{ startMs: 1500, endMs: 1400 }], [{ startMs: 1500, endMs: 1500 }],
  ])('rejects reversed, overlapping, duplicate or empty ranges: %j', (...recordedIntervals) => {
    expect(() => endEvaluationWindow(running(), end({ recordedIntervals }))).toThrow();
  });
  it('rejects evidence beyond the actual observation or callback without clipping it', () => {
    expect(() => endEvaluationWindow(running(), end({ observedEndAtMs: 1500 }))).toThrow('INTERVAL_AFTER_OBSERVATION');
    expect(() => endEvaluationWindow(running(), end({ observedEndAtMs: null, callbackAtMs: 1500 }))).toThrow('INTERVAL_AFTER_OBSERVATION');
  });
  it('does not count evidence wholly before/after E as covering E', () => {
    const value = endEvaluationWindow(running(), end({ observedEndAtMs: 3000, callbackAtMs: 3000,
      recordedIntervals: [{ startMs: 0, endMs: 1000 }, { startMs: 2000, endMs: 3000 }] }));
    expect(controllerCoverageGaps(value)).toEqual([{ startMs: 1000, endMs: 2000 }]);
    expect(value.status).toBe('INCOMPLETE');
  });
});

describe('half-open controller membership', () => {
  it.each([[999, false], [1000, true], [1500, true], [1999.999, true], [2000, false], [2001, false]] as const)(
    'membership at %s is %s', (time, expected) => {
      expect(containsPlannedControllerTime(complete(), point(time))).toBe(expected);
      expect(containsRecordedControllerTime(complete(), point(time))).toBe(expected);
    });
  it('excludes missing spans and includes the next recorded span start', () => {
    const value = endEvaluationWindow(running(), end({ recordedIntervals: [{ startMs: 1000, endMs: 1400 }, { startMs: 1600, endMs: 2000 }] }));
    for (const time of [1400, 1500, 1599.999]) {
      expect(containsPlannedControllerTime(value, point(time))).toBe(true);
      expect(containsRecordedControllerTime(value, point(time))).toBe(false);
    }
    expect(containsRecordedControllerTime(value, point(1600))).toBe(true);
  });
  it('does not expose unstarted or unterminated data as recorded coverage', () => {
    expect(controllerCoverageGaps(planned())).toBeNull();
    expect(() => containsPlannedControllerTime(planned(), point(1000))).toThrow('WINDOW_NOT_STARTED');
    expect(() => containsRecordedControllerTime(planned(), point(1000))).toThrow('WINDOW_NOT_STARTED');
    expect(containsPlannedControllerTime(running(), point(1000))).toBe(true);
    expect(containsRecordedControllerTime(running(), point(1000))).toBe(false);
  });
});

describe('strict deterministic serialization and isolation', () => {
  it.each(['PLANNED', 'RUNNING', 'CONTROLLER_RECORDED', 'INCOMPLETE'] as const)('round-trips %s deterministically', (status) => {
    const value = status === 'PLANNED' ? planned() : status === 'RUNNING' ? running() : status === 'CONTROLLER_RECORDED' ? complete()
      : interruptEvaluationWindow(running(), end({ observedEndAtMs: null, recordedIntervals: [] }), 'SYNTHETIC_STOP');
    const text = serializeEvaluationWindow(value);
    expect(parseEvaluationWindow(text)).toEqual(value);
    expect(serializeEvaluationWindow(parseEvaluationWindow(text))).toBe(text);
    const reordered = Object.fromEntries(Object.entries(value).reverse()) as unknown as EvaluationWindow;
    expect(serializeEvaluationWindow(reordered)).toBe(text);
  });
  it.each(['PASS', 'FAIL', 'COMPLETE'])('rejects fabricated evaluation status %s even with full declared coverage', (evaluationStatus) => {
    for (const value of [planned(), running(), complete(), endEvaluationWindow(running(), end({ recordedIntervals: [] }))]) {
      expect(() => validateEvaluationWindow({ ...value, evaluationStatus })).toThrow('EVALUATION_NOT_SUPPORTED');
    }
  });
  it.each(['no-start', 'no-end', 'early', 'gap', 'interrupt'])('rejects fabricated complete controller status for %s', (kind) => {
    const value = kind === 'no-start' ? planned() : kind === 'no-end' ? running() : kind === 'early'
      ? endEvaluationWindow(running(), end({ observedEndAtMs: 1500, recordedIntervals: [] })) : kind === 'gap'
        ? endEvaluationWindow(running(), end({ recordedIntervals: [] })) : interruptEvaluationWindow(running(), end(), 'STOP');
    const forged = { ...value, status: 'CONTROLLER_RECORDED', incompleteReasons: [] };
    expect(() => parseEvaluationWindow(canonicalJson(forged))).toThrow('WINDOW_STATUS_MISMATCH');
  });
  it.each(['schema', 'extra', 'omission', 'schedule', 'clock-mapping', 'pts', 'approval', 'registration', 'reason', 'nested-extra'])('rejects %s corruption without repairing it', (kind) => {
    const value = JSON.parse(serializeEvaluationWindow(complete()));
    if (kind === 'schema') value.schemaVersion = 2;
    if (kind === 'extra') value.poseFrames = [];
    if (kind === 'omission') delete value.clockDomain;
    if (kind === 'schedule') value.scheduledEndAtMs = 2500;
    if (kind === 'clock-mapping') value.clockMappingStatus = 'VERIFIED';
    if (kind === 'pts') value.canonicalWebmWindow = { start: 1000, end: 2000 };
    if (kind === 'approval') value.plan.criteriaStatus = 'APPROVED';
    if (kind === 'registration') value.plan.registrationStatus = 'REGISTERED';
    if (kind === 'reason') value.termination.reasonCode = 'HIDDEN_FAILURE';
    if (kind === 'nested-extra') value.termination.recordedIntervals[0].mediaPts = 1000;
    const before = canonicalJson(value);
    expect(() => validateEvaluationWindow(value)).toThrow();
    expect(canonicalJson(value)).toBe(before);
  });
  it('rejects invalid/noncanonical JSON and duplicate keys', () => {
    const text = serializeEvaluationWindow(complete());
    expect(() => parseEvaluationWindow('{broken')).toThrow('INVALID_JSON');
    expect(() => parseEvaluationWindow(text + '\n')).toThrow('NON_CANONICAL_JSON');
    expect(() => parseEvaluationWindow(text.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'))).toThrow('NON_CANONICAL_JSON');
    expect(() => parseEvaluationWindow(JSON.stringify(complete(), null, 2))).toThrow('NON_CANONICAL_JSON');
  });
  it('rejects unknown fields at API boundaries instead of silently dropping them', () => {
    expect(() => createEvaluationWindow({ ...context(), camera: true } as EvaluationWindowContext, plan())).toThrow('UNEXPECTED_FIELDS');
    expect(() => startEvaluationWindow(planned(), { ...point(1000), resetDetector: true } as ControllerObservation)).toThrow('UNEXPECTED_FIELDS');
    expect(() => endEvaluationWindow(running(), { ...end(), mediaPts: 2000 } as EvaluationWindowEndObservation)).toThrow('UNEXPECTED_FIELDS');
  });
  it('detaches and freezes state and nested coverage without freezing caller objects', () => {
    const ctx = context(), proposal = plan(), start = point(1000), observation = end();
    const original = createEvaluationWindow(ctx, proposal), started = startEvaluationWindow(original, start);
    const result = endEvaluationWindow(started, observation), text = serializeEvaluationWindow(result);
    expect(Object.isFrozen(ctx)).toBe(false); expect(Object.isFrozen(observation.recordedIntervals)).toBe(false);
    Object.assign(ctx.clockDomain, { id: 'mutated' }); Object.assign(proposal, { durationMs: 900 });
    Object.assign(start, { observedAtMs: 50 }); Object.assign(observation.recordedIntervals[0], { endMs: 1500 });
    expect(serializeEvaluationWindow(result)).toBe(text);
    expect(original.status).toBe('PLANNED'); expect(started.status).toBe('RUNNING');
    expect(Object.isFrozen(result.start)).toBe(true); expect(Object.isFrozen(result.termination?.recordedIntervals[0])).toBe(true);
    expect(Object.isFrozen(controllerCoverageGaps(started))).toBe(true);
    expect(() => { Object.assign(result.plan, { durationMs: 2 }); }).toThrow();
  });
  it('rejects accessors without evaluating them', () => {
    const getter = vi.fn(() => 1000), observation = Object.defineProperty({ ...context() }, 'observedAtMs', { enumerable: true, get: getter });
    expect(() => startEvaluationWindow(planned(), observation as ControllerObservation)).toThrow('NON_JSON_OBJECT');
    expect(getter).not.toHaveBeenCalled();
  });
  it('keeps the existing ledger hash chain and manifest E_WINDOW_MISSING untouched', async () => {
    const ledger = await ledgerAt('START_REQUESTED'), before = await serializePilotLedger(ledger);
    const manifest = createPilotManifest(currentAttempts(ledger)[0]), manifestBefore = serializePilotManifest(manifest);
    const value = parseEvaluationWindow(serializeEvaluationWindow(complete()));
    expect(value.attemptId).toBe(manifest.attemptId); expect(value.status).toBe('CONTROLLER_RECORDED');
    expect(await serializePilotLedger(await validatePilotLedger(ledger))).toBe(before);
    expect(serializePilotManifest(manifest)).toBe(manifestBefore);
    expect(manifest.evaluationWindow).toEqual({ status: 'MISSING' }); expect(manifest.incompleteReasons).toContain('E_WINDOW_MISSING');
    expect(() => validatePilotManifest({ ...manifest, evaluationWindow: value })).toThrow();
    expect(manifest.evaluationStatus).toBe('NOT_EVALUATED');
  });
});
