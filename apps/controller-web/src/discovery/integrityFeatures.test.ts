// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { integrityGeometry, integrityVelocity, segmentBaseline, prepareIntegrityInputs, distribution } from './integrityFeatures';
import { copyPoseFrame } from '../replay/replayTypes';
import { motionFrame } from '../pose/motion/testFixtures';
import { fullV3Trial, TRIAL_AT } from '../replay/testFixtures';

describe('frozen segment baselines / continuous primitive integrity features', () => {
  it('measures normalized image geometry and optional world geometry independently', () => {
    const f = copyPoseFrame(motionFrame(0), 0, 0);
    Object.assign(f.landmarks[23], { x: 0, y: 1, z: NaN, visibility: .5 });
    Object.assign(f.landmarks[25], { x: 0, y: 0, visibility: .5 }); Object.assign(f.landmarks[27], { x: 1, y: 0, visibility: .5 });
    f.landmarks[24].visibility = 0;
    const m = integrityGeometry(f.landmarks, [], 'LEFT');
    expect(m).toMatchObject({ hipKneeLength: 1, kneeAnkleLength: 1, kneeAngle: 90, worldKneeAngle: null });
    const world: typeof f.worldLandmarks = f.landmarks.map((p) => ({ ...p, z: 0, visibility: null }));
    expect(integrityGeometry(f.landmarks, world, 'LEFT')).toMatchObject({ worldHipKneeLength: 1, worldKneeAnkleLength: 1, worldKneeAngle: 90 });
    world[27].visibility = .49;
    expect(integrityGeometry(f.landmarks, world, 'LEFT').worldKneeAnkleLength).toBeNull();
  });
  it('distinguishes an unavailable ankle from a visible zero-length/collapsed segment', () => {
    const f = copyPoseFrame(motionFrame(0), 0, 0);
    f.landmarks[27].visibility = .49;
    expect(integrityGeometry(f.landmarks, f.worldLandmarks, 'LEFT')).toMatchObject({ kneeAnkleLength: null, kneeAngle: null });
    Object.assign(f.landmarks[27], { ...f.landmarks[25], visibility: .5 });
    expect(integrityGeometry(f.landmarks, f.worldLandmarks, 'LEFT')).toMatchObject({ kneeAnkleLength: 0, kneeAngle: null });
  });
  it('uses the latest exact Neutral window, not earlier calibration or later movements', async () => {
    const { session } = await fullV3Trial(), s = session!, trial = s.liveResult.trials[0];
    const initial = segmentBaseline(s, trial);
    s.markers.push({ type: 'NEUTRAL_CALIBRATION_START', tMs: 0, order: 0 }, { type: 'NEUTRAL_FROZEN', tMs: 50, order: 1 });
    s.markers.reverse();
    s.poseFrames.filter((f) => f.tMs >= trial.startMs).forEach((f) => { if (f.landmarks.length) f.landmarks[27].x = 20; });
    expect(segmentBaseline(s, trial)).toEqual(initial);
    expect(initial).toMatchObject({ calibrationStartMs: 100, startMs: 100, endMs: 1100, frameCount: 20 });
  });
  it('keeps old first-Neutral compatibility marked excluded and missing medians null', async () => {
    const { session } = await fullV3Trial(), s = session!, trial = s.liveResult.trials[0];
    s.markers = s.markers.filter((m) => m.type !== 'NEUTRAL_CALIBRATION_START' && m.type !== 'NEUTRAL_FROZEN');
    s.poseFrames.forEach((f) => { if (f.landmarks.length) f.landmarks[28].visibility = 0; });
    expect(segmentBaseline(s, trial)).toMatchObject({ source: 'FIRST_NEUTRAL_COMPATIBILITY', startMs: TRIAL_AT, endMs: TRIAL_AT + 2000,
      excludedStageIndex: 0, RIGHT: { kneeAnkle: { median: null, usableFrames: 0 } } });
  });
  it('uses signed adjacent derivatives, with no missing/duplicate/backward/400ms bridging', () => {
    expect(integrityVelocity(-.8, 0, 40)).toBe(-20);
    for (const dt of [0, -10, 400, 401]) expect(integrityVelocity(-.8, 0, dt)).toBeNull();
    expect(integrityVelocity(null, 0, 40)).toBeNull(); expect(integrityVelocity(.8, null, 40)).toBeNull();
  });
  it('extracts actual bodyScale-normalized Y/vector velocity and retains low visibility evidence separately', async () => {
    const { session } = await fullV3Trial();
    const [f] = prepareIntegrityInputs([{ filename: 'capture.json', role: 'REFERENCE_LIVE_2_INDEPENDENT', session: session! }]);
    const start = f.frames.find((r) => r.timestamp === TRIAL_AT + 12060)!;
    expect(start.measurements.LEFT.deltaDyNormVelocity).toBeCloseTo(15);
    expect(start.measurements.LEFT.kneeCenterRelative2DVelocity).toBeCloseTo(15);
    expect(f.frames.find((r) => r.timestamp === TRIAL_AT + 6060)!.measurements.LEFT).toMatchObject({ deltaDyNorm: null, deltaDyNormVelocity: null, kneeAngle: null });
    expect(f.liveReplayParity.matched).toBe(true); expect(f.input.role).toBe('REFERENCE_LIVE_2_INDEPENDENT');
  });
  it('reports coverage and signed tails rather than silently converting missing values to zero', () => {
    expect(distribution([null, -20, -2, 0, 2, 20])).toMatchObject({ frames: 6, usable: 5, coverage: 5 / 6, min: -20, p05: -20, median: 0, p95: 20, max: 20 });
    expect(distribution([null, null])).toMatchObject({ usable: 0, median: null, p95: null });
  });
});
