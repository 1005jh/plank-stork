import type { CalibratedPoseFeatures, PoseFeatureView } from '../features/poseFeatureTypes';

export const POSE_ACTIONS = ['TWIST_LEFT', 'TWIST_RIGHT', 'KNEE_LEFT', 'KNEE_RIGHT'] as const;
export type PoseAction = typeof POSE_ACTIONS[number];
export type PoseActionState = 'NONE' | PoseAction;
export type ActionFeatures = CalibratedPoseFeatures;
export type ActionFeatureKey = keyof ActionFeatures;
export type ActionInput = Pick<PoseFeatureView, 'collectionState' | 'hipReadyAt' | 'smoothed'>;

export interface ActionPrototype {
  action: PoseAction;
  features: ActionFeatures;
}
export type ActionPrototypes = Record<PoseAction, ActionPrototype | null>;
export type ActionSampleCounts = Record<ActionFeatureKey, number>;

export interface ActionStage {
  phase: 'PREPARE' | 'MOVE' | 'RECORDING' | 'RETURN_NEUTRAL';
  action: PoseAction | null;
  nextAction: PoseAction | null;
  durationMs: number;
}

export interface ActionCalibrationView {
  status: 'IDLE' | 'RUNNING' | 'READY' | 'PARTIAL';
  stage: ActionStage | null;
  remainingMs: number;
  sampleCounts: Record<PoseAction, ActionSampleCounts>;
  prototypes: ActionPrototypes;
}

export interface ActionClassification {
  rawAction: PoseActionState;
  stableAction: PoseActionState;
  confidence: number;
  /** Valid input/calibration, even if a low-confidence candidate is rejected to NONE. */
  valid: boolean;
  neutralMovementScore: number | null;
  bestDistance: number | null;
  secondBestDistance: number | null;
  actionDistances: Record<PoseAction, number | null>;
  reason: 'OK' | 'NOT_CALIBRATED' | 'POSE_STALE' | 'ACTION_CALIBRATION_INCOMPLETE' | 'LOW_CONFIDENCE' | 'AMBIGUOUS';
}

export interface PoseActionView {
  neutralFrozen: boolean;
  calibration: ActionCalibrationView;
  classification: ActionClassification;
}
