import { ActionCalibration } from '../actions/actionCalibration';
import { classifyPoseAction } from '../actions/poseActionClassifier';
import { POSE_ACTIONS } from '../actions/poseActionTypes';
import { input, prototypes, RECORD_STARTS } from '../actions/testFixtures';
import { PoseFeatureAnalysis } from '../features/poseFeatureAnalysis';
import type { PoseFrame } from '../../recorder/poseRecorderTypes';
import type { ValidationStart } from './validationTypes';

export function validationFrame(timestamp: number): PoseFrame {
  return { timestamp, videoTime: timestamp / 1000,
    landmarks: Array.from({ length: 33 }, (_, index) => ({ x: index / 100, y: 0.5, z: -0.1, visibility: 0.9 })),
    worldLandmarks: Array.from({ length: 33 }, (_, index) => ({ x: index / 10, y: -0.5, z: 0.2 })),
  };
}

export function validationContext(): ValidationStart {
  const neutral = new PoseFeatureAnalysis();
  neutral.startCalibration(0);
  const points = validationFrame(0);
  for (let now = 50; now <= 1000; now += 50) neutral.processFrame(points.landmarks, points.worldLandmarks, now);
  const features = neutral.getView(1000);
  const action = new ActionCalibration();
  action.start(input(0), 0);
  for (const [index, start] of RECORD_STARTS.entries()) {
    for (let sample = 0; sample < 30; sample++) {
      const now = start + sample * 40;
      action.recordFrame(input(now, prototypes()[POSE_ACTIONS[index]]!.features), now);
    }
  }
  const calibration = action.getView(15000);
  return { cameraRunning: true, delegate: 'GPU', videoWidth: 1280, videoHeight: 720,
    previewMirrored: true, createdAt: '2026-09-23T00:00:00.000Z', timeOrigin: 123456789,
    features, actions: { neutralFrozen: true, calibration, classification: classifyPoseAction(features, calibration.prototypes, 1000) },
  };
}
