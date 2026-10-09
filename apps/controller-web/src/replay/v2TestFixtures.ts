import { createTestCapture, captureCamera, mockRecorder } from './testFixtures';
import { KneeKickAnalysis } from '../pose/kick/kneeKickAnalysis';
import { PoseFeatureAnalysis } from '../pose/features/poseFeatureAnalysis';
import { motionFrame } from '../pose/motion/testFixtures';
export function readyCapture() {
  const capture = createTestCapture(), kick = new KneeKickAnalysis(null, 'Y_V3'), neutral = new PoseFeatureAnalysis();
  capture.start(captureCamera(), false, 0, mockRecorder); neutral.startCalibration(100); capture.neutralStarted(100);
  const read = () => kick.getReplaySnapshot();
  function frame(t: number, missing = false) {
    const f = motionFrame(t); if (missing) { f.landmarks = []; f.worldLandmarks = []; }
    neutral.processFrame(f.landmarks, f.worldLandmarks, t); const n = neutral.getView(t);
    kick.processFrame(f, n); capture.observe({ kind: 'FRAME', timestamp: t, frame: f, neutral: n }, read);
  }
  for (let t = 150; t <= 3100; t += 50) frame(t);
  return { capture, kick, neutral, read, frame };
}
