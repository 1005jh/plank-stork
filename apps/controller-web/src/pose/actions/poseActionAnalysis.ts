import { ActionCalibration } from './actionCalibration';
import { ActionStabilizer, classifyPoseAction, neutralIsFrozen } from './poseActionClassifier';
import type { ActionInput, PoseActionView } from './poseActionTypes';

/** Owns calibration and stabilization for one frozen Neutral reference, without React or Mirror. */
export class PoseActionAnalysis {
  private calibration = new ActionCalibration();
  private stabilizer = new ActionStabilizer();
  private neutralReference: number | null = null;
  private lastFrameAt: number | null = null;

  private syncNeutral(input: ActionInput): void {
    if (!neutralIsFrozen(input)) {
      if (this.neutralReference !== null) this.reset();
      return;
    }
    if (this.neutralReference !== null && this.neutralReference !== input.hipReadyAt) this.reset();
    this.neutralReference = input.hipReadyAt;
  }

  start(input: ActionInput, now: number): boolean {
    this.syncNeutral(input);
    if (!this.calibration.start(input, now)) return false;
    this.stabilizer.reset();
    this.lastFrameAt = null;
    return true;
  }

  processFrame(input: ActionInput, timestamp: number): void {
    this.syncNeutral(input);
    if (!neutralIsFrozen(input)) return;
    if (this.lastFrameAt !== null && timestamp <= this.lastFrameAt) return;
    this.lastFrameAt = timestamp;
    this.calibration.recordFrame(input, timestamp);
    const candidate = classifyPoseAction(input, this.calibration.getPrototypes(), timestamp, this.stabilizer.stableAction);
    this.stabilizer.update(candidate, timestamp);
  }

  getView(input: ActionInput, now: number): PoseActionView {
    this.syncNeutral(input);
    const calibration = this.calibration.getView(now);
    const classification = classifyPoseAction(input, calibration.prototypes, now, this.stabilizer.stableAction);
    // Polling expires stale state, but never advances an enter/release dwell without inference.
    if (!classification.valid) this.stabilizer.reset();
    return {
      neutralFrozen: neutralIsFrozen(input), calibration,
      classification: { ...classification, stableAction: this.stabilizer.stableAction },
    };
  }

  reset(): void {
    this.calibration.reset(); this.stabilizer.reset(); this.neutralReference = null; this.lastFrameAt = null;
  }
}
