import type { KneeKickEvent, KneeKickState, RemoteKneeKickState } from '@plank-stork/protocol';
import { calculateKneeMotionVelocity, finite, type KneeMotionFeatures } from '../motion/kneeMotionFeatures';

// Experimental starting values from three sessions, NOT final/generalized thresholds.
export const KICK_ENTER_DISPLACEMENT = 0.28;
export const KICK_EXIT_DISPLACEMENT = 0.15;
export const RETURN_DWELL_MS = 180;
export const KICK_HIP_VISIBILITY = 0.7;
export const KICK_KNEE_VISIBILITY = 0.5;
export const MIN_KICK_BODY_SCALE = 0.01;
export const KICK_STALE_MS = 400;
export const KICK_EVENT_DISPLAY_MS = 800;

export interface KneeKickBaseline {
  leftMedian: number;
  rightMedian: number;
  leftDistanceMedian: number;
  rightDistanceMedian: number;
  bodyScale: number;
}
export interface KneeKickView extends RemoteKneeKickState {
  baseline: KneeKickBaseline | null;
  normalizedLeft: number | null;
  normalizedRight: number | null;
  dominantNormalizedDisplacement: number | null;
  normalizedLeftVelocity: number | null;
  normalizedRightVelocity: number | null;
}
export function usableKnees(features: KneeMotionFeatures, poseFresh: boolean) {
  const visible = (value: number | null, minimum: number) => finite(value) && value >= minimum;
  const hips = poseFresh && visible(features.leftHipVisibility, KICK_HIP_VISIBILITY) && visible(features.rightHipVisibility, KICK_HIP_VISIBILITY);
  return {
    left: hips && visible(features.leftKneeVisibility, KICK_KNEE_VISIBILITY) && finite(features.leftKneeCenterOffsetX) && finite(features.leftKneeHipDistance),
    right: hips && visible(features.rightKneeVisibility, KICK_KNEE_VISIBILITY) && finite(features.rightKneeCenterOffsetX) && finite(features.rightKneeHipDistance),
  };
}

/** Per-inference state machine. No React, preview transform, prototype, or Socket dependency. */
export class KneeKickDetector {
  private baseline: KneeKickBaseline | null = null;
  private state: KneeKickState = 'NOT_READY';
  private returnStartedAt: number | null = null;
  private lastFrameAt: number | null = null;
  private lastEvent: KneeKickEvent | null = null;
  private counts = { KNEE_LEFT: 0, KNEE_RIGHT: 0 };
  private left: number | null = null;
  private right: number | null = null;
  private dominant: number | null = null;
  private leftVelocity: number | null = null;
  private rightVelocity: number | null = null;
  private previous: { features: KneeMotionFeatures; timestamp: number } | null = null;

  setBaseline(baseline: KneeKickBaseline | null): void {
    this.reset();
    if (!baseline || !Object.values(baseline).every(finite) || baseline.bodyScale < MIN_KICK_BODY_SCALE) return;
    this.baseline = { ...baseline };
    this.state = 'ARMED';
  }

  processFrame(features: KneeMotionFeatures, timestamp: number, poseFresh: boolean): KneeKickEvent | null {
    if (!finite(timestamp) || (this.lastFrameAt !== null && timestamp <= this.lastFrameAt)) return null;
    if (this.lastFrameAt !== null && timestamp - this.lastFrameAt >= KICK_STALE_MS) this.returnStartedAt = null;
    this.lastFrameAt = timestamp;
    this.left = this.right = this.dominant = this.leftVelocity = this.rightVelocity = null;
    if (!this.baseline) return null;
    const usable = usableKnees(features, poseFresh);
    const { bodyScale, leftMedian, rightMedian } = this.baseline;
    this.left = usable.left ? (features.leftKneeCenterOffsetX! - leftMedian) / bodyScale : null;
    this.right = usable.right ? (features.rightKneeCenterOffsetX! - rightMedian) / bodyScale : null;
    // A tie deterministically selects the left landmark, never maps landmark identity to event direction.
    this.dominant = this.left === null ? this.right : this.right === null || Math.abs(this.left) >= Math.abs(this.right) ? this.left : this.right;
    const velocity = calculateKneeMotionVelocity(features, timestamp, this.previous);
    this.leftVelocity = usable.left && finite(velocity.leftKneeRelativeVelocityX) ? velocity.leftKneeRelativeVelocityX / bodyScale : null;
    this.rightVelocity = usable.right && finite(velocity.rightKneeRelativeVelocityX) ? velocity.rightKneeRelativeVelocityX / bodyScale : null;
    this.previous = usable.left || usable.right ? { timestamp, features: { ...features,
      leftKneeX: usable.left ? features.leftKneeX : null, rightKneeX: usable.right ? features.rightKneeX : null,
    } } : null;

    if (this.state === 'WAIT_RETURN') {
      // Both knees must be observed inside EXIT continuously. Loss never unlocks a latched event.
      if (this.left !== null && this.right !== null && Math.abs(this.left) < KICK_EXIT_DISPLACEMENT && Math.abs(this.right) < KICK_EXIT_DISPLACEMENT) {
        this.returnStartedAt ??= timestamp;
        if (timestamp - this.returnStartedAt >= RETURN_DWELL_MS) { this.state = 'ARMED'; this.returnStartedAt = null; }
      } else this.returnStartedAt = null;
      return null;
    }
    if (this.state !== 'ARMED' || this.dominant === null || Math.abs(this.dominant) < KICK_ENTER_DISPLACEMENT) return null;
    const direction = this.dominant < 0 ? 'KNEE_LEFT' : 'KNEE_RIGHT';
    this.state = direction === 'KNEE_LEFT' ? 'TRIGGERED_LEFT' : 'TRIGGERED_RIGHT';
    this.counts[direction] += 1;
    const event: KneeKickEvent = { id: this.counts.KNEE_LEFT + this.counts.KNEE_RIGHT, direction, timestamp };
    this.lastEvent = event;
    // TRIGGERED is a one-shot transition; never leave a triggerable held-pose state between frames.
    this.state = 'WAIT_RETURN';
    return { ...event };
  }

  getView(now: number): KneeKickView {
    const fresh = this.lastFrameAt !== null && now >= this.lastFrameAt && now - this.lastFrameAt < KICK_STALE_MS;
    if (!fresh) this.returnStartedAt = null;
    const validNow = fresh && this.dominant !== null;
    return {
      ready: this.baseline !== null, validNow, state: this.state, baseline: this.baseline ? { ...this.baseline } : null,
      normalizedLeft: fresh ? this.left : null, normalizedRight: fresh ? this.right : null,
      dominantNormalizedDisplacement: fresh ? this.dominant : null,
      normalizedLeftVelocity: fresh ? this.leftVelocity : null, normalizedRightVelocity: fresh ? this.rightVelocity : null,
      currentEvent: validNow && this.lastEvent && now - this.lastEvent.timestamp < KICK_EVENT_DISPLAY_MS ? this.lastEvent.direction : 'NONE',
      lastEvent: this.lastEvent ? { ...this.lastEvent } : null, counts: { ...this.counts },
    };
  }

  reset(): void {
    this.baseline = null; this.state = 'NOT_READY'; this.returnStartedAt = this.lastFrameAt = null;
    this.lastEvent = null; this.counts = { KNEE_LEFT: 0, KNEE_RIGHT: 0 };
    this.left = this.right = this.dominant = this.leftVelocity = this.rightVelocity = null;
    this.previous = null;
  }
}
