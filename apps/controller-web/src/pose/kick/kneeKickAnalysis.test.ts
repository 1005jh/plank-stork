// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PoseFeatureAnalysis } from '../features/poseFeatureAnalysis';
import { motionFrame } from '../motion/testFixtures';
import { KneeKickAnalysis } from './kneeKickAnalysis';

describe('detector Neutral baseline lifecycle', () => {
  function calibrate(missingLeft = false, degenerate = false) {
    const neutral = new PoseFeatureAnalysis(), kick = new KneeKickAnalysis(); neutral.startCalibration(0);
    const frame = (time: number) => {
      const result = motionFrame(time);
      if (missingLeft) result.landmarks[25].visibility = 0.1;
      if (degenerate) { result.landmarks[25] = { ...result.landmarks[23] }; result.landmarks[26] = { ...result.landmarks[24] }; }
      neutral.processFrame(result.landmarks, result.worldLandmarks, time);
      kick.processFrame(result, neutral.getView(time));
    };
    for (let time = 50; time < 1000; time += 50) frame(time);
    expect(kick.getView(950).detector.ready).toBe(false);
    frame(1000);
    return { neutral, kick, frame };
  }
  it('freezes center-offset medians and the mean of distance medians only after Neutral FROZEN', () => {
    const { kick, neutral } = calibrate();
    const view = kick.getView(1000);
    expect(view).toMatchObject({ baselineCounts: { left: 20, right: 20 }, baselineSealed: true, detector: { ready: true, state: 'ARMED' } });
    expect(view.detector.baseline!.leftMedian).toBeCloseTo(-0.15);
    expect(view.detector.baseline!.rightMedian).toBeCloseTo(0.15);
    expect(view.detector.baseline!.bodyScale).toBeCloseTo(Math.hypot(0.05, 0.3));
    const moving = motionFrame(1050); moving.landmarks[26].x -= 0.15;
    kick.processFrame(moving, neutral.getView(1050));
    expect(kick.getView(1050).detector.lastEvent?.direction).toBe('KNEE_LEFT');
    expect(kick.getView(1050).detector.baseline).toEqual(view.detector.baseline);
  });

  it('does not continue collecting an incomplete baseline after grace expires', () => {
    const { kick, neutral, frame } = calibrate(true);
    for (let time = 1050; time <= 2000; time += 50) frame(time);
    expect(kick.getView(2000)).toMatchObject({ baselineSealed: true, detector: { ready: false } });
    const before = kick.getView(2000).baselineCounts;
    for (let time = 2050; time <= 4000; time += 50) kick.processFrame(motionFrame(time), neutral.getView(time));
    expect(kick.getView(4000)).toMatchObject({ baselineCounts: before, detector: { ready: false } });
  });

  it('rejects near-zero scale even when Neutral calibration itself is ready', () => {
    const { kick, neutral } = calibrate(false, true);
    expect(neutral.getView(1000).collectionState).toBe('FROZEN');
    expect(kick.getView(1000).detector.ready).toBe(false);
  });

  it('clears test, baseline, event counts and freeze state on reset/recalibration', () => {
    const { kick } = calibrate();
    expect(kick.startTest(1000)).toBe(true);
    kick.reset();
    expect(kick.getView(1000)).toMatchObject({ baselineSealed: false, baselineCounts: { left: 0, right: 0 }, detector: { ready: false, lastEvent: null }, test: { status: 'IDLE' } });
    expect(kick.startTest(1000)).toBe(false);
  });
});
