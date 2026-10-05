// @vitest-environment node
import { expect, it } from 'vitest';
import { liveHarness, ORIGIN, TRIAL_AT } from './testFixtures';
import { motionFrame } from '../pose/motion/testFixtures';
import { readReplaySession } from './readReplaySession';

it('keeps a post-trial global kick with trialId null and never mutates the closed Guided result', async () => {
  const live = liveHarness(true, 'Y_V3');
  for (let t = 20; t <= 22020; t += 40) live.send(t);
  const closed = structuredClone(live.kick.getReplaySnapshot());
  for (const t of [22060, 22120]) {
    const f = motionFrame(ORIGIN + TRIAL_AT + t); f.landmarks[26].y += .6 * live.baseline.bodyScale; live.frame(f);
  }
  const session = await live.finish(22300), trial = session.liveResult.trials[0];
  expect(session.liveResult.events).toHaveLength(1);
  expect(session.liveResult.events[0]).toMatchObject({ direction: 'KNEE_RIGHT', trialId: null });
  expect(session.liveResult.events[0].tMs).toBeGreaterThan(trial.endMs!);
  expect(trial.result.events).toEqual([]);
  expect(trial.result.finalState).toBe(closed.detector.state);
  expect(trial.result.guidedSummary).toEqual(closed.guided.summary);
  expect(trial.result.poseFrameCount).toBe(551);
  // Historic incorrectly-attributed files remain readable; no rewrite of raw captures.
  session.liveResult.events[0].trialId = 1;
  expect(readReplaySession(JSON.stringify(session)).liveResult.events[0].trialId).toBe(1);
});
