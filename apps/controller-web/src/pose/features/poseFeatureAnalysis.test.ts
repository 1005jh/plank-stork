// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PoseFeatureAnalysis, PoseFeatureSmoother } from './poseFeatureAnalysis';
import { calibratePoseFeatures } from './calibratePoseFeatures';
import { extractPoseFeatures } from './extractPoseFeatures';

const points = (offset = 0) => Array.from({ length: 33 }, () => ({ x: 0.5 + offset, y: 0.5, z: offset, visibility: 0.9 }));

function calibrate(analysis: PoseFeatureAnalysis, outlierIndex = -1) {
  analysis.startCalibration(0);
  for (let index = 1; index <= 20; index++) {
    const pose = points(index === outlierIndex ? 100 : 0);
    analysis.processFrame(pose, pose, index * 50);
  }
}

describe('Neutral calibration and live analysis', () => {
  it('does not calibrate with fewer than 20 valid samples', () => {
    const analysis = new PoseFeatureAnalysis();
    analysis.startCalibration(0);
    for (let index = 1; index <= 19; index++) analysis.processFrame(points(), points(), index * 50);
    analysis.processFrame([], [], 1000);
    expect(analysis.getView(1000)).toMatchObject({ status: 'CALIBRATING', sampleCount: 19, baseline: null });
  });

  it('waits at least 1 second, then uses multiple valid samples to produce a median baseline', () => {
    const analysis = new PoseFeatureAnalysis();
    analysis.startCalibration(0);
    for (let index = 1; index <= 20; index++) analysis.processFrame(points(index / 100), points(), index * 25);
    expect(analysis.getView(500)).toMatchObject({ status: 'CALIBRATING', sampleCount: 20, baseline: null });
    analysis.processFrame(points(0.11), points(), 1000);
    expect(analysis.getView(1000)).toMatchObject({ status: 'CALIBRATED', sampleCount: 21, baseline: { hipCenterX: 0.61 } });
  });

  it('is robust to an isolated outlier and retains numeric snapshots independent of source reuse', () => {
    const analysis = new PoseFeatureAnalysis();
    calibrate(analysis, 10);
    const view = analysis.getView(1000);
    expect(view.status).toBe('CALIBRATED');
    expect(view.baseline?.hipCenterX).toBe(0.5);
    const pose = points(0.1);
    analysis.processFrame(pose, pose, 1050);
    pose[23].x = 999;
    expect(analysis.getView(1050).calibrated.deltaHipCenterX).toBeCloseTo(0.1);
    view.baseline!.hipCenterX = 999;
    expect(analysis.getView(1050).baseline?.hipCenterX).toBe(0.5);
  });

  it('expires calibration samples instead of completing from old values after a tracking gap', () => {
    const analysis = new PoseFeatureAnalysis();
    analysis.startCalibration(0);
    for (let index = 1; index <= 20; index++) analysis.processFrame(points(), points(), index * 25);
    expect(analysis.getView(1600)).toMatchObject({ status: 'CALIBRATING', sampleCount: 0 });
    analysis.processFrame(points(), points(), 1700);
    expect(analysis.getView(1700)).toMatchObject({ status: 'CALIBRATING', sampleCount: 1, baseline: null });
  });

  it('calibrates HIP without waiting for a knee and completes that baseline independently later', () => {
    const analysis = new PoseFeatureAnalysis();
    analysis.startCalibration(0);
    const pose = points();
    pose[25].visibility = 0.1;
    for (let index = 1; index <= 20; index++) analysis.processFrame(pose, pose, index * 50);
    const view = analysis.getView(1000);
    expect(view).toMatchObject({ status: 'CALIBRATED', sampleCount: 20,
      sampleCounts: { hipCenterX: 20, leftKneeRelativeX: 0, rightKneeRelativeX: 20 },
      baseline: { hipCenterX: 0.5, leftKneeRelativeX: null, leftKneeRelativeY: null, rightKneeRelativeX: 0 },
      readiness: { hips: { ready: true, sampleCount: 20 }, leftKnee: { ready: false, sampleCount: 0 }, rightKnee: { ready: true, sampleCount: 20 } },
      calibrated: { deltaLeftKneeRelativeX: null, deltaLeftKneeRelativeY: null },
    });
    expect(view.raw.leftKneeVisibility).toBe(0.1);
    expect(view.raw.leftKneeRelativeX).toBe(0);
    pose[25].visibility = 0.5;
    pose[23].x = 0.7;
    pose[25].x = 0.9;
    for (let index = 21; index <= 28; index++) analysis.processFrame(pose, pose, index * 50);
    expect(analysis.getView(1400)).toMatchObject({ status: 'CALIBRATED',
      readiness: { leftKnee: { ready: false, sampleCount: 8 } }, calibrated: { deltaLeftKneeRelativeX: null } });
    for (let index = 29; index <= 40; index++) analysis.processFrame(pose, pose, 1400 + (index - 28) * 40);
    const complete = analysis.getView(2000);
    expect(complete.readiness.leftKnee).toEqual({ ready: true, sampleCount: 20 });
    expect(complete.baseline?.leftKneeRelativeX).toBeCloseTo(0.2);
    expect(complete.baseline?.hipCenterX).toBe(0.5);
    expect(complete.calibrated.deltaLeftKneeRelativeX).toBe(0);
  });

  it('requires world hip depth to complete HIP readiness, while preserving ready image baselines', () => {
    const analysis = new PoseFeatureAnalysis();
    analysis.startCalibration(0);
    for (let index = 1; index <= 20; index++) analysis.processFrame(points(), [], index * 50);
    expect(analysis.getView(1000)).toMatchObject({ status: 'CALIBRATING',
      readiness: { hips: { ready: false, sampleCount: 0 } },
      baseline: { hipCenterX: 0.5, hipDepthDifference: null }, calibrated: { deltaHipDepthDifference: null } });
    for (let index = 21; index <= 40; index++) analysis.processFrame(points(0.2), points(), index * 50);
    expect(analysis.getView(2000)).toMatchObject({ status: 'CALIBRATED',
      readiness: { hips: { ready: true, sampleCount: 20 } }, baseline: { hipCenterX: 0.5, hipDepthDifference: 0 } });
  });

  it('calibrates all required HIP features with zero samples from either knee', () => {
    const analysis = new PoseFeatureAnalysis();
    analysis.startCalibration(0);
    const pose = points();
    pose[25].visibility = 0;
    pose[26].visibility = 0;
    for (let index = 1; index <= 20; index++) analysis.processFrame(pose, pose, index * 50);
    expect(analysis.getView(1000)).toMatchObject({ status: 'CALIBRATED', sampleCount: 20,
      readiness: { hips: { ready: true }, leftKnee: { ready: false, sampleCount: 0 }, rightKnee: { ready: false, sampleCount: 0 } },
      calibrated: { deltaLeftKneeRelativeX: null, deltaLeftKneeRelativeY: null, deltaRightKneeRelativeX: null, deltaRightKneeRelativeY: null },
      smoothed: { validNow: true, values: { deltaHipCenterX: 0, deltaLeftKneeRelativeX: null, deltaRightKneeRelativeX: null } },
    });
  });

  it.each([0.499, 0.5])('uses the independent 0.5 knee visibility boundary (visibility %s)', (visibility) => {
    const analysis = new PoseFeatureAnalysis();
    analysis.startCalibration(0);
    const pose = points();
    pose[25].visibility = visibility;
    for (let index = 1; index <= 20; index++) analysis.processFrame(pose, pose, index * 50);
    const valid = visibility >= 0.5;
    expect(analysis.getView(1000)).toMatchObject({ status: 'CALIBRATED',
      readiness: { leftKnee: { ready: valid, sampleCount: valid ? 20 : 0 } },
      baseline: { leftKneeRelativeX: valid ? 0 : null, leftKneeRelativeY: valid ? 0 : null },
    });
  });

  it.each([0.699, 0.7])('keeps the 0.7 hip visibility boundary (visibility %s)', (visibility) => {
    const analysis = new PoseFeatureAnalysis();
    analysis.startCalibration(0);
    const pose = points();
    pose[23].visibility = visibility;
    for (let index = 1; index <= 20; index++) analysis.processFrame(pose, pose, index * 50);
    const valid = visibility >= 0.7;
    expect(analysis.getView(1000)).toMatchObject({ status: valid ? 'CALIBRATED' : 'CALIBRATING',
      readiness: { hips: { ready: valid, sampleCount: valid ? 20 : 0 } },
      sampleCounts: { hipCenterX: valid ? 20 : 0, hipCenterY: valid ? 20 : 0, hipDepthDifference: valid ? 20 : 0 },
    });
  });

  it('collects missing knee axes independently and freezes the remaining partial axis at the grace deadline', () => {
    const analysis = new PoseFeatureAnalysis();
    analysis.startCalibration(0);
    const pose = points();
    pose[25].y = NaN;
    for (let index = 1; index <= 20; index++) analysis.processFrame(pose, pose, index * 50);
    expect(analysis.getView(1000)).toMatchObject({ status: 'CALIBRATED',
      baseline: { leftKneeRelativeX: 0, leftKneeRelativeY: null },
      readiness: { leftKnee: { ready: false, sampleCount: 0 } },
    });
    pose[25].y = 0.7;
    for (let index = 21; index <= 28; index++) analysis.processFrame(pose, pose, index * 50);
    expect(analysis.getView(1400).readiness.leftKnee.sampleCount).toBe(8);
    expect(analysis.getView(2500)).toMatchObject({ status: 'CALIBRATED',
      collectionState: 'FROZEN',
      readiness: { leftKnee: { ready: false, sampleCount: 8 }, hips: { ready: true, sampleCount: 20 } },
      baseline: { leftKneeRelativeX: 0, leftKneeRelativeY: null },
    });
    for (let index = 1; index <= 20; index++) analysis.processFrame(pose, pose, 2500 + index * 50);
    expect(analysis.getView(3500).readiness.leftKnee).toEqual({ ready: false, sampleCount: 8 });
    expect(analysis.getView(3500).baseline?.leftKneeRelativeY).toBeNull();
  });

  it('keeps hip smoothing available when only a knee is occluded and expires stale values', () => {
    const analysis = new PoseFeatureAnalysis();
    calibrate(analysis);
    const pose = points(0.1);
    pose[25].visibility = 0.2;
    pose[25].x = 0.9;
    analysis.processFrame(pose, pose, 1100);
    const view = analysis.getView(1100);
    expect(view.raw.leftKneeVisibility).toBe(0.2);
    expect(view.calibrated.deltaLeftKneeRelativeX).toBeCloseTo(0.3);
    expect(view.smoothed.values.deltaLeftKneeRelativeX).toBeNull();
    expect(view.smoothed.validNow).toBe(true);
    expect(view.smoothed.values.deltaHipCenterX).toBeCloseTo(0.05);
    analysis.processFrame([], [], 1120);
    expect(analysis.getView(1120).calibrated.deltaHipCenterX).toBeNull();
    expect(analysis.getView(1120).smoothed).toMatchObject({ validNow: false, lastValidAt: 1100 });
    expect(analysis.getView(1120).smoothed.values.deltaHipCenterX).toBeNull();
    expect(analysis.getView(1500).smoothed.values.deltaHipCenterX).toBeNull();
    expect(analysis.getView(2500).raw.hipCenterX).toBeNull();
  });

  it('reset clears baseline, pending calibration, raw values and smoothing buffers', () => {
    const analysis = new PoseFeatureAnalysis();
    calibrate(analysis);
    analysis.processFrame(points(0.1), points(), 1100);
    analysis.reset();
    const view = analysis.getView(1100);
    expect(view).toMatchObject({ status: 'NOT CALIBRATED', baseline: null, sampleCount: 0 });
    expect(Object.values(view.raw).every((value) => value === null)).toBe(true);
    expect(Object.values(view.smoothed.values).every((value) => value === null)).toBe(true);
    expect(view.smoothed).toMatchObject({ validNow: false, lastValidAt: null });
    analysis.startCalibration(1100);
    analysis.processFrame(points(), points(), 1150);
    analysis.reset();
    analysis.processFrame(points(), points(), 2200);
    expect(analysis.getView(2200).status).toBe('NOT CALIBRATED');
  });

  it.each(['pose', 'world hip', 'image hip', 'hip visibility'])('immediately masks smoothing after missing/invalid %s', (missing) => {
    const analysis = new PoseFeatureAnalysis();
    calibrate(analysis);
    const pose = points();
    const world = points();
    if (missing === 'pose') pose.length = 0;
    if (missing === 'world hip') world.length = 0;
    if (missing === 'image hip') pose[23].x = NaN;
    if (missing === 'hip visibility') pose[23].visibility = 0.69;
    analysis.processFrame(pose, world, 1010);
    const { smoothed } = analysis.getView(1010);
    expect(smoothed).toMatchObject({ validNow: false, lastValidAt: 1000 });
    expect(Object.values(smoothed.values)).toEqual(Array(7).fill(null));
  });

  it('resumes after a short pose loss and clears history after a long loss, retaining the baseline', () => {
    const analysis = new PoseFeatureAnalysis();
    calibrate(analysis);
    analysis.processFrame(points(0.2), points(), 1050);
    analysis.processFrame([], [], 1075);
    expect(analysis.getView(1075).smoothed.validNow).toBe(false);
    analysis.processFrame(points(0.3), points(), 1100);
    const recovered = analysis.getView(1100);
    expect(recovered.smoothed).toMatchObject({ validNow: true, lastValidAt: 1100 });
    expect(recovered.smoothed.values.deltaHipCenterX).toBeCloseTo(0.2);
    analysis.processFrame([], [], 1125);
    expect(Object.values(analysis.getView(1500).smoothed.values)).toEqual(Array(7).fill(null));
    analysis.processFrame(points(0.8), points(), 1600);
    expect(analysis.getView(1600).smoothed.values.deltaHipCenterX).toBeCloseTo(0.8);
    expect(analysis.getView(1600).smoothed).toMatchObject({ validNow: true, lastValidAt: 1600 });
    expect(analysis.getView(1600).baseline?.hipCenterX).toBe(0.5);
  });

  it('invalidates stalled video delivery after the smoothing window without needing a missing-pose frame', () => {
    const analysis = new PoseFeatureAnalysis();
    calibrate(analysis);
    expect(analysis.getView(1399).smoothed.validNow).toBe(true);
    expect(analysis.getView(1400).smoothed).toMatchObject({ validNow: false, lastValidAt: 1000 });
    expect(Object.values(analysis.getView(1400).smoothed.values)).toEqual(Array(7).fill(null));
    analysis.processFrame(points(0.4), points(), 1500);
    expect(analysis.getView(1500).smoothed.values.deltaHipCenterX).toBeCloseTo(0.4);
  });
});

describe('bounded knee calibration grace period', () => {
  function hipReady() {
    const analysis = new PoseFeatureAnalysis();
    analysis.startCalibration(0);
    const pose = points();
    pose[25].visibility = 0;
    pose[26].visibility = 0;
    for (let index = 1; index <= 20; index++) analysis.processFrame(pose, pose, index * 50);
    return analysis;
  }

  it('collects pending knees only before the deadline and never changes baselines/counts from later motion', () => {
    const analysis = hipReady();
    expect(analysis.getView(1000)).toMatchObject({ status: 'CALIBRATED', collectionState: 'FINISHING', hipReadyAt: 1000, kneeGraceRemainingMs: 1000 });
    for (let index = 1; index <= 19; index++) analysis.processFrame(points(), points(), 1000 + index * 50);
    expect(analysis.getView(1999)).toMatchObject({ collectionState: 'FINISHING', kneeGraceRemainingMs: 1,
      readiness: { leftKnee: { ready: false, sampleCount: 19 }, rightKnee: { ready: false, sampleCount: 19 } } });
    // This would be sample 20; the deadline frame must not enter calibration.
    analysis.processFrame(points(0.5), points(), 2000);
    const frozen = analysis.getView(2000);
    expect(frozen).toMatchObject({ status: 'CALIBRATED', collectionState: 'FROZEN', hipReadyAt: 1000, kneeGraceRemainingMs: 0,
      baseline: { leftKneeRelativeX: null, leftKneeRelativeY: null, rightKneeRelativeX: null, rightKneeRelativeY: null },
      calibrated: { deltaLeftKneeRelativeX: null, deltaRightKneeRelativeX: null } });
    for (let index = 1; index <= 60; index++) {
      const moving = points(index);
      moving[25].x = -index;
      moving[26].y = index;
      analysis.processFrame(moving, moving, 2000 + index * 50);
    }
    const later = analysis.getView(10000);
    expect(later.baseline).toEqual(frozen.baseline);
    expect(later.sampleCounts).toEqual(frozen.sampleCounts);
    expect(later.readiness).toEqual(frozen.readiness);
    expect(later.readiness.leftKnee.sampleCount).toBe(19);
  });

  it('freezes at the same deadline without new frames or timely UI polling', () => {
    const analysis = hipReady();
    for (let index = 1; index <= 8; index++) analysis.processFrame(points(), points(), 1000 + index * 50);
    expect(analysis.getView(1400)).toMatchObject({ collectionState: 'FINISHING', kneeGraceRemainingMs: 600 });
    const frozen = analysis.getView(10000);
    expect(frozen).toMatchObject({ collectionState: 'FROZEN', kneeGraceRemainingMs: 0,
      readiness: { leftKnee: { ready: false, sampleCount: 8 }, rightKnee: { ready: false, sampleCount: 8 } } });
    analysis.processFrame(points(), points(), 10050);
    expect(analysis.getView(10050).sampleCounts).toEqual(frozen.sampleCounts);
    expect(analysis.getView(10050).baseline).toEqual(frozen.baseline);
  });

  it('freezes early when both knees obtain 20 valid samples within the grace period', () => {
    const analysis = hipReady();
    const pose = points();
    pose[25].x = 0.7;
    pose[26].x = 0.8;
    for (let index = 1; index <= 20; index++) analysis.processFrame(pose, pose, 1000 + index * 30);
    const ready = analysis.getView(1600);
    expect(ready).toMatchObject({ collectionState: 'FROZEN', kneeGraceRemainingMs: 0, hipReadyAt: 1000,
      readiness: { leftKnee: { ready: true, sampleCount: 20 }, rightKnee: { ready: true, sampleCount: 20 } } });
    expect(ready.baseline?.leftKneeRelativeX).toBeCloseTo(0.2);
    expect(ready.baseline?.rightKneeRelativeX).toBeCloseTo(0.3);
    analysis.processFrame(points(99), points(99), 1700);
    expect(analysis.getView(1700).baseline).toEqual(ready.baseline);
    expect(analysis.getView(1700).sampleCounts).toEqual(ready.sampleCounts);
  });

  it('starts the grace clock at the first HIP READY frame, not at the calibration button click', () => {
    const analysis = new PoseFeatureAnalysis();
    analysis.startCalibration(0);
    const pose = points();
    pose[25].visibility = 0;
    pose[26].visibility = 0;
    for (let index = 1; index <= 20; index++) analysis.processFrame(pose, [], index * 50);
    expect(analysis.getView(1000)).toMatchObject({ collectionState: 'HIP', hipReadyAt: null });
    for (let index = 21; index <= 40; index++) analysis.processFrame(pose, pose, index * 50);
    expect(analysis.getView(2000)).toMatchObject({ collectionState: 'FINISHING', hipReadyAt: 2000, kneeGraceRemainingMs: 1000 });
    analysis.processFrame(pose, pose, 2500);
    expect(analysis.getView(2999)).toMatchObject({ collectionState: 'FINISHING', hipReadyAt: 2000, kneeGraceRemainingMs: 1 });
    expect(analysis.getView(3000).collectionState).toBe('FROZEN');
  });

  it.each(['FINISHING', 'FROZEN'])('recalibration resets baselines, buffers and the grace clock from %s', (state) => {
    const analysis = hipReady();
    if (state === 'FROZEN') analysis.getView(2000);
    analysis.startCalibration(3000);
    const restarted = analysis.getView(3000);
    expect(restarted).toMatchObject({ status: 'CALIBRATING', collectionState: 'HIP', hipReadyAt: null,
      kneeGraceRemainingMs: 0, baseline: null, sampleCount: 0, smoothed: { validNow: false, lastValidAt: null } });
    expect(Object.values(restarted.sampleCounts)).toEqual(Array(7).fill(0));
    expect(Object.values(restarted.smoothed.values)).toEqual(Array(7).fill(null));
    const pose = points(0.3);
    pose[25].visibility = 0;
    for (let index = 1; index <= 20; index++) analysis.processFrame(pose, pose, 3000 + index * 50);
    expect(analysis.getView(4000)).toMatchObject({ status: 'CALIBRATED', collectionState: 'FINISHING', hipReadyAt: 4000, kneeGraceRemainingMs: 1000 });
    expect(analysis.getView(4000).baseline?.hipCenterX).toBeCloseTo(0.8);
    pose[25].visibility = 0.9;
    for (let index = 1; index <= 20; index++) analysis.processFrame(pose, pose, 4000 + index * 20);
    expect(analysis.getView(4400)).toMatchObject({ collectionState: 'FROZEN', readiness: { leftKnee: { ready: true } } });
    analysis.reset();
    expect(analysis.getView(4400)).toMatchObject({ status: 'NOT CALIBRATED', collectionState: 'IDLE', hipReadyAt: null, kneeGraceRemainingMs: 0 });
  });
});

describe('400 ms feature median smoothing', () => {
  const deltas = (value: number | null) => ({ ...calibratePoseFeatures(extractPoseFeatures([]), null), deltaHipCenterX: value });

  it('uses only samples inside the recent time window, expiring even without incoming frames', () => {
    const smoother = new PoseFeatureSmoother();
    smoother.add(deltas(100), 0);
    smoother.add(deltas(0.1), 300);
    smoother.add(deltas(0.2), 400);
    expect(smoother.get(400).deltaHipCenterX).toBeCloseTo(0.15);
    expect(smoother.get(700).deltaHipCenterX).toBe(0.2);
    expect(smoother.get(800).deltaHipCenterX).toBeNull();
  });

  it('resists a one-frame spike and does not mutate or retain caller objects', () => {
    const smoother = new PoseFeatureSmoother();
    const input = deltas(0.2);
    smoother.add(deltas(0.1), 0);
    smoother.add(deltas(99), 33);
    smoother.add(input, 66);
    input.deltaHipCenterX = 999;
    expect(smoother.get(100).deltaHipCenterX).toBe(0.2);
    expect(smoother.get(100).deltaHipCenterY).toBeNull();
  });

  it('safely skips missing feature values and resets all history', () => {
    const smoother = new PoseFeatureSmoother();
    smoother.add(deltas(0), 10);
    smoother.add(deltas(null), 20);
    expect(smoother.get(30).deltaHipCenterX).toBe(0);
    smoother.reset();
    expect(Object.values(smoother.get(30))).toEqual(Array(7).fill(null));
  });
});
