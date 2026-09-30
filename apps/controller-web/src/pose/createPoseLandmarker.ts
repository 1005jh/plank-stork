import { FilesetResolver, PoseLandmarker, type PoseLandmarkerOptions } from '@mediapipe/tasks-vision';
import { POSE_MODEL_URL, VISION_WASM_URL } from './poseConstants';

export type PoseDelegate = 'GPU' | 'CPU';

export const POSE_VIDEO_OPTIONS = {
  runningMode: 'VIDEO',
  numPoses: 1,
  minPoseDetectionConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
  outputSegmentationMasks: false,
} as const;

export async function createPoseLandmarker(preferredDelegate: PoseDelegate = 'GPU'): Promise<{
  landmarker: PoseLandmarker;
  delegate: PoseDelegate;
}> {
  console.info('[Pose] WASM_LOADING', { wasmUrl: VISION_WASM_URL });
  const vision = await FilesetResolver.forVisionTasks(VISION_WASM_URL);
  console.info('[Pose] WASM_READY');

  // The SDK downloads the model and initializes its runtime inside createFromOptions.
  console.info('[Pose] MODEL_LOADING', { modelAssetPath: POSE_MODEL_URL });
  const options: PoseLandmarkerOptions = POSE_VIDEO_OPTIONS;

  let delegate: PoseDelegate = preferredDelegate;
  let landmarker: PoseLandmarker;
  console.info(`[Pose] ${preferredDelegate}_INITIALIZING`);
  try {
    landmarker = await PoseLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: preferredDelegate },
    });
  } catch (error) {
    if (preferredDelegate === 'CPU') throw error;
    console.warn('[Pose] GPU initialization failed; falling back to CPU', error);
    delegate = 'CPU';
    console.info('[Pose] CPU_INITIALIZING');
    landmarker = await PoseLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: 'CPU' },
    });
  }
  console.info('[Pose] POSE_READY', { delegate });
  return { landmarker, delegate };
}
