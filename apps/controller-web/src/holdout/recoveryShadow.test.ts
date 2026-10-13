// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KneeKickDetectorV3, Y_KICK_V3_CONFIG } from '../pose/kick/kneeKickDetectorV3';
import { createDisabledRecoveryMirror, createRecoveryDetector, RECOVERY_POLICIES, recoveryImplementationProof, transformRecoverySource } from './recoveryShadowFactory';
import { evaluateRecoverySynthetic, RECOVERY_SYNTHETIC_CASES, runSyntheticOperations, SYNTHETIC_BASELINE, syntheticFeatures } from './recoverySynthetic';

describe('hash-pinned two-branch shadow, never a production replacement', () => {
  it('uses the actual production class for CONTROL, preserves config and rejects source drift', () => {
    expect(createRecoveryDetector('CONTROL')).toBeInstanceOf(KneeKickDetectorV3);
    expect(RECOVERY_POLICIES).toEqual(['CONTROL', 'S1', 'S2', 'S1+S2']);
    const proof = recoveryImplementationProof(); expect(proof.config).toEqual(Y_KICK_V3_CONFIG);
    expect(proof.substitutions.map((p) => p.id)).toEqual(['CONSTRUCTOR_FLAGS', 'S1_FRESH_REACQUISITION_ENTRY', 'S2_JOINT_RETURN_CLEAR']);
    const source = readFileSync(new URL('../pose/kick/kneeKickDetectorV3.ts', import.meta.url), 'utf8');
    expect(() => transformRecoverySource(source + '\n')).toThrow('source changed');
  });
  it('matches every event, diagnostic, view and reset for the disabled mirror across all fixed synthetic cases', () => {
    for (const test of RECOVERY_SYNTHETIC_CASES) expect(runSyntheticOperations(createDisabledRecoveryMirror(), test.operations))
      .toEqual(runSyntheticOperations(new KneeKickDetectorV3(), test.operations));
  });
  it('matches the disabled mirror on deterministic irregular, missing, tied and reordered inputs', () => {
    const a = new KneeKickDetectorV3(), b = createDisabledRecoveryMirror();
    a.setBaseline(SYNTHETIC_BASELINE); b.setBaseline(SYNTHETIC_BASELINE);
    let seed = 12345, now = 0;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    const values = [0, .2, .25, .399, .4, .6, 1.2, null, NaN];
    for (let i = 0; i < 2000; i++) {
      now += [0, -1, 17, 33, 50, 400][next() % 6];
      const f = syntheticFeatures(values[next() % values.length], values[next() % values.length]);
      expect(a.processFrame(f, now)).toEqual(b.processFrame(f, now));
      expect(a.getValuesForDiagnostics()).toEqual(b.getValuesForDiagnostics());
      expect(a.getView(now + 401)).toEqual(b.getView(now + 401));
      if (i % 127 === 0) { a.restartTrial(); b.restartTrial(); }
      if (i % 213 === 0) { a.reset(); b.reset(); a.setBaseline(SYNTHETIC_BASELINE); b.setBaseline(SYNTHETIC_BASELINE); }
      expect(a.getReplaySnapshot()).toEqual(b.getReplaySnapshot());
    }
  });
});

describe.each(RECOVERY_POLICIES)('%s synthetic mechanism correctness vs feasibility risk', (policy) => {
  const observed = () => evaluateRecoverySynthetic(policy);
  it('preserves missingness, epochs, no duplicates, temporal order, reset, clear boundaries and causality', () => {
    const result = observed();
    for (const test of result.cases.filter((c) => !['SUSTAINED_REACQUISITION_JUMP', 'CONSECUTIVE_KICKS_WITH_UNCLEARED_OPPONENT'].includes(c.id))) {
      expect(test.status, test.id).toBe('PASS'); expect(test.violations, test.id).toEqual([]);
    }
    expect(result.causality.status).toBe('PASS'); expect(result.independentRecognitionEvidence).toBe(false);
  });
  it('reports, rather than hides, the sustained-jump false risk from S1', () => {
    const test = observed().cases.find((c) => c.id === 'SUSTAINED_REACQUISITION_JUMP')!;
    const s1 = policy === 'S1' || policy === 'S1+S2';
    expect(test.status).toBe(s1 ? 'FAIL' : 'PASS'); expect(test.events).toHaveLength(s1 ? 1 : 0);
    if (s1) expect(test.events[0]).toMatchObject({ timestamp: 126, candidateStartedAt: 76, confirmationLatencyMs: 50, crossGapConfirmation: false, evidenceEpoch: 1 });
  });
  it('reports the consecutive-kick availability cost from S2 without changing expected motion labels', () => {
    const test = observed().cases.find((c) => c.id === 'CONSECUTIVE_KICKS_WITH_UNCLEARED_OPPONENT')!;
    const s2 = policy === 'S2' || policy === 'S1+S2';
    expect(test.status).toBe(s2 ? 'FAIL' : 'PASS'); expect(test.events.map((e) => e.direction)).toEqual(s2 ? ['KNEE_LEFT'] : ['KNEE_LEFT', 'KNEE_RIGHT']);
  });
});

it('S1 uses only a fresh post-loss run; it does not pretend the Neutral tracking clear gate was satisfied', () => {
  const d = createRecoveryDetector('S1'); d.setBaseline(SYNTHETIC_BASELINE);
  for (const [t, value] of [[0, .8], [30, .8], [31, null], [64, null], [97, .8], [127, .8], [146, .8]] as const)
    expect(d.processFrame(syntheticFeatures(value), t)).toBeNull();
  expect(d.getValuesForDiagnostics()).toMatchObject({ leftTrackingState: 'REACQUIRED_NOT_READY', leftEnterRunMs: 49 });
  expect(d.processFrame(syntheticFeatures(.8), 147)).toMatchObject({ candidateStartedAt: 97, confirmationLatencyMs: 50, evidenceEpoch: 1, currentEpoch: 1 });
});

it.each(RECOVERY_POLICIES)('%s cannot carry return-clear dwell across a 400ms gap', (policy) => {
  const d = createRecoveryDetector(policy); d.setBaseline(SYNTHETIC_BASELINE);
  d.processFrame(syntheticFeatures(.8), 0); expect(d.processFrame(syntheticFeatures(.8), 50)).not.toBeNull();
  for (const t of [75, 150, 550, 649]) {
    expect(d.processFrame(syntheticFeatures(), t)).toBeNull(); expect(d.getStateForDiagnostics()).toBe('WAIT_RETURN');
  }
  d.processFrame(syntheticFeatures(), 650); expect(d.getStateForDiagnostics()).toBe('ARMED');
  d.processFrame(syntheticFeatures(0, .6), 675);
  expect(d.processFrame(syntheticFeatures(0, .6), 725)).toMatchObject({ id: 2, direction: 'KNEE_RIGHT', candidateStartedAt: 675, crossGapConfirmation: false });
});
