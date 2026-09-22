import type { CalibrationControllerStatus, CalibrationRemoteState, CalibrationRequest } from '@plank-stork/protocol';
import type { PoseFeatureView } from '../pose/features/poseFeatureTypes';
import { POSE_ACTIONS, type PoseActionView } from '../pose/actions/poseActionTypes';

export interface CalibrationPorts {
  getCamera: () => CalibrationControllerStatus;
  getNeutral: () => PoseFeatureView;
  getActions: () => PoseActionView;
  startNeutral: () => void;
  startAction: () => void;
  resetAction: () => void;
}
export type RemoteCommand = 'neutral:start' | 'action:start' | 'action:reset';

/** Adapts existing local engines to wire types; owns no calibration timing or samples. */
export class CalibrationRemoteController {
  private seen = new Set<string>();
  private lastCommandError: CalibrationRemoteState['lastCommandError'] = null;

  constructor(private getPorts: () => CalibrationPorts) {}

  handle(command: RemoteCommand, request: CalibrationRequest): void {
    if (!request || typeof request.requestId !== 'string' || !request.requestId) return;
    const key = `${command}:${request.requestId}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    // Bound memory across long-running development sessions. Active-state guards also reject repeats.
    if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
    const ports = this.getPorts();
    const neutral = ports.getNeutral();
    const action = ports.getActions();
    this.lastCommandError = null;
    if (command === 'action:reset') { ports.resetAction(); return; }
    if (command === 'neutral:start' && ['HIP', 'FINISHING'].includes(neutral.collectionState)) return;
    if (command === 'action:start' && action.calibration.status === 'RUNNING') return;
    const camera = ports.getCamera();
    if (!camera.cameraRunning) { this.lastCommandError = 'CAMERA_NOT_READY'; return; }
    if (command === 'neutral:start') {
      if (!camera.poseDetected) { this.lastCommandError = 'POSE_NOT_DETECTED'; return; }
      // Same reset/start operation as the controller's local Calibrate Neutral button.
      ports.startNeutral();
    } else if (neutral.collectionState !== 'FROZEN') {
      this.lastCommandError = 'NEUTRAL_NOT_FROZEN';
    } else ports.startAction();
  }

  snapshot(controllerOverride?: CalibrationControllerStatus): CalibrationRemoteState {
    const ports = this.getPorts();
    const neutral = ports.getNeutral();
    const { calibration, classification } = ports.getActions();
    const stage = calibration.stage;
    const active = calibration.status === 'RUNNING';
    const completed = calibration.status === 'READY' || calibration.status === 'PARTIAL';
    return {
      timestamp: Date.now(),
      controller: controllerOverride ?? ports.getCamera(),
      neutral: {
        status: neutral.status === 'NOT CALIBRATED' ? 'NOT_CALIBRATED' : neutral.status,
        collectionState: neutral.collectionState,
        hipSamples: neutral.readiness.hips.sampleCount,
        leftKneeSamples: neutral.readiness.leftKnee.sampleCount,
        rightKneeSamples: neutral.readiness.rightKnee.sampleCount,
        hipReady: neutral.readiness.hips.ready,
        leftKneeReady: neutral.readiness.leftKnee.ready,
        rightKneeReady: neutral.readiness.rightKnee.ready,
        kneeGraceRemainingMs: neutral.kneeGraceRemainingMs,
        frozen: neutral.collectionState === 'FROZEN',
      },
      actionCalibration: {
        status: active ? 'ACTIVE' : completed ? 'COMPLETED' : 'IDLE',
        phase: stage?.phase === 'RECORDING' ? 'RECORD' : stage?.phase ?? (completed ? 'COMPLETED' : 'IDLE'),
        action: stage?.phase === 'MOVE' ? stage.nextAction : stage?.action ?? null,
        remainingMs: calibration.remainingMs,
        readiness: Object.fromEntries(POSE_ACTIONS.map((action) => [action, calibration.prototypes[action] !== null])) as Record<typeof POSE_ACTIONS[number], boolean>,
      },
      classification: { ...classification, actionDistances: { ...classification.actionDistances } },
      lastCommandError: this.lastCommandError,
    };
  }

  clearError(): void { this.lastCommandError = null; }
}
