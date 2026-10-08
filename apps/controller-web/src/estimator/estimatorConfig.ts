import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { POSE_VIDEO_OPTIONS } from '../pose/createPoseLandmarker';
import { POSE_MODEL_URL, VISION_WASM_URL } from '../pose/poseConstants';

export const ESTIMATOR_VARIANTS = ['FULL_VIDEO_CONTROL', 'FULL_IMAGE', 'HEAVY_VIDEO'] as const;
export type EstimatorVariant = typeof ESTIMATOR_VARIANTS[number];
// Official versioned asset; deliberately outside production configuration.
const HEAVY_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task';
export function estimatorConfig(variant: EstimatorVariant) {
  return { variant, model: variant === 'HEAVY_VIDEO' ? 'pose_landmarker_heavy' : 'pose_landmarker_full',
    options: { ...POSE_VIDEO_OPTIONS, runningMode: variant === 'FULL_IMAGE' ? 'IMAGE' as const : 'VIDEO' as const,
      baseOptions: { modelAssetPath: variant === 'HEAVY_VIDEO' ? HEAVY_URL : POSE_MODEL_URL, delegate: 'GPU' as const } } };
}
export async function createEstimator(variant: EstimatorVariant) {
  const vision = await FilesetResolver.forVisionTasks(VISION_WASM_URL);
  // An experiment must fail explicitly if GPU initialization fails; CPU is not a fourth variant.
  return PoseLandmarker.createFromOptions(vision, estimatorConfig(variant).options);
}
