import { motionFrame } from '../pose/motion/testFixtures';
import { copyPoseFrame } from '../replay/replayTypes';
import { liveHarness, TRIAL_AT } from '../replay/testFixtures';

export const STAGE_OFFSETS = [0, 2000, 5000, 7000, 10000, 12000, 15000, 17000, 20000];
export function discoveryFrame(offset: number, leftY = 0, rightY = 0) {
  const frame = copyPoseFrame(motionFrame(TRIAL_AT + offset), 0, offset + 100);
  frame.landmarks[25].y += leftY; frame.landmarks[26].y += rightY;
  return frame;
}
export async function discoveryFixture() {
  const live = liveHarness(); live.clock(22000);
  const session = await live.finish();
  const scale = session.liveResult.trials[0].baseline.bodyScale;
  session.poseFrames = STAGE_OFFSETS.flatMap((start, index) => [10, 50].map((offset) =>
    discoveryFrame(start + offset, index === 5 ? 0.6 * scale : index === 1 ? 0.1 * scale : 0,
      index === 7 ? 0.5 * scale : index === 3 ? 0.1 * scale : 0)));
  return session;
}
