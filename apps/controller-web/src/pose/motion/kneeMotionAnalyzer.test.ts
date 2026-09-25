// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { analyzeKneeMotion, robustStats } from './kneeMotionAnalyzer';
import { calculateKneeMotionVelocity, extractKneeMotionFeatures } from './kneeMotionFeatures';
import { MOTION_SEQUENCE } from './kneeMotionValidation';
import { motionFrame } from './testFixtures';
import type { ExpectedMotion, MotionPhase, MotionSample } from './kneeMotionTypes';

function sample(expectedMotion: ExpectedMotion, phase: MotionPhase, left: number | null, right = 0): MotionSample {
  const features = extractKneeMotionFeatures(motionFrame(0).landmarks);
  features.leftKneeCenterOffsetX = left; features.rightKneeCenterOffsetX = right;
  features.maxAbsKneeCenterOffsetX = left === null ? null : Math.max(Math.abs(left), Math.abs(right));
  return { timestamp: 0, videoTime: 0, stageIndex: MOTION_SEQUENCE.findIndex((stage) => stage.phase === phase && stage.expectedMotion === expectedMotion),
    expectedMotion, phase, poseValid: left !== null, landmarks: [], worldLandmarks: [], features,
    velocity: calculateKneeMotionVelocity(features, 0, null) };
}

describe('motion measurements without a detector', () => {
  it('calculates finite-value median, nearest-rank p10/p90 and unscaled MAD', () => {
    expect(robustStats([1, 2, 3, 4, 5, null, NaN])).toEqual({ sampleCount: 5, median: 3, p10: 1, p90: 5, mad: 1 });
    expect(robustStats([1, 2, 3, 4])).toMatchObject({ median: 2.5, mad: 1 });
    expect(robustStats([])).toEqual({ sampleCount: 0, median: null, p10: null, p90: null, mad: null });
  });

  it('compares every k using MOVE/HOLD and includes Twist/Neutral false crossing rates', () => {
    const samples = [
      ...[-0.1, 0, 0.1].map((value) => sample('NEUTRAL', 'NEUTRAL', value)),
      sample('KNEE_LEFT', 'MOVE', 0.2), sample('KNEE_LEFT', 'HOLD', 0.3),
      sample('KNEE_LEFT', 'RETURN', 99), sample('KNEE_LEFT', 'HOLD', null),
      sample('KNEE_RIGHT', 'MOVE', 0.4), sample('TWIST_LEFT', 'MOVE', 0.2), sample('TWIST_RIGHT', 'HOLD', 0.1),
    ];
    const before = JSON.stringify(samples); const result = analyzeKneeMotion(samples, MOTION_SEQUENCE);
    const rows = result.crossingExperiments.filter((row) => row.feature === 'leftKneeCenterOffsetX');
    expect(rows.map((row) => row.k)).toEqual([1.5, 2, 2.5, 3]);
    expect(rows.map((row) => row.rates.KNEE_LEFT.crossingRate)).toEqual([1, 0.5, 0.5, 0]);
    expect(rows.map((row) => row.rates.KNEE_RIGHT.crossingRate)).toEqual([1, 1, 1, 1]);
    expect(rows.map((row) => row.rates.TWIST_LEFT.crossingRate)).toEqual([1, 0, 0, 0]);
    expect(rows.every((row) => row.rates.TWIST_RIGHT.crossingRate === 0 && row.rates.NEUTRAL.crossingRate === 0)).toBe(true);
    expect(rows[0].rates.KNEE_LEFT.comparableFrames).toBe(2);
    expect(JSON.stringify(samples)).toBe(before);
  });

  it('reports zero-MAD corridors literally and missing baselines as null, without noise floors or fallback thresholds', () => {
    const samples = [sample('NEUTRAL', 'NEUTRAL', 0), sample('KNEE_LEFT', 'MOVE', 0.001)];
    const row = analyzeKneeMotion(samples, MOTION_SEQUENCE).crossingExperiments.find((item) => item.feature === 'leftKneeCenterOffsetX')!;
    expect(row).toMatchObject({ lower: 0, upper: 0, rates: { KNEE_LEFT: { crossingRate: 1 } } });
    const empty = analyzeKneeMotion(samples.slice(1), MOTION_SEQUENCE);
    expect(empty.neutralCorridor.leftKneeCenterOffsetX.median).toBeNull();
    expect(empty.crossingExperiments.every((item) => Object.values(item.rates).every((rate) => rate.crossingRate === null))).toBe(true);
  });

  it('compares observed landmark displacement without equating expected LEFT/RIGHT to landmark identity', () => {
    const samples = [sample('NEUTRAL', 'NEUTRAL', 0), sample('KNEE_LEFT', 'MOVE', 0.02, 0.2), sample('KNEE_RIGHT', 'HOLD', -0.3, 0.05)];
    const result = analyzeKneeMotion(samples, MOTION_SEQUENCE);
    expect(result.dominantKnees.KNEE_LEFT).toEqual({ dominantKnee: 'RIGHT_LANDMARK', leftPeakDisplacement: 0.02, rightPeakDisplacement: 0.2 });
    expect(result.dominantKnees.KNEE_RIGHT.dominantKnee).toBe('LEFT_LANDMARK');
    const tie = analyzeKneeMotion([samples[0], sample('KNEE_LEFT', 'MOVE', 0.2, -0.2)], MOTION_SEQUENCE);
    expect(tie.dominantKnees.KNEE_LEFT.dominantKnee).toBe('NONE');
    expect(tie.dominantKnees.KNEE_RIGHT.dominantKnee).toBe('NONE');
  });

  it('summarizes stage validity, offset, velocity peaks, Neutral-relative distance change and visibility', () => {
    const neutral = sample('NEUTRAL', 'NEUTRAL', 0), first = sample('KNEE_LEFT', 'MOVE', 0.1), second = sample('KNEE_LEFT', 'MOVE', 0.3);
    first.velocity.leftKneeRelativeVelocityX = -2; second.velocity.leftKneeRelativeVelocityX = 1;
    first.features.leftKneeHipDistance = neutral.features.leftKneeHipDistance! + 0.2;
    second.features.leftKneeHipDistance = neutral.features.leftKneeHipDistance! - 0.1;
    first.features.leftKneeVisibility = 0.2; second.features.leftKneeVisibility = 0.8;
    const missing = sample('KNEE_LEFT', 'MOVE', null);
    missing.features = extractKneeMotionFeatures([]);
    const result = analyzeKneeMotion([neutral, first, second, missing], MOTION_SEQUENCE);
    const row = result.stages.find((stage) => stage.expectedMotion === 'KNEE_LEFT' && stage.phase === 'MOVE')!;
    expect(row).toMatchObject({ totalFrames: 3, validFrames: 2, staleFrames: 1, medianAbsKneeCenterOffsetX: 0.2,
      maxAbsKneeCenterOffsetX: 0.3, peakRelativeKneeVelocity: { left: 2 }, medianLeftKneeVisibility: 0.5 });
    expect(row.peakKneeHipDistanceChange.left).toBeCloseTo(0.2);
    expect(result.byMotion.KNEE_LEFT).toMatchObject({ totalFrames: 3, validFrames: 2, staleFrames: 1 });
    expect(JSON.stringify(result)).not.toMatch(/PASS|FAIL|isKick|strength/);
  });
});
