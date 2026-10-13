// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readyCapture } from '../replay/v2TestFixtures';
import { readReplaySession } from '../replay/readReplaySession';
import type { ReplaySession } from '../replay/replayTypes';
import { assessRecoveryPolicy, createRecoveryPolicyReport, replayRecoveryPolicy, summarizeRecoveryFeasibility } from './recoveryPolicyAnalysis';
import { RECOVERY_POLICIES } from './recoveryShadowFactory';

let session: ReplaySession;
beforeAll(async () => {
  const c = readyCapture(); c.kick.startTest(3101); c.capture.observe({ kind: 'START', timestamp: 3101 }, c.read);
  for (let t = 3150; t <= 26000; t += 50) c.frame(t, t === 9000 || t === 9050);
  await c.capture.stop(26050); session = readReplaySession(c.capture.getFiles().json);
});
describe('analysis-only complete-stream scoring', () => {
  it('reproduces existing CONTROL and its disabled mirror, including actual clock reads and all missing frames', () => {
    const s = structuredClone(session); s.clockSamples.push({ tMs: 9040, order: 90000, trialId: 1 });
    const result = replayRecoveryPolicy(s, s.poseFrames, 'CONTROL', true);
    expect(result.replayParity).toMatchObject({ status: 'PASS' });
    expect(result.disabledMirrorParity).toMatchObject({ status: 'PASS', frames: result.processedFrames, clocks: 1 });
    expect(result.sourceFrameCount).toBe(s.poseFrames.length);
    expect(result.processedFrames + result.setupFramesNotFedToTrialReset).toBe(s.poseFrames.length);
    expect(result.trace.filter((r) => !r.posePresent)).toHaveLength(2);
    expect(result.frameRemovalOrInterpolation).toBe(false);
  });
  it('processes post-Guided kicks without adding them to false/recall scores for any policy', () => {
    const s = structuredClone(session);
    for (const f of s.poseFrames) if (f.tMs >= 25300 && f.tMs < 25800) f.landmarks[25].y += .5;
    for (const policy of RECOVERY_POLICIES) {
      const r = replayRecoveryPolicy(s, s.poseFrames, policy, true);
      expect(r.events).toEqual([]); expect(r.counts.falseEvents).toBe(0);
      expect(r.postGuided.includedInScoring).toBe(false); expect(r.postGuided.events).toHaveLength(1);
      expect(r.postGuided.events[0].direction).toBe('KNEE_LEFT');
      expect(r.trace.filter((t) => t.event)).toHaveLength(1);
    }
  });
  it('keeps the source/config unchanged and produces a deterministic four-policy report', () => {
    const before = structuredClone(session), report = createRecoveryPolicyReport(session, session.poseFrames);
    expect(report.policies.map((r) => r.policy)).toEqual(RECOVERY_POLICIES);
    expect(report).toEqual(createRecoveryPolicyReport(session, session.poseFrames)); expect(session).toEqual(before);
    expect(report.baseline).toEqual(session.liveResult.trials[0].baselineV3);
    for (const p of report.policies) {
      expect(p.live.trace.map((r) => r.timestamp)).toEqual(report.policies[0].live.trace.map((r) => r.timestamp));
      expect(p.live.clocksProcessed).toBe(report.policies[0].live.clocksProcessed);
    }
  });
  it('rejects an invalid baseline, duplicate PTS or missing Guided markers rather than inventing replacements', () => {
    const noBaseline = structuredClone(session); noBaseline.liveResult.trials[0].baselineV3 = null;
    expect(() => replayRecoveryPolicy(noBaseline, noBaseline.poseFrames, 'CONTROL', true)).toThrow('baseline required');
    const duplicate = structuredClone(session.poseFrames); duplicate[1].tMs = duplicate[0].tMs;
    expect(() => replayRecoveryPolicy(session, duplicate, 'S1', true)).toThrow('Invalid source timeline');
    const noMarkers = structuredClone(session); noMarkers.markers = noMarkers.markers.filter((m) => m.type !== 'GUIDED_STAGE_CHANGE');
    expect(() => replayRecoveryPolicy(noMarkers, noMarkers.poseFrames, 'S2', true)).toThrow('Guided markers required');
  });
});

describe('feasibility requires both capture goals AND all safety controls', () => {
  const clean = { counts: { leftDetected: 1, rightDetected: 1, falseEvents: 0, wrongDirection: 0, duplicates: 0, crossGapConfirmations: 0, reacquisitionFalseEvents: 0 } };
  it('does not promote a recovered capture with failed synthetic negatives or a single improved symptom', () => {
    expect(assessRecoveryPolicy(clean, clean, 'FAIL', true)).toBe('PARTIAL_OR_UNSAFE');
    for (const counts of [{ ...clean.counts, leftDetected: 0 }, { ...clean.counts, falseEvents: 1 },
      { ...clean.counts, duplicates: 1 }, { ...clean.counts, wrongDirection: 1 }, { ...clean.counts, crossGapConfirmations: 1 },
      { ...clean.counts, reacquisitionFalseEvents: 1 }]) expect(assessRecoveryPolicy(clean, { counts }, 'PASS', true)).toBe('PARTIAL_OR_UNSAFE');
    expect(assessRecoveryPolicy({ counts: { ...clean.counts, rightDetected: 0 } }, clean, 'PASS', true)).toBe('PARTIAL_OR_UNSAFE');
  });
  it('separates insufficient implementation evidence, a shadow candidate, and no safe candidate', () => {
    expect(assessRecoveryPolicy(clean, clean, 'PASS', false)).toBe('INSUFFICIENT_EVIDENCE');
    expect(assessRecoveryPolicy(clean, clean, 'PASS', true)).toBe('SHADOW_CANDIDATE_WORTH_VALIDATING');
    expect(summarizeRecoveryFeasibility(['PARTIAL_OR_UNSAFE', 'PARTIAL_OR_UNSAFE', 'PARTIAL_OR_UNSAFE', 'PARTIAL_OR_UNSAFE'])).toBe('NO_SAFE_CANDIDATE');
    expect(summarizeRecoveryFeasibility(['PARTIAL_OR_UNSAFE', 'PARTIAL_OR_UNSAFE', 'PARTIAL_OR_UNSAFE', 'SHADOW_CANDIDATE_WORTH_VALIDATING'])).toBe('SHADOW_CANDIDATE_WORTH_VALIDATING');
    expect(summarizeRecoveryFeasibility(['INSUFFICIENT_EVIDENCE', 'PARTIAL_OR_UNSAFE', 'PARTIAL_OR_UNSAFE', 'PARTIAL_OR_UNSAFE'])).toBe('INSUFFICIENT_EVIDENCE');
  });
});
