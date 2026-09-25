import type { PoseFrame } from '../../recorder/poseRecorderTypes';
import { PoseFeatureAnalysis } from '../features/poseFeatureAnalysis';
import type { MotionStart } from './kneeMotionTypes';

export function motionFrame(timestamp: number): PoseFrame {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  landmarks[23] = { x: 0.4, y: 0.4, z: 0, visibility: 0.95 };
  landmarks[24] = { x: 0.6, y: 0.4, z: 0, visibility: 0.95 };
  landmarks[25] = { x: 0.35, y: 0.7, z: 0, visibility: 0.7 };
  landmarks[26] = { x: 0.65, y: 0.7, z: 0, visibility: 0.6 };
  return { timestamp, videoTime: timestamp / 1000, landmarks,
    worldLandmarks: landmarks.map(({ x, y, z }) => ({ x: x * 2, y: y * 2, z })) };
}

// Only Neutral calibration is performed. No action/prototype dependency.
export function motionContext(): MotionStart {
  const analysis = new PoseFeatureAnalysis(); analysis.startCalibration(0);
  for (let now = 50; now <= 1000; now += 50) {
    const frame = motionFrame(now); analysis.processFrame(frame.landmarks, frame.worldLandmarks, now);
  }
  return { cameraRunning: true, poseDetected: true, neutral: analysis.getView(1000), delegate: 'CPU',
    videoWidth: 1280, videoHeight: 720, previewMirrored: true, createdAt: '2026-09-24T00:00:00.000Z', timeOrigin: 100000 };
}
