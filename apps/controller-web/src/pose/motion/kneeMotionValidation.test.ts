// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { KneeMotionValidation, MOTION_SEQUENCE } from './kneeMotionValidation';
import { motionContext, motionFrame } from './testFixtures';
import type { MotionDataset } from './kneeMotionTypes';

function dataset(engine: KneeMotionValidation): MotionDataset { engine.getView(15000); return JSON.parse(engine.exportJson()); }

describe('Knee Motion Validation state machine and dataset', () => {
  it.each(['camera', 'pose', 'neutral'] as const)('rejects start without %s', (missing) => {
    const context = motionContext();
    if (missing === 'camera') context.cameraRunning = false;
    if (missing === 'pose') context.poseDetected = false;
    if (missing === 'neutral') context.neutral.collectionState = 'FINISHING';
    const engine = new KneeMotionValidation(); expect(engine.start(context, 0)).toBe(false);
    expect(engine.getView(0).status).toBe('IDLE');
  });

  it('starts with only frozen Neutral and follows exact 15-second phase boundaries', () => {
    const engine = new KneeMotionValidation(); expect(engine.start(motionContext(), 100)).toBe(true);
    const stages = [
      [0, 2000, 'PREPARE', 'NEUTRAL'], [2000, 1000, 'NEUTRAL', 'NEUTRAL'],
      [3000, 1000, 'MOVE', 'TWIST_LEFT'], [4000, 1000, 'HOLD', 'TWIST_LEFT'], [5000, 1000, 'RETURN', 'TWIST_LEFT'],
      [6000, 1000, 'MOVE', 'TWIST_RIGHT'], [7000, 1000, 'HOLD', 'TWIST_RIGHT'], [8000, 1000, 'RETURN', 'TWIST_RIGHT'],
      [9000, 1000, 'MOVE', 'KNEE_LEFT'], [10000, 1000, 'HOLD', 'KNEE_LEFT'], [11000, 1000, 'RETURN', 'KNEE_LEFT'],
      [12000, 1000, 'MOVE', 'KNEE_RIGHT'], [13000, 1000, 'HOLD', 'KNEE_RIGHT'], [14000, 1000, 'RETURN', 'KNEE_RIGHT'],
    ] as const;
    for (const [start, duration, phase, expectedMotion] of stages) {
      expect(engine.getView(100 + start)).toMatchObject({ phase, expectedMotion, remainingMs: duration });
      expect(engine.getView(100 + start + duration - 1)).toMatchObject({ phase, expectedMotion, remainingMs: 1 });
    }
    expect(MOTION_SEQUENCE.reduce((sum, stage) => sum + stage.durationMs, 0)).toBe(15000);
    expect(engine.getView(15100)).toMatchObject({ status: 'COMPLETED', remainingMs: 0, recordedFrames: 0 });
  });

  it('records every MOVE/HOLD/RETURN and Neutral inference, but no PREPARE/idle/duplicate frames', () => {
    const engine = new KneeMotionValidation(); const context = motionContext();
    engine.recordFrame(motionFrame(0), context.neutral); engine.start(context, 0);
    for (let now = 0; now <= 15100; now += 50) {
      engine.recordFrame(motionFrame(now), context.neutral); engine.recordFrame(motionFrame(now), context.neutral);
    }
    const result = dataset(engine);
    expect(result.samples).toHaveLength(260);
    expect(result.samples[0]).toMatchObject({ timestamp: 2000, phase: 'NEUTRAL', expectedMotion: 'NEUTRAL' });
    expect(result.samples.find((sample) => sample.timestamp === 9000)).toMatchObject({ phase: 'MOVE', expectedMotion: 'KNEE_LEFT' });
    expect(result.samples.at(-1)).toMatchObject({ timestamp: 14950, phase: 'RETURN', expectedMotion: 'KNEE_RIGHT' });
    expect(result.summary.stages).toHaveLength(13);
    expect(result.summary.stages.every((stage) => stage.totalFrames === 20)).toBe(true);
  });

  it('copies 33 raw/world landmarks and start metadata before any source changes', () => {
    const engine = new KneeMotionValidation(), context = motionContext(), frame = motionFrame(3000);
    const baseline = { ...context.neutral.baseline! };
    engine.start(context, 0); engine.recordFrame(frame, context.neutral);
    frame.landmarks[25].x = 999; frame.worldLandmarks[26].x = 999;
    context.neutral.baseline!.hipCenterX = 999; context.previewMirrored = false;
    const result = dataset(engine);
    expect(result.samples[0].landmarks).toHaveLength(33); expect(result.samples[0].worldLandmarks).toHaveLength(33);
    expect(result.samples[0].landmarks[25]).toMatchObject({ index: 25, x: 0.35, visibility: 0.7 });
    expect(result.samples[0].worldLandmarks[26]).toMatchObject({ index: 26, x: 1.3, visibility: null });
    expect(result.samples[0].features.leftKneeCenterOffsetX).toBeCloseTo(-0.15);
    expect(result).toMatchObject({ version: 1, previewMirrored: true, neutralBaseline: baseline, delegate: 'CPU', videoWidth: 1280, videoHeight: 720 });
    expect(result.sequence).toEqual(MOTION_SEQUENCE);
    expect(result.measurementConfig.corridorMultipliers).toEqual([1.5, 2, 2.5, 3]);
    expect(result).not.toHaveProperty('actionPrototypes');
  });

  it('records pose loss and compares with the previous valid frame only within the gap limit', () => {
    const engine = new KneeMotionValidation(), context = motionContext(); engine.start(context, 0);
    engine.recordFrame(motionFrame(3000), context.neutral);
    engine.recordFrame({ ...motionFrame(3050), landmarks: [], worldLandmarks: [] }, context.neutral);
    engine.recordFrame(motionFrame(3100), context.neutral);
    engine.recordFrame(motionFrame(3500), context.neutral);
    engine.recordFrame(motionFrame(3550), context.neutral);
    const samples = dataset(engine).samples;
    expect(samples[1]).toMatchObject({ poseValid: false, landmarks: [], worldLandmarks: [], velocity: { leftKneeRelativeVelocityX: null } });
    expect(samples[2].velocity).toMatchObject({ deltaTimeMs: 100, leftKneeRelativeVelocityX: 0 });
    expect(samples[3].velocity).toMatchObject({ deltaTimeMs: 400, leftKneeRelativeVelocityX: null });
    expect(samples[4].velocity).toMatchObject({ deltaTimeMs: 50, leftKneeRelativeVelocityX: 0 });
    expect(dataset(engine).summary.byMotion.TWIST_LEFT).toMatchObject({ validFrames: 4, staleFrames: 1 });
  });

  it('does not apply Mirror to any measured signal', () => {
    const results = [true, false].map((previewMirrored) => {
      const context = motionContext(); const engine = new KneeMotionValidation(); engine.start({ ...context, previewMirrored }, 0);
      engine.recordFrame(motionFrame(3000), context.neutral); return dataset(engine);
    });
    expect(results[0].samples).toEqual(results[1].samples); expect(results[0].summary).toEqual(results[1].summary);
    expect(results[0].previewMirrored).not.toBe(results[1].previewMirrored);
  });

  it('deduplicates starts, clears on Neutral invalidation/reset, and never exports an unfinished dataset', () => {
    const context = motionContext(), engine = new KneeMotionValidation(); engine.start(context, 0);
    expect(engine.start(context, 500)).toBe(false); expect(engine.getView(500).remainingMs).toBe(1500);
    expect(() => engine.exportJson()).toThrow(); engine.recordFrame(motionFrame(3000), context.neutral);
    context.neutral.collectionState = 'HIP'; engine.recordFrame(motionFrame(3050), context.neutral);
    expect(engine.getView(3050)).toMatchObject({ status: 'IDLE', recordedFrames: 0 });
    expect(engine.getAnalysis()).toBeNull(); expect(engine.start(motionContext(), 5000)).toBe(true);
    engine.reset(); expect(engine.getView(6000).status).toBe('IDLE');
  });
});
