// Keep the WASM version aligned with the exact tasks-vision package version.
export const VISION_WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
export const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

export const DEFAULT_MIRROR_PREVIEW = true;
export const METRICS_INTERVAL_MS = 500;
export const INFERENCE_SAMPLE_COUNT = 30;

export const SIGNAL_LANDMARKS = [
  { index: 23, name: 'LEFT_HIP' },
  { index: 24, name: 'RIGHT_HIP' },
  { index: 25, name: 'LEFT_KNEE' },
  { index: 26, name: 'RIGHT_KNEE' },
] as const;

export const KEY_LANDMARKS = [
  { index: 11, name: 'LEFT_SHOULDER' },
  { index: 12, name: 'RIGHT_SHOULDER' },
  { index: 23, name: 'LEFT_HIP' },
  { index: 24, name: 'RIGHT_HIP' },
  { index: 25, name: 'LEFT_KNEE' },
  { index: 26, name: 'RIGHT_KNEE' },
  { index: 27, name: 'LEFT_ANKLE' },
  { index: 28, name: 'RIGHT_ANKLE' },
] as const;
