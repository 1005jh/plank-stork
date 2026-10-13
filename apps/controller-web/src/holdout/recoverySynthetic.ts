import { isDeepStrictEqual } from 'node:util';
import { extractKneeMotionFeatures, type KneeMotionFeatures } from '../pose/motion/kneeMotionFeatures';
import { type KneeKickBaselineV3, type KneeKickEventV3, type KneeKickDetectorV3 } from '../pose/kick/kneeKickDetectorV3';
import { createRecoveryDetector, type RecoveryPolicy } from './recoveryShadowFactory';

export const SYNTHETIC_BASELINE: KneeKickBaselineV3 = { version: 3, bodyScale: 1,
  leftXMedian: 0, rightXMedian: 0, leftYMedian: 0, rightYMedian: 0, leftDistanceMedian: 1, rightDistanceMedian: 1 };
export function syntheticFeatures(left: number | null = 0, right: number | null = 0): KneeMotionFeatures {
  return { ...extractKneeMotionFeatures([]), hipCenterX: 0, hipCenterY: 0, hipWidth: 1,
    leftHipVisibility: 1, rightHipVisibility: 1, leftKneeVisibility: 1, rightKneeVisibility: 1,
    leftKneeX: -.5, rightKneeX: .5, leftKneeY: left, rightKneeY: right,
    leftKneeCenterOffsetY: left, rightKneeCenterOffsetY: right, leftKneeCenterOffsetX: -.5, rightKneeCenterOffsetX: .5 };
}
export type SyntheticOperation = { kind: 'FRAME'; timestamp: number; features: KneeMotionFeatures } |
  { kind: 'RESET' } | { kind: 'BASELINE'; baseline: KneeKickBaselineV3 | null };
const f = (timestamp: number, left: number | null = 0, right: number | null = 0): SyntheticOperation => ({ kind: 'FRAME', timestamp, features: syntheticFeatures(left, right) });

export function runSyntheticOperations(detector: KneeKickDetectorV3, operations: readonly SyntheticOperation[]) {
  detector.setBaseline(SYNTHETIC_BASELINE);
  let lastAcceptedAt: number | null = null;
  const events: KneeKickEventV3[] = [], violations: string[] = [];
  const trace = operations.map((op, index) => {
    const before = detector.getValuesForDiagnostics(); let event: KneeKickEventV3 | null = null;
    if (op.kind === 'RESET') { detector.reset(); lastAcceptedAt = null; }
    else if (op.kind === 'BASELINE') { detector.setBaseline(op.baseline); lastAcceptedAt = null; }
    else {
      const invalidTime = !Number.isFinite(op.timestamp) || lastAcceptedAt !== null && op.timestamp <= lastAcceptedAt;
      event = detector.processFrame(op.features, op.timestamp);
      if (invalidTime && (!isDeepStrictEqual(before, detector.getValuesForDiagnostics()) || event)) violations.push(`INVALID_TIME_MUTATED_AT_${index}`);
      if (!invalidTime) lastAcceptedAt = op.timestamp;
      if (event) {
        events.push(event);
        if (event.crossGapConfirmation || event.evidenceEpoch !== event.currentEpoch) violations.push(`CROSS_GAP_AT_${index}`);
        if (event.confirmationLatencyMs < 50) violations.push(`SHORT_DWELL_AT_${index}`);
      }
    }
    const diagnostics = detector.getValuesForDiagnostics();
    if (Object.values(diagnostics).some((v) => typeof v === 'number' && !Number.isFinite(v))) violations.push(`NON_FINITE_DIAGNOSTIC_AT_${index}`);
    return { index, kind: op.kind, timestamp: op.kind === 'FRAME' && Number.isFinite(op.timestamp) ? op.timestamp : null,
      timestampValid: op.kind === 'FRAME' ? Number.isFinite(op.timestamp) : null, event, ...diagnostics };
  });
  return { events, violations, trace, finalState: detector.getStateForDiagnostics(), snapshot: detector.getReplaySnapshot() };
}
type Observation = ReturnType<typeof runSyntheticOperations>;
type SyntheticCase = { id: string; kind: 'SAFETY' | 'AVAILABILITY' | 'POLICY_CONFORMANCE'; expectation: string;
  operations: SyntheticOperation[]; check: (result: Observation, policy: RecoveryPolicy) => boolean };
const noEvents = (r: Observation) => r.events.length === 0;
const recovered = [f(0), f(10, null), f(43, null), f(76, 1.2)];
const bilateral = (p: RecoveryPolicy) => p === 'S2' || p === 'S1+S2';

/** Fixed before any capture-policy results. Amplitudes describe test fixtures, never a sweep.
 * The jump and interrupted-return controls intentionally can FAIL a policy's feasibility.
 * Do not change those expectations to make a permitted policy mechanism look safe.
 */
export const RECOVERY_SYNTHETIC_CASES: readonly SyntheticCase[] = [
  { id: 'SHORT_REACQUISITION_SPIKE', kind: 'SAFETY', expectation: 'No event for a 33ms post-loss spike.',
    operations: [...recovered, f(109, 1.2), f(110), f(210)], check: noEvents },
  { id: 'SUSTAINED_REACQUISITION_JUMP', kind: 'SAFETY', expectation: 'No false event for a stable synthetic tracking jump after loss; no physical kick was supplied.',
    operations: [...recovered, f(101, 1.2), f(126, 1.2), f(151, 1.2), f(300, 1.2)], check: noEvents },
  { id: 'POSE_LOSS_NO_EVENT', kind: 'SAFETY', expectation: 'A prior 30ms candidate cannot emit during missing pose.',
    operations: [f(0, .8), f(30, .8), ...[31, 64, 100, 300, 700].map((t) => ({ kind: 'FRAME' as const, timestamp: t, features: extractKneeMotionFeatures([]) }))], check: noEvents },
  { id: 'LOSS_EPOCH_ISOLATION', kind: 'SAFETY', expectation: 'No event before a new 50ms post-loss run; event epoch and candidate must start after recovery.',
    operations: [f(0, .8), f(30, .8), f(31, null), f(64, null), f(97, .8), f(127, .8), f(146, .8), f(147, .8)],
    check: (r) => r.events.every((e) => e.timestamp === 147 && e.candidateStartedAt === 97 && e.confirmationLatencyMs === 50 && e.evidenceEpoch === 1) },
  { id: 'GAP_EPOCH_ISOLATION', kind: 'SAFETY', expectation: '400ms frame gap discards the old dwell/integrated evidence; fresh run starts at 430ms.',
    operations: [f(0, .8), f(30, .8), f(430, .8), f(460, .8), f(479, .8), f(480, .8)],
    check: (r) => r.events.every((e) => e.timestamp === 480 && e.candidateStartedAt === 430 && e.confirmationLatencyMs === 50 &&
      e.evidenceEpoch === 1 && Math.abs(e.integratedEvidence - .02) < 1e-12) },
  { id: 'MISSING_NAN_SAFETY', kind: 'SAFETY', expectation: 'Missing/NaN knees, hips or visibility do not become high-Y evidence.',
    operations: [f(0), f(10, null, null), f(43, NaN, NaN), f(100, NaN, NaN),
      { kind: 'FRAME', timestamp: 150, features: { ...syntheticFeatures(.9, .9), hipCenterY: NaN } },
      { kind: 'FRAME', timestamp: 200, features: { ...syntheticFeatures(.9, .9), leftHipVisibility: NaN } },
      { kind: 'FRAME', timestamp: 250, features: { ...syntheticFeatures(.9, .9), leftKneeVisibility: NaN, rightKneeVisibility: NaN } }], check: noEvents },
  { id: 'LONG_HOLD_NO_DUPLICATE', kind: 'SAFETY', expectation: 'A long hold and uncleared .30 tail yield exactly one event.',
    operations: Array.from({ length: 101 }, (_, i) => f(i * 25, i < 70 ? .8 : .3)), check: (r) => r.events.length === 1 },
  { id: 'NON_MONOTONIC_TIME_NO_MUTATION', kind: 'SAFETY', expectation: 'Repeated, retrograde, NaN and infinite timestamps neither mutate state nor create an event.',
    operations: [f(0, .8), f(30, .8), f(30, null, null), f(20, null, null), f(NaN, null, null), f(Infinity, null, null), f(50, .8)],
    check: (r) => r.events.length === 1 && r.events[0].timestamp === 50 },
  { id: 'RESET_RECALIBRATION', kind: 'SAFETY', expectation: 'Reset clears pending runs/baseline; new baseline cancels old evidence and IDs start anew.',
    operations: [f(0, .8), f(30, .8), { kind: 'RESET' }, f(50, .8),
      { kind: 'BASELINE', baseline: SYNTHETIC_BASELINE }, f(60, .8), f(90, .8),
      { kind: 'BASELINE', baseline: { ...SYNTHETIC_BASELINE, leftYMedian: .8 } }, f(100, .8), f(120, 1.4), f(170, 1.4)],
    check: (r) => r.trace[2].state === 'NOT_READY' && r.trace[3].event === null && r.events.length === 1 &&
      r.events[0].id === 1 && r.events[0].candidateStartedAt === 120 && r.events[0].timestamp === 170 && r.events[0].evidenceEpoch === 0 },
  { id: 'BILATERAL_CLEAR_BOUNDARY', kind: 'POLICY_CONFORMANCE', expectation: 'S2 requires joint clear for the full 100ms, then can detect the next kick; CONTROL retains its original unilateral rule.',
    operations: [f(0, .8, .3), f(50, .8, .3), f(75, 0, .3), f(175, 0, .3), f(200), f(299), f(300), f(325, 0, .6), f(375, 0, .6)],
    check: (r, p) => r.trace[3].state === (bilateral(p) ? 'WAIT_RETURN' : 'ARMED') &&
      r.trace[5].state === (bilateral(p) ? 'WAIT_RETURN' : 'ARMED') && r.trace[6].state === 'ARMED' && r.events.length === 2 },
  { id: 'CONSECUTIVE_KICKS_WITH_BOTH_CLEAR', kind: 'AVAILABILITY', expectation: 'Preserve LEFT, RIGHT, LEFT when each return has 100ms of bilateral clear.',
    operations: [f(0, .6), f(50, .6), f(75), f(175), f(200, 0, .6), f(250, 0, .6), f(275), f(375), f(400, .6), f(450, .6)],
    check: (r) => r.events.map((e) => e.direction).join(',') === 'KNEE_LEFT,KNEE_RIGHT,KNEE_LEFT' },
  { id: 'CONSECUTIVE_KICKS_WITH_UNCLEARED_OPPONENT', kind: 'AVAILABILITY', expectation: 'Detect the next true RIGHT pulse despite an opposite .30 return tail; exposes bilateral rearming cost.',
    operations: [f(0, .6, .3), f(50, .6, .3), f(100, 0, .3), f(200, 0, .3), f(225, 0, .6), f(275, 0, .6)],
    check: (r) => r.events.map((e) => e.direction).join(',') === 'KNEE_LEFT,KNEE_RIGHT' },
];

export function evaluateRecoverySynthetic(policy: RecoveryPolicy) {
  const cases = RECOVERY_SYNTHETIC_CASES.map((test) => {
    const result = runSyntheticOperations(createRecoveryDetector(policy), test.operations);
    return { id: test.id, kind: test.kind, expectation: test.expectation,
      status: result.violations.length === 0 && test.check(result, policy) ? 'PASS' as const : 'FAIL' as const, ...result };
  });
  // A detector receives one current feature vector at a time, never labels or frame arrays.
  const operations = RECOVERY_SYNTHETIC_CASES.flatMap((t) => [{ kind: 'RESET' as const }, { kind: 'BASELINE' as const, baseline: SYNTHETIC_BASELINE }, ...t.operations]);
  const complete = runSyntheticOperations(createRecoveryDetector(policy), operations);
  const prefixes = [1, 7, 19, 43, operations.length - 3];
  const causal = prefixes.every((n) => isDeepStrictEqual(runSyntheticOperations(createRecoveryDetector(policy), operations.slice(0, n)).trace, complete.trace.slice(0, n)));
  return { policy, status: cases.every((c) => c.status === 'PASS') && causal ? 'PASS' as const : 'FAIL' as const,
    independentRecognitionEvidence: false, cases,
    causality: { id: 'PREFIX_CAUSALITY', prefixesChecked: prefixes, status: causal ? 'PASS' as const : 'FAIL' as const } };
}
