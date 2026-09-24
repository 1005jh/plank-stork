/** Wire snapshots only. Pose landmarks and classifier implementation stay in controller-web. */
export type CalibrationAction = 'TWIST_LEFT' | 'TWIST_RIGHT' | 'KNEE_LEFT' | 'KNEE_RIGHT';
export type RemoteActionState = 'NONE' | CalibrationAction;
export interface CalibrationRequest { requestId: string; timestamp: number }
export interface CalibrationControllerStatus { cameraRunning: boolean; poseDetected: boolean }
export interface RemoteNeutralCalibrationState {
  status: 'NOT_CALIBRATED' | 'CALIBRATING' | 'CALIBRATED';
  collectionState: 'IDLE' | 'HIP' | 'FINISHING' | 'FROZEN';
  hipSamples: number;
  leftKneeSamples: number;
  rightKneeSamples: number;
  hipReady: boolean;
  leftKneeReady: boolean;
  rightKneeReady: boolean;
  kneeGraceRemainingMs: number;
  frozen: boolean;
}
export interface RemoteActionCalibrationState {
  status: 'IDLE' | 'ACTIVE' | 'COMPLETED';
  phase: 'IDLE' | 'PREPARE' | 'MOVE' | 'RECORD' | 'RETURN_NEUTRAL' | 'COMPLETED';
  action: CalibrationAction | null;
  remainingMs: number;
  readiness: Record<CalibrationAction, boolean>;
}
export interface RemoteClassificationState {
  rawAction: RemoteActionState;
  stableAction: RemoteActionState;
  confidence: number;
  reason: string;
  neutralMovementScore: number | null;
  bestDistance: number | null;
  secondBestDistance: number | null;
  actionDistances: Partial<Record<CalibrationAction, number | null>>;
}
export interface RemoteValidationState {
  status: 'IDLE' | 'ACTIVE' | 'COMPLETED';
  phase: 'IDLE' | 'PREPARE' | 'RECORD_NEUTRAL' | 'MOVE' | 'RECORD_ACTION' | 'RETURN_NEUTRAL' | 'COMPLETED';
  expectedAction: RemoteActionState | null;
  remainingMs: number;
  recordedFrames: number;
}
export interface CalibrationRemoteState {
  /** Controller wall clock, for display only; mobile freshness uses local receipt time. */
  timestamp: number;
  controller: CalibrationControllerStatus;
  neutral: RemoteNeutralCalibrationState;
  actionCalibration: RemoteActionCalibrationState;
  classification: RemoteClassificationState | null;
  validation: RemoteValidationState;
  lastCommandError: 'CAMERA_NOT_READY' | 'POSE_NOT_DETECTED' | 'NEUTRAL_NOT_FROZEN' | 'ACTION_NOT_READY' | null;
}
