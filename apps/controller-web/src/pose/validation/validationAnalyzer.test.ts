// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { summarizeValidation } from './validationAnalyzer';
import { ActionValidation } from './actionValidation';
import { validationContext, validationFrame } from './testFixtures';
import type { ValidationDataset, ValidationSample } from './validationTypes';
import { ACTION_FEATURE_KEYS, ACTION_FEATURE_SCALES } from '../actions/poseActionConstants';

function sample(): ValidationSample {
  const context = validationContext(); const engine = new ActionValidation(); engine.start(context, 0);
  engine.recordFrame(validationFrame(4500), context.features, context.actions); engine.getView(21500);
  return (JSON.parse(engine.exportJson()) as ValidationDataset).samples[0];
}

describe('pure validation measurement summary', () => {
  it('measures correctness, uniquely nearest rate, confidence and per-frame distance margins', () => {
    const rows = Array.from({ length: 5 }, sample);
    rows.forEach((row, index) => {
      row.classification.rawAction = index === 1 ? 'TWIST_RIGHT' : 'TWIST_LEFT';
      row.classification.stableAction = index < 2 ? 'TWIST_LEFT' : 'NONE';
      row.classification.confidence = [0.2, 0.8, 0.4, 0.6, 1][index];
      row.classification.actionDistances = { TWIST_LEFT: [1, 3, 2, null, 0][index], TWIST_RIGHT: [3, 1, 2, 1, 9][index], KNEE_LEFT: 4, KNEE_RIGHT: 5 };
    });
    rows[4].poseValid = false;
    const before = JSON.stringify(rows);
    const summary = summarizeValidation(rows, validationContext().actions.calibration.prototypes, ACTION_FEATURE_SCALES);
    expect(summary.actions.TWIST_LEFT).toMatchObject({ totalRecordedFrames: 5, validPoseFrames: 4, staleFrames: 1,
      rawCorrectRate: 0.75, stableCorrectRate: 0.5, distanceComparableFrames: 3,
      ownPrototypeNearestRate: 1 / 3, medianConfidence: 0.5, medianOwnDistance: 2, medianClosestOtherDistance: 2, medianMargin: 0 });
    expect(JSON.stringify(rows)).toBe(before);
    expect(summary.actions.TWIST_RIGHT.rawCorrectRate).toBeNull();
  });

  it('calculates median of each frame margin, not difference of independent medians', () => {
    const rows = Array.from({ length: 3 }, sample);
    rows.forEach((row, index) => {
      row.classification.actionDistances = { TWIST_LEFT: [1, 10, 20][index], TWIST_RIGHT: [9, 11, 2][index], KNEE_LEFT: 30, KNEE_RIGHT: 40 };
    });
    const row = summarizeValidation(rows, validationContext().actions.calibration.prototypes, ACTION_FEATURE_SCALES).actions.TWIST_LEFT;
    expect(row.medianOwnDistance).toBe(10); expect(row.medianClosestOtherDistance).toBe(9); expect(row.medianMargin).toBe(1);
  });

  it('uses valid Neutral frames for NONE rates and nearest-rank p90, excluding stale scores', () => {
    const rows = Array.from({ length: 11 }, sample);
    rows.forEach((row, index) => {
      row.expectedAction = 'NONE'; row.classification.neutralMovementScore = index;
      row.classification.rawAction = index === 9 ? 'TWIST_LEFT' : 'NONE'; row.classification.stableAction = 'NONE';
    });
    rows[10].poseValid = false;
    const summary = summarizeValidation(rows, validationContext().actions.calibration.prototypes, ACTION_FEATURE_SCALES);
    expect(summary.neutral).toEqual({ totalRecordedFrames: 11, validPoseFrames: 10, staleFrames: 1,
      rawCorrectRate: 0.9, stableCorrectRate: 1, scoreFrames: 10, medianNeutralMovementScore: 4.5, p90NeutralMovementScore: 8 });
  });

  it('reports all seven feature medians, signed differences and absolute normalized drift using saved scales', () => {
    const rows = Array.from({ length: 4 }, sample);
    const prototypes = validationContext().actions.calibration.prototypes;
    rows.forEach((row, index) => {
      row.smoothedFeatures.values.deltaHipCenterX = [-0.01, 0.03, 0.05, null][index];
      row.smoothedFeatures.values.deltaLeftKneeRelativeX = 0.4;
    });
    const scales = { ...ACTION_FEATURE_SCALES, deltaHipCenterX: 0.1 };
    const features = summarizeValidation(rows, prototypes, scales).actions.TWIST_LEFT.featureRepeatability;
    expect(Object.keys(features)).toEqual(ACTION_FEATURE_KEYS);
    expect(features.deltaHipCenterX).toMatchObject({ sampleCount: 3, prototype: -0.1, validationMedian: 0.03 });
    expect(features.deltaHipCenterX.difference).toBeCloseTo(0.13);
    expect(features.deltaHipCenterX.normalizedDrift).toBeCloseTo(1.3);
    expect(features.deltaLeftKneeRelativeX).toEqual({ sampleCount: 4, prototype: null, validationMedian: 0.4, difference: null, normalizedDrift: null });
  });

  it('keeps absent/nonfinite statistics null instead of inventing zeros or PASS/FAIL', () => {
    const row = sample();
    row.smoothedFeatures.values.deltaHipCenterX = NaN;
    row.classification.actionDistances.TWIST_LEFT = Infinity;
    row.classification.confidence = NaN;
    const result = summarizeValidation([row], validationContext().actions.calibration.prototypes, ACTION_FEATURE_SCALES);
    expect(result.actions.TWIST_LEFT).toMatchObject({ distanceComparableFrames: 0, ownPrototypeNearestRate: null, medianOwnDistance: null, medianConfidence: null });
    expect(result.actions.TWIST_LEFT.featureRepeatability.deltaHipCenterX.validationMedian).toBeNull();
    expect(result.neutral).toMatchObject({ totalRecordedFrames: 0, rawCorrectRate: null, stableCorrectRate: null, medianNeutralMovementScore: null, p90NeutralMovementScore: null });
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity|PASS|FAIL/);
  });
});
