// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { flexionBaseline, flexionIncrease, kneeAngle } from './multiSignalFeatures';
import { copyPoseFrame } from '../replay/replayTypes';
import { motionFrame } from '../pose/motion/testFixtures';
import { fullV3Trial, liveHarness, ORIGIN, TRIAL_AT } from '../replay/testFixtures';
import { latestCalibrationStart, replayCalibration } from '../replay/landmarkReplay';
import { resolveV3ReplayBaseline } from '../replay/kneeKickV3Replay';

describe('independent normalized image XY flexion / frozen Neutral baseline', () => {
  it('measures hip-knee-ankle at the knee and clamps extension, without abs or opposite-limb/Z gating', () => {
    const p = copyPoseFrame(motionFrame(0), 0, 0).landmarks;
    Object.assign(p[23], { x: 0, y: 1 }); Object.assign(p[25], { x: 0, y: 0 }); Object.assign(p[27], { x: 1, y: 0 });
    p[24].visibility = 0; p[26].visibility = 0; p[28].visibility = 0; p[23].z = NaN;
    expect(kneeAngle(p, 'LEFT')).toBe(90); expect(kneeAngle(p, 'RIGHT')).toBeNull();
    expect(flexionIncrease(170, 90)).toBe(80); expect(flexionIncrease(170, 179)).toBe(0);
    expect(flexionIncrease(null, 90)).toBeNull(); expect(flexionIncrease(170, null)).toBeNull();
  });
  it.each([23, 25, 27])('requires own landmark %i visibility >=.5 and finite XY only', (index) => {
    const p = copyPoseFrame(motionFrame(0), 0, 0).landmarks;
    p[index].visibility = .5; expect(kneeAngle(p, 'LEFT')).not.toBeNull();
    p[index].visibility = .499; expect(kneeAngle(p, 'LEFT')).toBeNull();
    p[index].visibility = null; expect(kneeAngle(p, 'LEFT')).toBeNull();
    p[index].visibility = 1; p[index].x = NaN; expect(kneeAngle(p, 'LEFT')).toBeNull();
  });
  it('does not invent angles for a missing ankle or zero-length limb', () => {
    const p = copyPoseFrame(motionFrame(0), 0, 0).landmarks;
    Object.assign(p[27], { x: p[25].x, y: p[25].y }); expect(kneeAngle(p, 'LEFT')).toBeNull();
    expect(kneeAngle(p.slice(0, 27), 'LEFT')).toBeNull();
  });
  it('selects the latest of two actual calibrations even with unsorted marker storage, matching saved V3 baseline', async () => {
    const live = liveHarness(true, 'Y_V3');
    const resetAt = ORIGIN + TRIAL_AT + 10;
    live.capture.observe({ kind: 'RESET', timestamp: resetAt }, () => live.kick.getReplaySnapshot()); live.kick.resetTest(resetAt);
    live.neutral.startCalibration(ORIGIN + 1400); live.capture.neutralStarted(ORIGIN + 1400);
    for (let t = 1450; t <= 2400; t += 50) {
      const f = motionFrame(ORIGIN + t); f.landmarks[25].y = .6; f.landmarks[26].y = .65; live.frame(f);
    }
    live.kick.startTest(ORIGIN + 2500);
    live.capture.observe({ kind: 'START', timestamp: ORIGIN + 2500 }, () => live.kick.getReplaySnapshot());
    const s = await live.finish(1500), trial = s.liveResult.trials[1];
    s.markers.reverse();
    expect(latestCalibrationStart(s, trial)?.tMs).toBe(1400);
    expect(replayCalibration(s, 2)).toMatchObject({ calibrationStartMs: 1400, kickBaselineV3Equal: true, neutralBaselineEqual: true });
    expect(trial.baselineV3).not.toEqual(s.liveResult.trials[0].baselineV3);
    const b = flexionBaseline(s, trial);
    expect(b).toMatchObject({ source: 'LATEST_CALIBRATION_WINDOW', calibrationStartMs: 1400, endMs: 2400, excludedStageIndex: null });
    expect(b.LEFT.neutralAngle).toBeCloseTo(kneeAngle(s.poseFrames.at(-1)!.landmarks, 'LEFT')!);
    // Later action/ankle frames can never move this frozen reference.
    s.poseFrames.push({ ...structuredClone(s.poseFrames.at(-1)!), tMs: 2600, order: 9999, landmarks: [] });
    expect(flexionBaseline(s, trial)).toEqual(b);
    delete trial.baselineV3;
    expect(resolveV3ReplayBaseline(s, trial).source).toBe('CALIBRATION_REPLAY');
  });
  it('keeps first-Neutral compatibility only for old setup-less captures and excludes that whole stage', async () => {
    const { session } = await fullV3Trial(), s = session!;
    delete s.detectorMode; delete s.liveResult.trials[0].baselineV3;
    s.markers = s.markers.filter((m) => m.type !== 'NEUTRAL_CALIBRATION_START' && m.type !== 'NEUTRAL_FROZEN');
    const b = flexionBaseline(s, s.liveResult.trials[0]);
    expect(b).toMatchObject({ source: 'FIRST_NEUTRAL_COMPATIBILITY', calibrationStartMs: null, startMs: TRIAL_AT, endMs: TRIAL_AT + 2000, excludedStageIndex: 0 });
    expect(b.LEFT.usableFrames).toBe(50);
    expect(resolveV3ReplayBaseline(s, s.liveResult.trials[0]).calibrationOnly).not.toBeNull();
  });
  it('does not silently use Guided movement if the latest actual calibration is unfinished', async () => {
    const { session } = await fullV3Trial(), s = session!;
    s.markers.push({ type: 'NEUTRAL_CALIBRATION_START', tMs: 1150, order: 999 });
    expect(() => flexionBaseline(s, s.liveResult.trials[0])).toThrow('FROZEN marker');
  });
  it('keeps a missing side baseline null rather than falling back to the other limb', async () => {
    const { session } = await fullV3Trial(), s = session!;
    s.poseFrames.filter((f) => f.tMs < TRIAL_AT).forEach((f) => { f.landmarks[28].visibility = 0; });
    expect(flexionBaseline(s, s.liveResult.trials[0])).toMatchObject({ LEFT: { usableFrames: 20 }, RIGHT: { neutralAngle: null, usableFrames: 0 } });
  });
});
