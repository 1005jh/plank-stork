// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { summarizeKickDiagnostics, summarizeNeutralDiagnostics, type KickDetectorDiagnosticFrame } from './kneeKickDiagnostics';
import type { DetectorTestStage } from './guidedDetectorTest';

const stage = (expected: DetectorTestStage['expected'] = 'KNEE_LEFT'): DetectorTestStage => ({ expected, events: [], wrongEventCount: 0, duplicateCount: 0 });
const frame = (overrides: Partial<KickDetectorDiagnosticFrame> = {}): KickDetectorDiagnosticFrame => ({
  timestamp: 100, stageIndex: 0, expected: 'KNEE_LEFT', poseFresh: true, usableLeft: true, usableRight: true,
  stateBefore: 'ARMED', stateAfter: 'ARMED', hipCenterX: 0.25, hipWidth: 0.1,
  leftKneeVisibility: 0.8, rightKneeVisibility: 0.6,
  normalizedLeft: -0.28, normalizedRight: 0.1, dominantNormalizedDisplacement: -0.28,
  normalizedLeftVelocity: -2, normalizedRightVelocity: 1, event: null, ...overrides,
});

describe('derived-only diagnostic stage summaries', () => {
  const rows: KickDetectorDiagnosticFrame[] = [
    frame({ stateAfter: 'WAIT_RETURN', event: { id: 1, direction: 'KNEE_LEFT', timestamp: 100 } }),
    frame({ timestamp: 150, stateBefore: 'WAIT_RETURN', stateAfter: 'WAIT_RETURN', usableLeft: false,
      hipCenterX: 0.15, hipWidth: 0.3, leftKneeVisibility: 0.3, rightKneeVisibility: 0.9,
      normalizedLeft: null, normalizedRight: -0.6, dominantNormalizedDisplacement: -0.6,
      normalizedLeftVelocity: null, normalizedRightVelocity: -4 }),
    frame({ timestamp: 200, stateBefore: 'WAIT_RETURN', stateAfter: 'WAIT_RETURN', poseFresh: false, usableLeft: false, usableRight: false,
      hipCenterX: null, hipWidth: null, leftKneeVisibility: null, rightKneeVisibility: null,
      normalizedLeft: null, normalizedRight: null, dominantNormalizedDisplacement: null, normalizedLeftVelocity: null, normalizedRightVelocity: null }),
    frame({ timestamp: 250, stateBefore: 'WAIT_RETURN', stateAfter: 'WAIT_RETURN', hipCenterX: 0.4, hipWidth: 0.2,
      normalizedLeft: 0.6, normalizedRight: 0.2, dominantNormalizedDisplacement: 0.6, normalizedLeftVelocity: 3, normalizedRightVelocity: null }),
    frame({ timestamp: 300, usableRight: false, hipCenterX: 0.2, hipWidth: 0.4, leftKneeVisibility: 0.5, rightKneeVisibility: 0.2,
      normalizedLeft: -0.3, normalizedRight: null, dominantNormalizedDisplacement: -0.3, normalizedLeftVelocity: 0, normalizedRightVelocity: null,
      stateAfter: 'WAIT_RETURN', event: { id: 2, direction: 'KNEE_RIGHT', timestamp: 300 } }),
  ];
  function summarize() {
    return summarizeKickDiagnostics(rows, [{ ...stage(), events: rows.flatMap((row) => row.event ? [row.event] : []), wrongEventCount: 1, duplicateCount: 1 }])[0];
  }

  it('counts fresh/stale and independently usable observations including wholly unusable frames', () => {
    expect(summarize()).toMatchObject({ totalFrames: 5, freshFrames: 4, staleFrames: 1, leftUsableFrames: 3, rightUsableFrames: 3, bothUsableFrames: 2 });
  });
  it('preserves signed peaks, ENTER equality, ARMED-only maxima and both margins', () => {
    const summary = summarize();
    expect(summary).toMatchObject({ maxAbsDominantDisplacement: 0.6, signedDominantAtMax: -0.6,
      maxAbsLeftDisplacement: 0.6, maxAbsRightDisplacement: 0.6,
      framesAboveEnter: 4, armedFramesAboveEnter: 2, maxAbsDominantWhileArmed: 0.3 });
    expect(summary.enterMargin).toBeCloseTo(0.32); expect(summary.armedEnterMargin).toBeCloseTo(0.02);
  });
  it('summarizes velocity and finite visibility/position values without filling null with zero', () => {
    const summary = summarize();
    expect(summary).toMatchObject({ peakAbsLeftVelocity: 3, peakAbsRightVelocity: 4,
      medianLeftKneeVisibility: 0.65, medianRightKneeVisibility: 0.6,
      minLeftKneeVisibility: 0.3, minRightKneeVisibility: 0.2,
      medianHipCenterX: 0.225, minHipCenterX: 0.15, maxHipCenterX: 0.4, medianHipWidth: 0.25 });
  });
  it('records first observed pre-state, before/after state counts and existing event accounting', () => {
    expect(summarize()).toMatchObject({ firstFrameTimestamp: 100, stateAtStageStart: 'ARMED',
      stateFrameCounts: { NOT_READY: 0, ARMED: 2, TRIGGERED_LEFT: 0, TRIGGERED_RIGHT: 0, WAIT_RETURN: 3 },
      stateAfterFrameCounts: { NOT_READY: 0, ARMED: 0, TRIGGERED_LEFT: 0, TRIGGERED_RIGHT: 0, WAIT_RETURN: 5 },
      eventCount: 2, eventDirections: ['KNEE_LEFT', 'KNEE_RIGHT'], wrongEventCount: 1, duplicateCount: 1 });
  });
  it('distinguishes observed crossings while WAIT_RETURN from crossings while ARMED without assigning a cause', () => {
    const summary = summarizeKickDiagnostics([frame({ stateBefore: 'WAIT_RETURN', stateAfter: 'WAIT_RETURN', dominantNormalizedDisplacement: -0.5 })], [stage()])[0];
    expect(summary).toMatchObject({ stateAtStageStart: 'WAIT_RETURN', framesAboveEnter: 1, armedFramesAboveEnter: 0,
      maxAbsDominantWhileArmed: null, armedEnterMargin: null, eventCount: 0 });
    expect(summary.enterMargin).toBeCloseTo(0.22);
  });
  it('keeps missing-stage/no-observation statistics null and excludes nonfinite numbers', () => {
    const summaries = summarizeKickDiagnostics([frame({ dominantNormalizedDisplacement: null, normalizedLeft: null, normalizedRight: null,
      normalizedLeftVelocity: null, normalizedRightVelocity: null, hipCenterX: NaN, hipWidth: null, leftKneeVisibility: null, rightKneeVisibility: Infinity })], [stage(), stage('NEUTRAL')]);
    expect(summaries[0]).toMatchObject({ maxAbsDominantDisplacement: null, maxAbsDominantWhileArmed: null, enterMargin: null, armedEnterMargin: null,
      framesAboveEnter: 0, armedFramesAboveEnter: 0, medianHipCenterX: null, minHipCenterX: null, maxHipCenterX: null, medianHipWidth: null,
      minLeftKneeVisibility: null, medianRightKneeVisibility: null, peakAbsLeftVelocity: null });
    expect(summaries[1]).toMatchObject({ totalFrames: 0, stateAtStageStart: null, firstFrameTimestamp: null, eventDirections: [], eventCount: 0 });
    const below = summarizeKickDiagnostics([frame({ dominantNormalizedDisplacement: 0.2 })], [stage()])[0];
    expect(below.enterMargin).toBeCloseTo(-0.08);
  });
  it('calculates neutral hip-position median/p10/p90 and visibility medians independently', () => {
    const samples = Array.from({ length: 10 }, (_, index) => ({ hipCenterX: index / 10, leftKneeVisibility: index % 2 ? 0.4 : 0.8, rightKneeVisibility: null }));
    const summary = summarizeNeutralDiagnostics(samples);
    expect(summary).toMatchObject({ hipCenterX: { sampleCount: 10, median: 0.45, p10: 0, p90: 0.8 },
      leftKneeVisibility: { sampleCount: 10 }, rightKneeVisibility: { sampleCount: 0, median: null } });
    expect(summary.leftKneeVisibility.median).toBeCloseTo(0.6);
  });
});
