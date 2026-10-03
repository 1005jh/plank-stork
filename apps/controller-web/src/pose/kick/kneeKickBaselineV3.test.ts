// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PoseFeatureAnalysis } from '../features/poseFeatureAnalysis';
import { extractKneeMotionFeatures } from '../motion/kneeMotionFeatures';
import { motionFrame } from '../motion/testFixtures';
import { KneeKickAnalysis } from './kneeKickAnalysis';
import { buildKneeKickBaselineV3 } from './kneeKickBaselineV3';

function calibration(missingLeft = false) {
  const neutral = new PoseFeatureAnalysis(), kick = new KneeKickAnalysis(); neutral.startCalibration(0);
  const send = (t: number, yShift = 0) => {
    const frame = motionFrame(t); frame.landmarks[25].y += yShift;
    if (missingLeft) frame.landmarks[25].visibility = 0.49;
    neutral.processFrame(frame.landmarks, frame.worldLandmarks, t);
    kick.processFrame(frame, neutral.getView(t));
  };
  for (let t = 50; t <= 1000; t += 50) send(t);
  return { neutral, kick, send };
}
describe('production Y features and Neutral baseline', () => {
  it('extracts hipCenterY, both knee Y and knee minus hipCenterY; translation leaves offsets unchanged', () => {
    const f = motionFrame(0), a = extractKneeMotionFeatures(f.landmarks);
    expect(a.hipCenterY).toBe(0.4); expect(a.leftKneeY).toBe(0.7); expect(a.rightKneeY).toBe(0.7);
    expect(a.leftKneeCenterOffsetY).toBeCloseTo(0.3); expect(a.rightKneeCenterOffsetY).toBeCloseTo(0.3);
    f.landmarks.forEach((p) => { p.y += 0.1; }); const b = extractKneeMotionFeatures(f.landmarks);
    expect(b.leftKneeCenterOffsetY).toBeCloseTo(a.leftKneeCenterOffsetY!);
    f.landmarks[25].y = NaN; expect(extractKneeMotionFeatures(f.landmarks)).toMatchObject({ leftKneeY: null, leftKneeCenterOffsetY: null });
    expect(extractKneeMotionFeatures([])).toMatchObject({ hipCenterY: null, rightKneeCenterOffsetY: null });
  });
  it('freezes V3 in the same production Neutral window, then ignores movement and trial resets', () => {
    const { kick, send } = calibration(), snapshot = kick.getReplaySnapshot(), b = snapshot.baselineV3!;
    expect(b).toMatchObject({ version: 3, leftXMedian: snapshot.detector.baseline!.leftMedian, rightXMedian: snapshot.detector.baseline!.rightMedian,
      bodyScale: snapshot.detector.baseline!.bodyScale });
    expect(b.leftYMedian).toBeCloseTo(0.3); expect(b.rightYMedian).toBeCloseTo(0.3);
    send(1050, 0.5); send(1100, 0.7); expect(kick.getReplaySnapshot().baselineV3).toEqual(b);
    kick.startTest(1200); kick.resetTest(1250); expect(kick.getReplaySnapshot().baselineV3).toEqual(b);
    b.leftYMedian = 999; expect(kick.getReplaySnapshot().baselineV3!.leftYMedian).toBeCloseTo(0.3);
    kick.reset(1300, 'RECALIBRATION'); expect(kick.getReplaySnapshot().baselineV3).toBeNull();
  });
  it('does not fill a partial baseline with zero or collect beyond expired grace', () => {
    const { kick, send, neutral } = calibration(true);
    for (let t = 1050; t <= 2000; t += 50) send(t);
    expect(kick.getReplaySnapshot().baselineV3).toBeNull();
    for (let t = 2050; t < 4000; t += 50) kick.processFrame(motionFrame(t), neutral.getView(t));
    expect(kick.getView(4000)).toMatchObject({ baselineSealed: true, baselineV3: null });
  });
  it('uses component medians and independent visibility guards, without deriving direction from signs', () => {
    const sample = extractKneeMotionFeatures(motionFrame(0).landmarks);
    const samples = Array.from({ length: 21 }, (_, i) => ({ ...sample, leftKneeCenterOffsetY: i === 20 ? 100 : -0.3, rightKneeCenterOffsetY: 0.4 }));
    expect(buildKneeKickBaselineV3(samples)).toMatchObject({ leftYMedian: -0.3, rightYMedian: 0.4 });
    samples[0].leftKneeVisibility = 0.49; samples[1].leftKneeVisibility = 0.49;
    expect(buildKneeKickBaselineV3(samples)).toBeNull();
    expect(buildKneeKickBaselineV3([sample])).toBeNull();
  });
});
