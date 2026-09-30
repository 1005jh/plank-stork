// @vitest-environment node
import { motionFrame } from '../pose/motion/testFixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { replayCalibration, replayLandmarks } from './landmarkReplay';
import { fullTrial, liveHarness, ORIGIN, TRIAL_AT } from './testFixtures';
import { readReplaySession } from './readReplaySession';

afterEach(() => vi.restoreAllMocks());
describe('production live vs deterministic recorded pose replay', () => {
  it('matches LEFT/RIGHT, exact event timestamps, counts, final state and all stage summaries', async () => {
    const { session } = await fullTrial();
    const result = replayLandmarks(readReplaySession(JSON.stringify(session)), 1);
    expect(result.comparison).toMatchObject({ eventsEqual: true, finalStateEqual: true, guidedSummaryEqual: true });
    expect(result.result).toEqual(session.liveResult.trials[0].result);
    expect(result.result.events).toEqual([
      { id: 1, direction: 'KNEE_LEFT', tMs: TRIAL_AT + 12140 },
      { id: 2, direction: 'KNEE_RIGHT', tMs: TRIAL_AT + 17140 },
    ]);
    expect(result.result.guidedSummary).toMatchObject({ TWIST_LEFT: { falseKickCount: 0 }, TWIST_RIGHT: { falseKickCount: 0 }, NEUTRAL: { falseKickCount: 0 },
      KNEE_LEFT: { detected: true, directionCorrect: true }, KNEE_RIGHT: { detected: true, directionCorrect: true } });
  });
  it('preserves the reported clean-summary contract: 661 frames / 657 usable / exact LEFT time / ARMED, twice', async () => {
    // Synthetic landmark fixture matching the reported summary, NOT the user's private clean capture.
    const live = liveHarness(), start = ORIGIN + 8000, eventAt = 20377.09999847412;
    live.capture.observe({ kind: 'RESET', timestamp: start }, () => live.kick.getReplaySnapshot());
    live.kick.resetTest(start); live.kick.startTest(start);
    live.capture.observe({ kind: 'START', timestamp: start }, () => live.kick.getReplaySnapshot());
    for (let index = 0; index < 661; index++) {
      const timestamp = index === 371 ? ORIGIN + eventAt : start + 10 + index * (1000 / 30);
      const frame = motionFrame(timestamp);
      if (index >= 369 && index <= 374) frame.landmarks[25].x += (index === 369 ? -0.32 : -0.64) * live.baseline.bodyScale;
      if ([10, 50, 90, 130].includes(index)) { frame.landmarks = []; frame.worldLandmarks = []; }
      live.frame(frame);
    }
    const session = await live.finish(30000), expected = session.liveResult.trials[1].result;
    expect(expected).toMatchObject({ poseFrameCount: 661, poseUsableFrameCount: 657, finalState: 'ARMED',
      events: [{ id: 1, direction: 'KNEE_LEFT', tMs: eventAt }],
      guidedSummary: { KNEE_LEFT: { detected: true, directionCorrect: true }, KNEE_RIGHT: { detected: false },
        NEUTRAL: { falseKickCount: 0 }, TWIST_LEFT: { falseKickCount: 0 }, TWIST_RIGHT: { falseKickCount: 0 } } });
    const first = replayLandmarks(session, 2), second = replayLandmarks(session, 2);
    expect(first.result).toEqual(expected); expect(second).toEqual(first);
    expect(first.comparison).toMatchObject({ eventsEqual: true, guidedSummaryEqual: true, finalStateEqual: true });
  });

  it('uses original relative times, never processing speed or performance.now, on repeated runs', async () => {
    const { session } = await fullTrial();
    const first = replayLandmarks(session, 1);
    vi.spyOn(performance, 'now').mockImplementation(() => { throw new Error('wall clock is forbidden'); });
    expect(replayLandmarks(session, 1)).toEqual(first);
    expect(replayLandmarks(structuredClone(session), 1)).toEqual(first);
  });
  it('sorts out-of-order records and skips duplicate timestamps without mutating the source', async () => {
    const { session } = await fullTrial();
    const expected = replayLandmarks(session, 1);
    const modified = structuredClone(session);
    modified.poseFrames = [...modified.poseFrames.reverse(), modified.poseFrames[0]];
    const before = JSON.stringify(modified);
    expect(replayLandmarks(modified, 1)).toEqual(expected);
    expect(JSON.stringify(modified)).toBe(before);
  });
  it('rebuilds Neutral and kick baselines with the existing calibration core', async () => {
    const { session } = await fullTrial();
    expect(replayCalibration(session, 1)).toMatchObject({ neutralBaselineEqual: true, kickBaselineEqual: true });
    session.markers = session.markers.filter((marker) => marker.type !== 'NEUTRAL_CALIBRATION_START');
    expect(() => replayCalibration(session, 1)).toThrow('Neutral calibration');
  });
  it('replays actual clock-only stale cancellation to WAIT_CLEAR without adding polls', async () => {
    const live = liveHarness(); live.send(20); live.send(40, -0.5); live.clock(440);
    const session = await live.finish(450), result = replayLandmarks(session, 1);
    expect(result.result.finalState).toBe('WAIT_CLEAR');
    expect(result.result.events).toEqual([]);
    expect(result.result).toEqual(session.liveResult.trials[0].result);
    session.clockSamples = [];
    expect(replayLandmarks(session, 1).result.finalState).toBe('CANDIDATE');
  });
  it('preserves production WAIT_RETURN and return dwell semantics', async () => {
    const live = liveHarness(); live.send(20); live.send(60, -0.6); live.send(120, -0.6);
    live.send(160); live.send(320);
    const session = await live.finish(330);
    expect(replayLandmarks(session, 1).result).toEqual(session.liveResult.trials[0].result);
    expect(replayLandmarks(session, 1).result.finalState).toBe('WAIT_RETURN');
  });
  it('regression fixture preserves the known false RIGHT after short NO_LANDMARKS and Neutral reacquisition (does not fix it)', async () => {
    const live = liveHarness(); live.send(20); live.send(40, 0, 0.6);
    live.send(80, 0, 0, true); live.send(120); // Neutral coordinates; old positive/velocity evidence confirms.
    const session = await live.finish(130), result = replayLandmarks(session, 1);
    expect(result.result.events).toEqual([{ id: 1, direction: 'KNEE_RIGHT', tMs: TRIAL_AT + 120 }]);
    expect(result.result.guidedSummary?.NEUTRAL.falseKickCount).toBe(1);
    expect(result.result).toEqual(session.liveResult.trials[0].result);
    expect(session.poseFrames.find((frame) => frame.tMs === TRIAL_AT + 80)?.landmarks).toEqual([]);
  });
  it('capture observer ON/OFF leaves production baseline/state/events unchanged', () => {
    const on = liveHarness(), off = liveHarness(false);
    for (const h of [on, off]) { h.send(20); h.send(60, 0.6); h.send(120, 0.6); h.clock(300); }
    expect(on.kick.getReplaySnapshot()).toEqual(off.kick.getReplaySnapshot());
  });
  it('retains two independent trials when the new-trial guard clock completes the previous guide', async () => {
    const live = liveHarness(); live.send(20); live.send(60, -0.6); live.send(120, -0.6);
    const nextStart = ORIGIN + TRIAL_AT + 23000;
    expect(live.kick.startTest(nextStart, () => live.capture.observe({ kind: 'CLOCK', timestamp: nextStart }, () => live.kick.getReplaySnapshot()))).toBe(true);
    live.capture.observe({ kind: 'START', timestamp: nextStart }, () => live.kick.getReplaySnapshot());
    live.send(23020); live.send(23060, 0.6); live.send(23120, 0.6);
    const session = await live.finish(23200);
    expect(session.liveResult.trials).toHaveLength(2);
    for (const id of [1, 2]) expect(replayLandmarks(session, id).result).toEqual(session.liveResult.trials[id - 1].result);
    expect(session.liveResult.trials.map((trial) => trial.result.events[0].direction)).toEqual(['KNEE_LEFT', 'KNEE_RIGHT']);
  });

  it('replay never mutates the live instance', async () => {
    const { session, kick } = await fullTrial(), snapshot = kick.getReplaySnapshot();
    replayLandmarks(session, 1); replayCalibration(session, 1);
    expect(kick.getReplaySnapshot()).toEqual(snapshot);
    expect(session.timing.captureStartPerformanceMs).toBe(ORIGIN);
  });
  it('rejects malformed JSON timestamps, landmark arrays and unsupported schema', async () => {
    const { session } = await fullTrial();
    for (const mutate of [
      (s: typeof session) => { s.version = 9 as 1; },
      (s: typeof session) => { s.poseFrames[0].tMs = -1; },
      (s: typeof session) => { s.poseFrames[0].landmarks = s.poseFrames[0].landmarks.slice(0, 3); },
      (s: typeof session) => { s.liveResult.trials[0].baseline.bodyScale = 0; },
    ]) {
      const copy = structuredClone(session); mutate(copy);
      expect(() => readReplaySession(JSON.stringify(copy))).toThrow('Replay JSON');
    }
  });
});
