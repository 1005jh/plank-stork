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
// EXPERIMENTAL v2 confirmation evidence. Revalidate on further sessions/users/camera placements.
export const KICK_CANDIDATE_MIN_MS = 60;
export const KICK_CANDIDATE_MAX_MS = 600;
export const KICK_CONFIRM_DISPLACEMENT = 0.34;
export const KICK_CONFIRM_VELOCITY = 5.0;
export const KICK_DIRECTION_MARGIN = 0.08;

export interface KickCandidateDiagnostics {
  candidateId: number | null;
  candidateActive: boolean;
  candidateStartedAt: number | null;
  candidateAgeMs: number | null;
  candidatePositivePeak: number | null;
  candidateNegativePeak: number | null;
  candidatePeakAbsVelocity: number | null;
  candidateSawLeft: boolean;
  candidateSawRight: boolean;
  candidateFrameCount: number;
  candidateStrongestMagnitude: number | null;
  candidateDirectionMargin: number | null;
  candidateOutcome: 'CONFIRMED' | 'TIMED_OUT' | 'STALE' | null;
  candidateEndedAt: number | null;
  confirmationLatencyMs: number | null;
}
interface KickCandidate {
  id: number; startedAt: number; positivePeak: number; negativePeak: number; peakAbsVelocity: number;
  sawLeft: boolean; sawRight: boolean; frameCount: number;
  outcome: KickCandidateDiagnostics['candidateOutcome']; endedAt: number | null;
}

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
export type KickValidityReason = 'OK' | 'NO_LANDMARKS' | 'HIP_VISIBILITY' | 'HIP_GEOMETRY' |
  'LEFT_KNEE_VISIBILITY' | 'RIGHT_KNEE_VISIBILITY' | 'LEFT_KNEE_GEOMETRY' | 'RIGHT_KNEE_GEOMETRY' | 'NO_USABLE_KNEE';

/** Current inference geometry only. STEP 4A smoothing/depth validity is not an input. */
export function usableKnees(features: KneeMotionFeatures) {
  const visible = (value: number | null, minimum: number) => finite(value) && value >= minimum;
  const hipVisible = visible(features.leftHipVisibility, KICK_HIP_VISIBILITY) && visible(features.rightHipVisibility, KICK_HIP_VISIBILITY);
  const hipGeometry = finite(features.hipCenterX);
  const hips = hipVisible && hipGeometry;
  const leftVisible = visible(features.leftKneeVisibility, KICK_KNEE_VISIBILITY);
  const rightVisible = visible(features.rightKneeVisibility, KICK_KNEE_VISIBILITY);
  const leftGeometry = finite(features.leftKneeX) && finite(features.leftKneeCenterOffsetX) && finite(features.leftKneeHipDistance);
  const rightGeometry = finite(features.rightKneeX) && finite(features.rightKneeCenterOffsetX) && finite(features.rightKneeHipDistance);
  const left = hips && leftVisible && leftGeometry, right = hips && rightVisible && rightGeometry;
  const reasons: KickValidityReason[] = [];
  if (Object.values(features).every((value) => value === null)) reasons.push('NO_LANDMARKS');
  if (!hipVisible) reasons.push('HIP_VISIBILITY');
  if (!hipGeometry) reasons.push('HIP_GEOMETRY');
  if (!leftVisible) reasons.push('LEFT_KNEE_VISIBILITY');
  if (!rightVisible) reasons.push('RIGHT_KNEE_VISIBILITY');
  if (!leftGeometry) reasons.push('LEFT_KNEE_GEOMETRY');
  if (!rightGeometry) reasons.push('RIGHT_KNEE_GEOMETRY');
  if (!left && !right) reasons.push('NO_USABLE_KNEE');
  if (!reasons.length) reasons.push('OK');
  return { hips, left, right, reasons };
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
  private candidate: KickCandidate | null = null;
  private candidateCount = 0;
  private lastUsableAt: number | null = null;
  private usableLeft = false;
  private usableRight = false;

  setBaseline(baseline: KneeKickBaseline | null): void {
    this.reset();
    if (!baseline || !Object.values(baseline).every(finite) || baseline.bodyScale < MIN_KICK_BODY_SCALE) return;
    this.baseline = { ...baseline };
    this.state = 'ARMED';
  }

  processFrame(features: KneeMotionFeatures, timestamp: number): KneeKickEvent | null {
    if (!finite(timestamp) || (this.lastFrameAt !== null && timestamp <= this.lastFrameAt)) return null;
    this.expireCandidate(timestamp);
    if (this.lastFrameAt !== null && timestamp - this.lastFrameAt >= KICK_STALE_MS) this.returnStartedAt = null;
    this.lastFrameAt = timestamp;
    this.left = this.right = this.dominant = this.leftVelocity = this.rightVelocity = null;
    const usable = usableKnees(features);
    this.usableLeft = usable.left; this.usableRight = usable.right;
    if (!this.baseline) return null;
    if (usable.left || usable.right) this.lastUsableAt = timestamp;
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

    if (this.state === 'WAIT_CLEAR') {
      // No event was emitted: observe a fresh sub-ENTER frame, without the confirmed-event penalty.
      if (this.dominant !== null && Math.abs(this.dominant) < KICK_ENTER_DISPLACEMENT) this.state = 'ARMED';
      return null;
    }
    if (this.state === 'WAIT_RETURN') {
      // Both knees must be observed inside EXIT continuously. Loss never unlocks a latched event.
      if (this.left !== null && this.right !== null && Math.abs(this.left) < KICK_EXIT_DISPLACEMENT && Math.abs(this.right) < KICK_EXIT_DISPLACEMENT) {
        this.returnStartedAt ??= timestamp;
        if (timestamp - this.returnStartedAt >= RETURN_DWELL_MS) { this.state = 'ARMED'; this.returnStartedAt = null; this.candidate = null; }
      } else this.returnStartedAt = null;
      return null;
    }
    if (this.state === 'ARMED' && this.dominant !== null && Math.abs(this.dominant) >= KICK_ENTER_DISPLACEMENT) {
      this.candidate = { id: ++this.candidateCount, startedAt: timestamp, positivePeak: 0, negativePeak: 0, peakAbsVelocity: 0,
        sawLeft: false, sawRight: false, frameCount: 0, outcome: null, endedAt: null };
      this.state = 'CANDIDATE';
    }
    if (this.state !== 'CANDIDATE' || !this.candidate) return null;
    const candidate = this.candidate;
    candidate.frameCount += 1;
    candidate.sawLeft ||= usable.left; candidate.sawRight ||= usable.right;
    for (const value of [this.left, this.right]) {
      if (value === null) continue;
      candidate.positivePeak = Math.max(candidate.positivePeak, value);
      candidate.negativePeak = Math.min(candidate.negativePeak, value);
    }
    for (const velocity of [this.leftVelocity, this.rightVelocity]) {
      if (velocity !== null) candidate.peakAbsVelocity = Math.max(candidate.peakAbsVelocity, Math.abs(velocity));
    }
    const positive = candidate.positivePeak, negative = Math.abs(candidate.negativePeak);
    if (!(usable.left || usable.right) || timestamp - candidate.startedAt < KICK_CANDIDATE_MIN_MS ||
        !candidate.sawLeft || !candidate.sawRight || Math.max(positive, negative) < KICK_CONFIRM_DISPLACEMENT ||
        candidate.peakAbsVelocity < KICK_CONFIRM_VELOCITY || Math.abs(positive - negative) < KICK_DIRECTION_MARGIN) return null;
    const direction = negative > positive ? 'KNEE_LEFT' : 'KNEE_RIGHT';
    this.state = direction === 'KNEE_LEFT' ? 'TRIGGERED_LEFT' : 'TRIGGERED_RIGHT';
    this.counts[direction] += 1;
    const event: KneeKickEvent = { id: this.counts.KNEE_LEFT + this.counts.KNEE_RIGHT, direction, timestamp };
    this.lastEvent = event;
    candidate.outcome = 'CONFIRMED'; candidate.endedAt = timestamp;
    // TRIGGERED is a one-shot transition; never leave a triggerable held-pose state between frames.
    this.state = 'WAIT_RETURN';
    return { ...event };
  }

  private expireCandidate(now: number): void {
    if (this.state !== 'CANDIDATE' || !this.candidate) return;
    const staleAt = (this.lastUsableAt ?? this.candidate.startedAt) + KICK_STALE_MS;
    const timeoutAt = this.candidate.startedAt + KICK_CANDIDATE_MAX_MS;
    if (now < Math.min(staleAt, timeoutAt)) return;
    this.candidate.outcome = staleAt <= timeoutAt ? 'STALE' : 'TIMED_OUT';
    this.candidate.endedAt = Math.min(staleAt, timeoutAt);
    this.state = 'WAIT_CLEAR'; this.returnStartedAt = null;
  }

  getView(now: number): KneeKickView {
    // A paused video cannot leave a candidate pending indefinitely. Expiration never emits an event.
    this.expireCandidate(now);
    const fresh = this.lastFrameAt !== null && now >= this.lastFrameAt && now - this.lastFrameAt < KICK_STALE_MS;
    if (!fresh) this.returnStartedAt = null;
    const validNow = fresh && (this.usableLeft || this.usableRight);
    return {
      ready: this.baseline !== null, validNow, state: this.state, baseline: this.baseline ? { ...this.baseline } : null,
      usableLeftNow: fresh && this.usableLeft, usableRightNow: fresh && this.usableRight,
      normalizedLeft: fresh ? this.left : null, normalizedRight: fresh ? this.right : null,
      dominantNormalizedDisplacement: fresh ? this.dominant : null,
      normalizedLeftVelocity: fresh ? this.leftVelocity : null, normalizedRightVelocity: fresh ? this.rightVelocity : null,
      currentEvent: validNow && this.lastEvent && now - this.lastEvent.timestamp < KICK_EVENT_DISPLAY_MS ? this.lastEvent.direction : 'NONE',
      lastEvent: this.lastEvent ? { ...this.lastEvent } : null, counts: { ...this.counts },
    };
  }

  /** Read-only instrumentation. Unlike getView(), these reads never expire return dwell. */
  getStateForDiagnostics(): KneeKickState { return this.state; }

  getValuesForDiagnostics() {
    return {
      state: this.state,
      normalizedLeft: this.left, normalizedRight: this.right,
      dominantNormalizedDisplacement: this.dominant,
      normalizedLeftVelocity: this.leftVelocity, normalizedRightVelocity: this.rightVelocity,
      ...this.getCandidateDiagnostics(),
    };
  }

  private getCandidateDiagnostics(): KickCandidateDiagnostics {
    const value = this.candidate;
    const age = value ? Math.max(0, (value.endedAt ?? this.lastFrameAt ?? value.startedAt) - value.startedAt) : null;
    return {
      candidateId: value?.id ?? null, candidateActive: this.state === 'CANDIDATE', candidateStartedAt: value?.startedAt ?? null, candidateAgeMs: age,
      candidatePositivePeak: value?.positivePeak ?? null, candidateNegativePeak: value?.negativePeak ?? null,
      candidatePeakAbsVelocity: value?.peakAbsVelocity ?? null, candidateSawLeft: value?.sawLeft ?? false, candidateSawRight: value?.sawRight ?? false,
      candidateFrameCount: value?.frameCount ?? 0,
      candidateStrongestMagnitude: value ? Math.max(value.positivePeak, Math.abs(value.negativePeak)) : null,
      candidateDirectionMargin: value ? Math.abs(value.positivePeak - Math.abs(value.negativePeak)) : null,
      candidateOutcome: value?.outcome ?? null, candidateEndedAt: value?.endedAt ?? null,
      confirmationLatencyMs: value?.outcome === 'CONFIRMED' ? age : null,
    };
  }

  /** Independent trial: only the frozen Neutral baseline survives. */
  restartTrial(): void {
    const baseline = this.baseline;
    this.reset();
    this.baseline = baseline;
    this.state = baseline ? 'ARMED' : 'NOT_READY';
  }

  reset(): void {
    this.baseline = null; this.state = 'NOT_READY'; this.returnStartedAt = this.lastFrameAt = null;
    this.lastEvent = null; this.counts = { KNEE_LEFT: 0, KNEE_RIGHT: 0 };
    this.left = this.right = this.dominant = this.leftVelocity = this.rightVelocity = null;
    this.previous = null;
    this.candidate = null; this.candidateCount = 0; this.lastUsableAt = null;
    this.usableLeft = this.usableRight = false;
  }
}
