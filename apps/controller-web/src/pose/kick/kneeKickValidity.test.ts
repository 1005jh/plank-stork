// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PoseFeatureAnalysis } from '../features/poseFeatureAnalysis';
import type { PoseFrame } from '../../recorder/poseRecorderTypes';
import { motionFrame } from '../motion/testFixtures';
import { extractKneeMotionFeatures } from '../motion/kneeMotionFeatures';
import { KneeKickAnalysis } from './kneeKickAnalysis';
import { KneeKickDetector, usableKnees } from './kneeKickDetector';
import type { KickDiagnosticDataset } from './kneeKickDiagnostics';

function calibrated() {
  const neutral = new PoseFeatureAnalysis(), kick = new KneeKickAnalysis(null, 'LEGACY_X');
  neutral.startCalibration(0);
  for (let now = 50; now <= 1000; now += 50) {
    const frame = motionFrame(now);
    neutral.processFrame(frame.landmarks, frame.worldLandmarks, now);
    kick.processFrame(frame, neutral.getView(now));
  }
  return { neutral, kick };
}
function deliver(engine: ReturnType<typeof calibrated>, frame: PoseFrame) {
  engine.neutral.processFrame(frame.landmarks, frame.worldLandmarks, frame.timestamp);
  const neutral = engine.neutral.getView(frame.timestamp);
  engine.kick.processFrame(frame, neutral);
  return { neutral, ...engine.kick.getView(frame.timestamp) };
}

describe('Kick-specific frame usability', () => {
  it.each(['leftHipVisibility', 'rightHipVisibility'] as const)('rejects %s below 0.7 without changing the threshold', (key) => {
    const features = extractKneeMotionFeatures(motionFrame(0).landmarks);
    expect(usableKnees({ ...features, [key]: 0.699 })).toMatchObject({ hips: false, left: false, right: false, reasons: expect.arrayContaining(['HIP_VISIBILITY']) });
    expect(usableKnees({ ...features, [key]: 0.7 })).toMatchObject({ hips: true, left: true, right: true });
  });
  it.each(['left', 'right'] as const)('rejects only the %s knee below 0.5', (side) => {
    const features = extractKneeMotionFeatures(motionFrame(0).landmarks);
    expect(usableKnees({ ...features, [`${side}KneeVisibility`]: 0.499 })).toMatchObject({ hips: true, [side]: false, [side === 'left' ? 'right' : 'left']: true });
    expect(usableKnees({ ...features, [`${side}KneeVisibility`]: 0.5 })).toMatchObject({ left: true, right: true });
  });
  it.each(['hipCenterX', 'leftKneeX', 'rightKneeX', 'leftKneeCenterOffsetX', 'rightKneeCenterOffsetX', 'leftKneeHipDistance', 'rightKneeHipDistance'] as const)(
    'rejects missing/nonfinite required %s geometry', (key) => {
      for (const value of [null, NaN, Infinity]) {
        const usable = usableKnees({ ...extractKneeMotionFeatures(motionFrame(0).landmarks), [key]: value });
        if (key === 'hipCenterX') expect(usable).toMatchObject({ hips: false, left: false, right: false, reasons: ['HIP_GEOMETRY', 'NO_USABLE_KNEE'] });
        else expect(usable).toMatchObject({ hips: true, [key.startsWith('left') ? 'left' : 'right']: false, [key.startsWith('left') ? 'right' : 'left']: true });
      }
    },
  );
  it('has no dependency on optional pelvis projections/width and reports missing landmarks separately', () => {
    const values = extractKneeMotionFeatures(motionFrame(0).landmarks);
    expect(usableKnees({ ...values, hipWidth: null, leftKneePelvisProjection: null, rightKneePelvisProjection: null })).toMatchObject({ hips: true, left: true, right: true, reasons: ['OK'] });
    expect(usableKnees(extractKneeMotionFeatures([]))).toMatchObject({ hips: false, left: false, right: false, reasons: expect.arrayContaining(['NO_LANDMARKS', 'NO_USABLE_KNEE']) });
  });
  it('uses current delivery and geometry for remote validity, masks both sides at 400ms, and clears on reset', () => {
    const detector = new KneeKickDetector();
    detector.setBaseline({ leftMedian: -0.15, rightMedian: 0.15, leftDistanceMedian: 0.3, rightDistanceMedian: 0.3, bodyScale: 0.3 });
    detector.processFrame({ ...extractKneeMotionFeatures(motionFrame(0).landmarks), leftKneeVisibility: 0.49 }, 0);
    expect(detector.getView(399)).toMatchObject({ validNow: true, usableLeftNow: false, usableRightNow: true });
    expect(detector.getView(400)).toMatchObject({ validNow: false, usableLeftNow: false, usableRightNow: false });
    detector.processFrame(extractKneeMotionFeatures([]), 450);
    expect(detector.getView(450)).toMatchObject({ validNow: false, usableLeftNow: false, usableRightNow: false, lastEvent: null });
    detector.processFrame(extractKneeMotionFeatures(motionFrame(500).landmarks), 500);
    expect(detector.getView(500).validNow).toBe(true);
    detector.reset();
    expect(detector.getView(500)).toMatchObject({ ready: false, validNow: false, usableLeftNow: false, usableRightNow: false });
  });
});

describe('STEP 4A validity is diagnostic-only after Neutral FROZEN', () => {
  it('ignores invalid STEP 4A Y/depth/smoothed fields when current Kick geometry is usable', () => {
    const { neutral, kick } = calibrated();
    for (const time of [1050, 1100, 1150]) {
      const frame = motionFrame(time); frame.landmarks[26].x -= 0.15;
      const view = neutral.getView(time);
      view.raw.hipCenterY = null; view.raw.hipDepthDifference = null;
      view.calibrated.deltaHipCenterY = null; view.calibrated.deltaHipDepthDifference = null;
      view.smoothed.validNow = false;
      view.smoothed.values.deltaHipCenterY = null; view.smoothed.values.deltaHipDepthDifference = null;
      kick.processFrame(frame, view);
    }
    expect(kick.getView(1150).detector).toMatchObject({ validNow: true, usableLeftNow: true, usableRightNow: true, lastEvent: { direction: 'KNEE_LEFT', timestamp: 1150 } });
  });
  it('accepts real missing world/depth frames, starts without 4A validity, and records both validities without gating raw diagnostics', () => {
    const engine = calibrated();
    const withoutDepth = (time: number, delta = 0) => {
      const frame = motionFrame(time); frame.worldLandmarks = []; frame.landmarks[26].x += delta; return frame;
    };
    expect(deliver(engine, withoutDepth(1050)).neutral.smoothed.validNow).toBe(false);
    expect(engine.kick.startTest(1050)).toBe(true);
    deliver(engine, withoutDepth(1075));
    for (const time of [1100, 1150, 1200]) {
      const view = deliver(engine, withoutDepth(time, -0.15));
      expect(view.neutral.raw.hipDepthDifference).toBeNull();
      expect(view.neutral.smoothed.validNow).toBe(false);
      expect(view.detector.validNow).toBe(true);
    }
    expect(engine.kick.getView(1200).detector.lastEvent).toEqual({ id: 1, direction: 'KNEE_LEFT', timestamp: 1200 });
    const rejected = withoutDepth(1250, -0.15); rejected.landmarks[23].visibility = 0.69;
    deliver(engine, rejected);
    const missing = withoutDepth(1300); missing.landmarks = []; deliver(engine, missing);
    for (let time = 1350; time <= 23500; time += 50) deliver(engine, withoutDepth(time));
    const dataset = JSON.parse(engine.kick.exportDiagnosticsJson()) as KickDiagnosticDataset;
    expect(dataset.version).toBe(3);
    expect(dataset.frames[0]).toMatchObject({ neutralSmoothedValidNow: false, kickHipsUsable: true, kickLeftUsable: true, kickRightUsable: true, poseFresh: true, kickValidityReasons: ['OK'], inferenceGapMs: null,
      rawHipCenterX: 0.5, rawLeftHipVisibility: 0.95, rawRightHipVisibility: 0.95, rawLeftKneeVisibility: 0.7, rawRightKneeVisibility: 0.6 });
    const row = dataset.frames.find((frame) => frame.timestamp === 1250)!;
    expect(row).toMatchObject({ neutralSmoothedValidNow: false, poseFresh: false, kickHipsUsable: false, normalizedRight: null,
      rawHipCenterX: 0.5, rawRightKneeX: 0.5, kickValidityReasons: expect.arrayContaining(['HIP_VISIBILITY']) });
    expect(row.rawRightKneeCenterOffsetX).toBe(0);
    expect(row.rawRightKneeHipDistance).toBeGreaterThan(0);
    expect(dataset.frames.find((frame) => frame.timestamp === 1300)).toMatchObject({ rawHipCenterX: null, kickValidityReasons: expect.arrayContaining(['NO_LANDMARKS']) });
    expect(dataset.stageSummaries[0]).toMatchObject({ neutralInvalidFrames: 40, kickAnyUsableFrames: 38, kickBothUsableFrames: 38, neutralInvalidButKickUsableFrames: 38, hipRejectedFrames: 2, leftVisibilityRejectedFrames: 1, rightVisibilityRejectedFrames: 1 });
    // The fixed timeline continues even though 4A remained invalid throughout this test.
    expect(dataset.stageTimings[0].armedWaitMs).toBe(0);
    expect(dataset.frames.every((frame) => !('landmarks' in frame) && !('worldLandmarks' in frame))).toBe(true);
    engine.kick.reset();
    expect(engine.kick.getDiagnosticSummary()).toEqual([]);
    expect(JSON.parse(engine.kick.exportDiagnosticsJson()).status).toBe('COMPLETED');
  });
  it.each([25, 26])('starts and permits ongoing inference with landmark %s unavailable', (index) => {
    const engine = calibrated();
    const frame = motionFrame(1050); frame.landmarks[index].visibility = 0.49;
    expect(deliver(engine, frame).detector).toMatchObject({ ready: true, state: 'ARMED', validNow: true });
    expect(engine.kick.startTest(1050)).toBe(true);
    deliver(engine, motionFrame(1100)); expect(engine.kick.startTest(1100)).toBe(false);
    frame.timestamp = 1150;
    expect(deliver(engine, frame).test.status).toBe('ACTIVE');
  });
  it('still cancels a candidate across a 400ms inference delivery gap despite valid geometry on return', () => {
    const engine = calibrated();
    const frame = motionFrame(1050); frame.landmarks[26].x -= 0.15; frame.worldLandmarks = [];
    expect(deliver(engine, frame).detector.state).toBe('CANDIDATE');
    frame.timestamp = 1450;
    expect(deliver(engine, frame).detector).toMatchObject({ state: 'WAIT_CLEAR', validNow: true, lastEvent: null, counts: { KNEE_LEFT: 0, KNEE_RIGHT: 0 } });
  });
});
