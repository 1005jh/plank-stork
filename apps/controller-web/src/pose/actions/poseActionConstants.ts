import type { ActionFeatureKey } from './poseActionTypes';

// Experimental normalization scales and decision settings; tune against measured sessions.
export const ACTION_FEATURE_SCALES = {
  deltaHipCenterX: 0.05,
  deltaHipCenterY: 0.05,
  deltaHipDepthDifference: 0.08,
  deltaLeftKneeRelativeX: 0.06,
  deltaRightKneeRelativeX: 0.06,
  deltaLeftKneeRelativeY: 0.08,
  deltaRightKneeRelativeY: 0.08,
} as const;
export const ACTION_FEATURE_KEYS = Object.keys(ACTION_FEATURE_SCALES) as ActionFeatureKey[];
export const ACTION_HIP_FEATURES = ['deltaHipCenterX', 'deltaHipCenterY', 'deltaHipDepthDifference'] as const;
export const ACTION_MIN_SAMPLES = 15;
export const ACTION_PREPARE_MS = 2000;
export const ACTION_RECORD_MS = 1500;
export const ACTION_MOVE_MS = 1000;
export const ACTION_RETURN_MS = 1000;
export const NEUTRAL_EXIT_SCORE = 0.5;
export const NEUTRAL_ENTER_SCORE = 0.3;
export const ACTION_MAX_DISTANCE = 1.5;
export const ACTION_MIN_MARGIN = 0.2;
export const ACTION_MIN_CONFIDENCE = 0.25;
export const ACTION_ENTER_MS = 200;
export const ACTION_RELEASE_MS = 150;
export const ACTION_MAX_FRAME_GAP_MS = 400;
export const ACTION_UI_INTERVAL_MS = 250;
