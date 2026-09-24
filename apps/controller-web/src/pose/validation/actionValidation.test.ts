// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ActionValidation, VALIDATION_SEQUENCE } from './actionValidation';
import { validationContext, validationFrame } from './testFixtures';
import type { ValidationDataset } from './validationTypes';
import { ACTION_FEATURE_SCALES, ACTION_ENTER_MS, ACTION_RELEASE_MS } from '../actions/poseActionConstants';

const dataset = (engine: ActionValidation): ValidationDataset => { engine.getView(21500); return JSON.parse(engine.exportJson()); };

describe('ActionValidation sequence and prerequisites', () => {
  it.each(['camera', 'neutral', 'ready', 'prototype'] as const)('cannot start without %s', (missing) => {
    const context = validationContext();
    if (missing === 'camera') context.cameraRunning = false;
    if (missing === 'neutral') context.features.collectionState = 'FINISHING';
    if (missing === 'ready') context.actions.calibration.status = 'PARTIAL';
    if (missing === 'prototype') context.actions.calibration.prototypes.KNEE_RIGHT = null;
    const engine = new ActionValidation();
    expect(engine.start(context, 0)).toBe(false);
    expect(engine.getView(0).status).toBe('IDLE');
  });

  it('uses all exact 21.5s boundaries, first MOVE and final Neutral record before completion', () => {
    const engine = new ActionValidation(); engine.start(validationContext(), 100);
    const expected = [
      [0, 'PREPARE', 'NONE', 2000], [2000, 'RECORD_NEUTRAL', 'NONE', 1500],
      [3500, 'MOVE', 'TWIST_LEFT', 1000], [4500, 'RECORD_ACTION', 'TWIST_LEFT', 1500],
      [6000, 'RETURN_NEUTRAL', 'NONE', 1000], [7000, 'RECORD_NEUTRAL', 'NONE', 1000],
      [8000, 'MOVE', 'TWIST_RIGHT', 1000], [9000, 'RECORD_ACTION', 'TWIST_RIGHT', 1500],
      [10500, 'RETURN_NEUTRAL', 'NONE', 1000], [11500, 'RECORD_NEUTRAL', 'NONE', 1000],
      [12500, 'MOVE', 'KNEE_LEFT', 1000], [13500, 'RECORD_ACTION', 'KNEE_LEFT', 1500],
      [15000, 'RETURN_NEUTRAL', 'NONE', 1000], [16000, 'RECORD_NEUTRAL', 'NONE', 1000],
      [17000, 'MOVE', 'KNEE_RIGHT', 1000], [18000, 'RECORD_ACTION', 'KNEE_RIGHT', 1500],
      [19500, 'RETURN_NEUTRAL', 'NONE', 1000], [20500, 'RECORD_NEUTRAL', 'NONE', 1000],
    ] as const;
    for (const [offset, phase, expectedAction, duration] of expected) {
      expect(engine.getView(offset + 100)).toMatchObject({ status: 'ACTIVE', phase, expectedAction, remainingMs: duration });
      expect(engine.getView(offset + 100 + duration - 1)).toMatchObject({ phase, remainingMs: 1 });
    }
    expect(VALIDATION_SEQUENCE.reduce((sum, stage) => sum + stage.durationMs, 0)).toBe(21500);
    expect(engine.getView(21600)).toMatchObject({ status: 'COMPLETED', phase: 'COMPLETED', expectedAction: null, remainingMs: 0 });
  });

  it('stores each inference once only in RECORD windows, with correct expected labels', () => {
    const context = validationContext(); const engine = new ActionValidation();
    engine.recordFrame(validationFrame(0), context.features, context.actions);
    engine.start(context, 0);
    for (let now = 0; now <= 22000; now += 50) {
      engine.recordFrame(validationFrame(now), context.features, context.actions);
      engine.recordFrame(validationFrame(now), context.features, context.actions);
    }
    expect(engine.getView(22000)).toMatchObject({ recordedFrames: 230, sampleCounts: { NONE: 110, TWIST_LEFT: 30, TWIST_RIGHT: 30, KNEE_LEFT: 30, KNEE_RIGHT: 30 } });
    const samples = dataset(engine).samples;
    expect(samples.find((sample) => sample.timestamp === 3500)).toBeUndefined();
    expect(samples.find((sample) => sample.timestamp === 4500)?.expectedAction).toBe('TWIST_LEFT');
    expect(samples.find((sample) => sample.timestamp === 6000)).toBeUndefined();
    expect(samples.at(-1)).toMatchObject({ timestamp: 21450, expectedAction: 'NONE', stageIndex: 17 });
    expect(samples.every((sample) => VALIDATION_SEQUENCE[sample.stageIndex].phase.startsWith('RECORD'))).toBe(true);
  });

  it('does not collect from UI polling or reset on duplicate starts; requires completion for export', () => {
    const context = validationContext(); const engine = new ActionValidation(); engine.start(context, 0);
    expect(engine.start(context, 500)).toBe(false);
    expect(engine.getView(500).remainingMs).toBe(1500);
    for (let now = 0; now < 21500; now += 250) engine.getView(now);
    expect(() => engine.exportJson()).toThrow();
    expect(dataset(engine).samples).toEqual([]);
    expect(engine.getSummary()?.actions.TWIST_LEFT.rawCorrectRate).toBeNull();
  });
});

describe('validation snapshots and lifecycle', () => {
  it('copies all 33 raw/world points, features and classification primitives independently of the source', () => {
    const context = validationContext(); const engine = new ActionValidation(); const frame = validationFrame(4500);
    engine.start(context, 0);
    context.features.smoothed.lastValidAt = 4500;
    const original = JSON.parse(JSON.stringify({ frame, features: context.features, classification: context.actions.classification }));
    engine.recordFrame(frame, context.features, context.actions);
    frame.landmarks[23].x = 999; frame.worldLandmarks[25].z = 999;
    context.features.raw.hipCenterX = 999; context.features.calibrated.deltaHipCenterX = 999;
    context.features.smoothed.values.deltaHipCenterX = 999; context.features.smoothed.validNow = false;
    context.actions.classification.rawAction = 'KNEE_RIGHT'; context.actions.classification.actionDistances.TWIST_LEFT = 999;
    const sample = dataset(engine).samples[0];
    expect(sample.landmarks).toHaveLength(33); expect(sample.worldLandmarks).toHaveLength(33);
    expect(sample.landmarks[23]).toEqual({ index: 23, ...original.frame.landmarks[23] });
    expect(sample.worldLandmarks[25]).toEqual({ index: 25, ...original.frame.worldLandmarks[25], visibility: null });
    expect(sample.rawFeatures).toEqual(original.features.raw);
    expect(sample.calibratedFeatures).toEqual(original.features.calibrated);
    expect(sample.smoothedFeatures).toEqual(original.features.smoothed);
    expect(sample.classification).toEqual(original.classification);
    expect(sample).toMatchObject({ expectedAction: 'TWIST_LEFT', timestamp: 4500, videoTime: 4.5, poseValid: true });
  });

  it('records pose loss instead of dropping it, including stale classification and empty points', () => {
    const context = validationContext(); const engine = new ActionValidation(); engine.start(context, 0);
    context.features.smoothed.validNow = false;
    context.actions.classification = { ...context.actions.classification, valid: false, reason: 'POSE_STALE', rawAction: 'NONE', stableAction: 'NONE' };
    engine.recordFrame({ ...validationFrame(13500), landmarks: [], worldLandmarks: [] }, context.features, context.actions);
    const result = dataset(engine);
    expect(result.samples[0]).toMatchObject({ expectedAction: 'KNEE_LEFT', poseValid: false, landmarks: [], worldLandmarks: [], classification: { reason: 'POSE_STALE' } });
    expect(result.summary.actions.KNEE_LEFT).toMatchObject({ totalRecordedFrames: 1, validPoseFrames: 0, staleFrames: 1, rawCorrectRate: null });
  });

  it('freezes experiment baselines/prototypes/sample counts/config at start and exports explicit metadata', () => {
    const context = validationContext(); const engine = new ActionValidation();
    const before = JSON.parse(JSON.stringify(context)); engine.start(context, 0);
    context.features.baseline!.hipCenterX = 999;
    context.actions.calibration.prototypes.TWIST_LEFT!.features.deltaHipCenterX = 999;
    context.actions.calibration.sampleCounts.TWIST_LEFT.deltaHipCenterX = 999;
    context.previewMirrored = false;
    const result = dataset(engine);
    expect(result).toMatchObject({ version: 1, status: 'COMPLETED', model: 'pose_landmarker_full', delegate: 'GPU', videoWidth: 1280, videoHeight: 720, previewMirrored: true, timeOrigin: 123456789, startedAt: 0 });
    expect(result.neutralBaseline).toEqual(before.features.baseline);
    expect(result.actionPrototypes).toEqual(before.actions.calibration.prototypes);
    expect(result.actionCalibrationSampleCounts).toEqual(before.actions.calibration.sampleCounts);
    expect(result.classifierConfig).toMatchObject({ featureScales: ACTION_FEATURE_SCALES, enterMs: ACTION_ENTER_MS, releaseMs: ACTION_RELEASE_MS, smoothingWindowMs: 400, neutralExitScore: 0.5, neutralEnterScore: 0.3, maxDistance: 1.5, minMargin: 0.2, minConfidence: 0.25 });
    expect(result.sequence).toEqual(VALIDATION_SEQUENCE);
  });

  it('Mirror changes metadata only, never labels, landmarks, features or classification', () => {
    const results = [true, false].map((previewMirrored) => {
      const context = validationContext(); context.previewMirrored = previewMirrored;
      const engine = new ActionValidation(); engine.start(context, 0);
      engine.recordFrame(validationFrame(9000), context.features, context.actions);
      return dataset(engine);
    });
    expect(results[0].previewMirrored).not.toBe(results[1].previewMirrored);
    expect(results[0].samples).toEqual(results[1].samples);
    expect(results[0].summary).toEqual(results[1].summary);
  });

  it.each(['neutral', 'action', 'prototype'] as const)('invalidates active data when the %s reference changes', (change) => {
    const context = validationContext(); const engine = new ActionValidation(); engine.start(context, 0);
    engine.recordFrame(validationFrame(2000), context.features, context.actions);
    if (change === 'neutral') context.features.collectionState = 'HIP';
    if (change === 'action') context.actions.calibration.status = 'RUNNING';
    if (change === 'prototype') context.actions.calibration.prototypes.TWIST_LEFT!.features.deltaHipCenterX = 3;
    engine.recordFrame(validationFrame(2050), context.features, context.actions);
    expect(engine.getView(2050)).toMatchObject({ status: 'IDLE', recordedFrames: 0 });
    expect(engine.getSummary()).toBeNull(); expect(() => engine.exportJson()).toThrow();
  });

  it('reset clears data/counts/summary and the next run uses a new start time', () => {
    const context = validationContext(); const engine = new ActionValidation(); engine.start(context, 0);
    engine.recordFrame(validationFrame(2000), context.features, context.actions); dataset(engine); engine.reset();
    expect(engine.getView(30000)).toMatchObject({ status: 'IDLE', recordedFrames: 0, remainingMs: 0 });
    expect(engine.getSummary()).toBeNull(); expect(() => engine.exportJson()).toThrow();
    expect(engine.start(context, 30000)).toBe(true);
    expect(engine.getView(30500)).toMatchObject({ phase: 'PREPARE', remainingMs: 1500 });
  });
});
