import type { KneeKickEvent, KneeKickState, RemoteKneeKickState } from '@plank-stork/protocol';
import { finite, type KneeMotionFeatures } from '../motion/kneeMotionFeatures';
import { KICK_HIP_VISIBILITY, KICK_KNEE_VISIBILITY, MIN_KICK_BODY_SCALE, KICK_STALE_MS, KICK_EVENT_DISPLAY_MS } from './kneeKickDetector';

// EXPERIMENTAL production candidate: one user / limited CLEAN+STRESS fixtures.
// These are NOT universal thresholds. Revalidate on new users/cameras before rollout.
export const Y_KICK_ENTER = 0.40;
export const Y_KICK_ENTER_DWELL_MS = 50;
export const Y_KICK_CLEAR_THRESHOLD = 0.25;
export const Y_KICK_CLEAR_DWELL_MS = 100;
export const Y_TRACKING_LOSS_MIN_MS = 33;
export { KICK_STALE_MS }; // 400ms, shared freshness/continuity boundary.
export const Y_KICK_V3_CONFIG = { version: 3, experimental: true, evidence: 'abs(deltaDyNorm)', direction: 'LANDMARK_IDENTITY',
  enter: Y_KICK_ENTER, enterDwellMs: Y_KICK_ENTER_DWELL_MS, clearThreshold: Y_KICK_CLEAR_THRESHOLD,
  clearDwellMs: Y_KICK_CLEAR_DWELL_MS, trackingLossMinMs: Y_TRACKING_LOSS_MIN_MS, staleMs: KICK_STALE_MS,
  hipVisibility: KICK_HIP_VISIBILITY, kneeVisibility: KICK_KNEE_VISIBILITY,
  arbitration: 'FIRST_DWELL; simultaneous -> integrated supra-threshold area; exact tie -> WAIT_CLEAR BOTH' } as const;

export interface KneeKickBaselineV3 {
  version: 3; leftXMedian: number; rightXMedian: number; leftYMedian: number; rightYMedian: number;
  leftDistanceMedian: number; rightDistanceMedian: number; bodyScale: number;
}
export function validKneeKickBaselineV3(value: unknown): value is KneeKickBaselineV3 {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.version === 3 && ['leftXMedian', 'rightXMedian', 'leftYMedian', 'rightYMedian', 'leftDistanceMedian', 'rightDistanceMedian', 'bodyScale']
    .every((key) => typeof v[key] === 'number' && Number.isFinite(v[key])) && (v.bodyScale as number) >= MIN_KICK_BODY_SCALE;
}
export function usableKneesV3(f: KneeMotionFeatures) {
  const visible = (v: number | null, min: number) => finite(v) && v >= min;
  const hips = visible(f.leftHipVisibility, KICK_HIP_VISIBILITY) && visible(f.rightHipVisibility, KICK_HIP_VISIBILITY) &&
    finite(f.hipCenterX) && finite(f.hipCenterY);
  return { hips,
    left: hips && visible(f.leftKneeVisibility, KICK_KNEE_VISIBILITY) && finite(f.leftKneeX) && finite(f.leftKneeY) && finite(f.leftKneeCenterOffsetY),
    right: hips && visible(f.rightKneeVisibility, KICK_KNEE_VISIBILITY) && finite(f.rightKneeX) && finite(f.rightKneeY) && finite(f.rightKneeCenterOffsetY) };
}
export type KickSideV3 = 'LEFT' | 'RIGHT';
export type KickTrackingV3 = 'READY' | 'LOST' | 'REACQUIRED_NOT_READY';
export type KickEventSourceV3 = 'NORMAL_TRACKING' | 'POST_REACQUISITION';
interface SideState {
  y: number | null; x: number | null; usable: boolean; tracking: KickTrackingV3;
  lossStartedAt: number | null; lastLossDurationMs: number | null; reacquiredAt: number | null; disarmed: boolean;
  clearStartedAt: number | null; runStartedAt: number | null; integrated: number; previousEvidence: number | null;
  epoch: number; runEpoch: number;
}
const emptySide = (): SideState => ({ y: null, x: null, usable: false, tracking: 'LOST', lossStartedAt: null,
  lastLossDurationMs: null, reacquiredAt: null, disarmed: false, clearStartedAt: null, runStartedAt: null,
  integrated: 0, previousEvidence: null, epoch: 0, runEpoch: 0 });
const SIDES = ['LEFT', 'RIGHT'] as const;
export interface KneeKickEventV3 extends KneeKickEvent {
  eventSource: KickEventSourceV3; candidateStartedAt: number; confirmationLatencyMs: number;
  candidateStartedTrackingAgeMs: number; reacquiredAt: number | null;
  integratedEvidence: number; opponentIntegratedEvidence: number;
  crossGapConfirmation: boolean; evidenceEpoch: number; currentEpoch: number;
}

/** Production candidate core: raw features + frozen baseline + recorded/inference timestamps only.
 * Reacquisition gates disable just that side's input. Never pause a game or Guided timeline.
 * Gestures while tracking is lost may intentionally MISS. No smoothing or dynamic rebaseline.
 */
export class KneeKickDetectorV3 {
  private baseline: KneeKickBaselineV3 | null = null;
  private sides = { LEFT: emptySide(), RIGHT: emptySide() };
  private state: KneeKickState = 'NOT_READY';
  private lastFrameAt: number | null = null;
  private firstFrameAt: number | null = null;
  private triggeredSide: KickSideV3 | null = null;
  private returnStartedAt: number | null = null;
  private lastEvent: KneeKickEventV3 | null = null;
  private counts = { KNEE_LEFT: 0, KNEE_RIGHT: 0 };
  private poseLossRunResets = 0;
  private gapRunResets = 0;
  private ambiguityCount = 0;
  private hipLossStartedAt: number | null = null;
  private hipLossEpisodes = 0;

  setBaseline(baseline: KneeKickBaselineV3 | null) {
    this.reset();
    if (!validKneeKickBaselineV3(baseline)) return;
    this.baseline = { ...baseline }; this.state = 'ARMED';
  }
  private resetRun(s: SideState) { s.runStartedAt = null; s.integrated = 0; s.previousEvidence = null; }
  private clearRun(s: SideState, now: number, gap: boolean) {
    if (gap || !s.usable || s.y === null || Math.abs(s.y) >= Y_KICK_CLEAR_THRESHOLD) s.clearStartedAt = null;
    if (s.usable && s.y !== null && Math.abs(s.y) < Y_KICK_CLEAR_THRESHOLD) s.clearStartedAt ??= now;
    return s.clearStartedAt !== null && now - s.clearStartedAt >= Y_KICK_CLEAR_DWELL_MS;
  }
  processFrame(features: KneeMotionFeatures, timestamp: number): KneeKickEventV3 | null {
    if (!finite(timestamp) || (this.lastFrameAt !== null && timestamp <= this.lastFrameAt)) return null;
    const previousAt = this.lastFrameAt, dt = previousAt === null ? 0 : timestamp - previousAt, gap = dt >= KICK_STALE_MS;
    this.lastFrameAt = timestamp; this.firstFrameAt ??= timestamp;
    if (!this.baseline) return null;
    const usable = usableKneesV3(features), baseline = this.baseline;
    if (!usable.hips) this.hipLossStartedAt ??= timestamp;
    else if (this.hipLossStartedAt !== null) {
      if (timestamp - this.hipLossStartedAt >= Y_TRACKING_LOSS_MIN_MS) this.hipLossEpisodes++;
      this.hipLossStartedAt = null;
    }
    for (const side of SIDES) {
      const s = this.sides[side], left = side === 'LEFT';
      s.usable = left ? usable.left : usable.right;
      s.y = s.usable ? ((left ? features.leftKneeCenterOffsetY! : features.rightKneeCenterOffsetY!) - (left ? baseline.leftYMedian : baseline.rightYMedian)) / baseline.bodyScale : null;
      if (!finite(s.y)) { s.y = null; s.usable = false; }
      const x = left ? features.leftKneeCenterOffsetX : features.rightKneeCenterOffsetX;
      s.x = s.usable && finite(x) ? (x - (left ? baseline.leftXMedian : baseline.rightXMedian)) / baseline.bodyScale : null;
      if (!finite(s.x)) s.x = null;
      if (gap || !s.usable) {
        if (s.runStartedAt !== null) { if (gap) this.gapRunResets++; else this.poseLossRunResets++; }
        this.resetRun(s); s.clearStartedAt = null;
        if (s.lossStartedAt === null) { s.lossStartedAt = gap ? previousAt! : timestamp; s.epoch++; }
      }
      if (!s.usable) {
        if (timestamp - s.lossStartedAt! >= Y_TRACKING_LOSS_MIN_MS) s.disarmed = true;
        s.tracking = 'LOST'; continue;
      }
      if (s.lossStartedAt !== null) {
        s.lastLossDurationMs = timestamp - s.lossStartedAt;
        s.disarmed ||= s.lastLossDurationMs >= Y_TRACKING_LOSS_MIN_MS;
        s.reacquiredAt = timestamp; s.lossStartedAt = null; s.clearStartedAt = null;
      }
      const cleared = this.clearRun(s, timestamp, gap);
      if (s.disarmed && cleared) s.disarmed = false;
      s.tracking = s.disarmed ? 'REACQUIRED_NOT_READY' : 'READY';
    }
    if (this.state === 'WAIT_RETURN') {
      const s = this.sides[this.triggeredSide!];
      if (gap || !s.usable || Math.abs(s.y!) >= Y_KICK_CLEAR_THRESHOLD) this.returnStartedAt = null;
      if (s.usable && Math.abs(s.y!) < Y_KICK_CLEAR_THRESHOLD) {
        this.returnStartedAt ??= timestamp;
        if (timestamp - this.returnStartedAt >= Y_KICK_CLEAR_DWELL_MS) {
          this.state = 'ARMED'; this.triggeredSide = null; this.returnStartedAt = null;
        }
      }
      return null;
    }
    if (this.state === 'WAIT_CLEAR') {
      // An exact simultaneous tie has no owner. BOTH need observed continuous clear.
      if (SIDES.every((side) => this.sides[side].tracking === 'READY' && this.sides[side].clearStartedAt !== null &&
        timestamp - this.sides[side].clearStartedAt! >= Y_KICK_CLEAR_DWELL_MS)) this.state = 'ARMED';
      return null;
    }
    for (const side of SIDES) {
      const s = this.sides[side], evidence = s.y === null ? null : Math.abs(s.y);
      if (s.tracking !== 'READY' || evidence === null || evidence < Y_KICK_ENTER) { this.resetRun(s); continue; }
      if (s.runStartedAt === null) { s.runStartedAt = timestamp; s.runEpoch = s.epoch; }
      else if (s.previousEvidence !== null && dt > 0 && dt < KICK_STALE_MS) {
        s.integrated += (Math.max(0, s.previousEvidence - Y_KICK_ENTER) + Math.max(0, evidence - Y_KICK_ENTER)) / 2 * dt / 1000;
      }
      s.previousEvidence = evidence;
    }
    const eligible = SIDES.filter((side) => this.sides[side].runStartedAt !== null && timestamp - this.sides[side].runStartedAt! >= Y_KICK_ENTER_DWELL_MS);
    this.state = SIDES.some((side) => this.sides[side].runStartedAt !== null) ? 'CANDIDATE' : 'ARMED';
    if (!eligible.length) return null;
    // First observed completion wins. If both complete on this timestamp, compare integrated
    // supra-threshold evidence, not an invented sub-frame completion or arbitrary LEFT tie-break.
    let winner = eligible[0];
    if (eligible.length === 2) {
      if (this.sides.LEFT.integrated === this.sides.RIGHT.integrated) {
        this.ambiguityCount++; this.state = 'WAIT_CLEAR';
        for (const side of SIDES) { this.resetRun(this.sides[side]); this.sides[side].clearStartedAt = null; }
        return null;
      }
      winner = this.sides.LEFT.integrated > this.sides.RIGHT.integrated ? 'LEFT' : 'RIGHT';
    }
    const s = this.sides[winner], direction = winner === 'LEFT' ? 'KNEE_LEFT' : 'KNEE_RIGHT';
    this.counts[direction]++;
    const event: KneeKickEventV3 = { id: this.counts.KNEE_LEFT + this.counts.KNEE_RIGHT,
      direction, timestamp, eventSource: s.reacquiredAt === null ? 'NORMAL_TRACKING' : 'POST_REACQUISITION',
      candidateStartedAt: s.runStartedAt!, confirmationLatencyMs: timestamp - s.runStartedAt!,
      candidateStartedTrackingAgeMs: s.runStartedAt! - (s.reacquiredAt ?? this.firstFrameAt!), reacquiredAt: s.reacquiredAt,
      integratedEvidence: s.integrated, opponentIntegratedEvidence: this.sides[winner === 'LEFT' ? 'RIGHT' : 'LEFT'].integrated,
      crossGapConfirmation: s.runEpoch !== s.epoch, evidenceEpoch: s.runEpoch, currentEpoch: s.epoch };
    this.lastEvent = event; this.triggeredSide = winner; this.returnStartedAt = null; this.state = 'WAIT_RETURN';
    for (const side of SIDES) this.resetRun(this.sides[side]);
    return { ...event };
  }
  getValuesForDiagnostics() {
    const left = this.sides.LEFT, right = this.sides.RIGHT, now = this.lastFrameAt ?? 0;
    const elapsed = (at: number | null) => at === null ? 0 : now - at;
    return { state: this.state, normalizedYLeft: left.y, normalizedYRight: right.y,
      normalizedXLeft: left.x, normalizedXRight: right.x,
      leftEnterRunMs: elapsed(left.runStartedAt), rightEnterRunMs: elapsed(right.runStartedAt),
      leftCandidateStartedAt: left.runStartedAt, rightCandidateStartedAt: right.runStartedAt,
      leftIntegratedEvidence: left.integrated, rightIntegratedEvidence: right.integrated,
      triggeredSide: this.triggeredSide, leftTrackingState: left.tracking, rightTrackingState: right.tracking,
      leftEligibleNow: (this.state === 'ARMED' || this.state === 'CANDIDATE') && left.tracking === 'READY',
      rightEligibleNow: (this.state === 'ARMED' || this.state === 'CANDIDATE') && right.tracking === 'READY',
      leftLossStartedAt: left.lossStartedAt, rightLossStartedAt: right.lossStartedAt,
      leftLossDurationMs: left.lastLossDurationMs, rightLossDurationMs: right.lastLossDurationMs,
      leftReacquiredAt: left.reacquiredAt, rightReacquiredAt: right.reacquiredAt,
      leftClearRunMs: elapsed(left.clearStartedAt), rightClearRunMs: elapsed(right.clearStartedAt),
      returnRunMs: elapsed(this.returnStartedAt), hipLossStartedAt: this.hipLossStartedAt, hipLossEpisodes: this.hipLossEpisodes,
      poseLossRunResets: this.poseLossRunResets, gapRunResets: this.gapRunResets, ambiguityCount: this.ambiguityCount,
      lastEvent: this.lastEvent ? { ...this.lastEvent } : null };
  }
  getView(now: number): RemoteKneeKickState & { baseline: KneeKickBaselineV3 | null; diagnostics: ReturnType<KneeKickDetectorV3['getValuesForDiagnostics']> } {
    const fresh = this.lastFrameAt !== null && now >= this.lastFrameAt && now - this.lastFrameAt < KICK_STALE_MS;
    const validNow = fresh && (this.sides.LEFT.usable || this.sides.RIGHT.usable);
    const diagnostics = this.getValuesForDiagnostics();
    if (!fresh) {
      diagnostics.normalizedYLeft = diagnostics.normalizedYRight = diagnostics.normalizedXLeft = diagnostics.normalizedXRight = null;
      diagnostics.leftTrackingState = diagnostics.rightTrackingState = 'LOST';
      diagnostics.leftEligibleNow = diagnostics.rightEligibleNow = false;
      diagnostics.leftEnterRunMs = diagnostics.rightEnterRunMs = diagnostics.leftClearRunMs = diagnostics.rightClearRunMs = diagnostics.returnRunMs = 0;
    }
    return { ready: this.baseline !== null, validNow, state: this.state, usableLeftNow: fresh && this.sides.LEFT.usable, usableRightNow: fresh && this.sides.RIGHT.usable,
      currentEvent: validNow && this.lastEvent && now - this.lastEvent.timestamp < KICK_EVENT_DISPLAY_MS ? this.lastEvent.direction : 'NONE',
      lastEvent: this.lastEvent ? { ...this.lastEvent } : null, counts: { ...this.counts }, baseline: this.baseline ? { ...this.baseline } : null, diagnostics };
  }
  /** Passive capture snapshot. No clock read or state transitions. */
  getReplaySnapshot() {
    return { baseline: this.baseline ? { ...this.baseline } : null, state: this.state,
      eventsLast: this.lastEvent ? { ...this.lastEvent } : null, counts: { ...this.counts } };
  }
  getStateForDiagnostics() { return this.state; }
  restartTrial() { const baseline = this.baseline; this.setBaseline(baseline); }
  reset() {
    this.baseline = null; this.sides = { LEFT: emptySide(), RIGHT: emptySide() }; this.state = 'NOT_READY';
    this.lastFrameAt = this.firstFrameAt = this.returnStartedAt = null; this.triggeredSide = null; this.lastEvent = null;
    this.counts = { KNEE_LEFT: 0, KNEE_RIGHT: 0 }; this.poseLossRunResets = this.gapRunResets = this.ambiguityCount = this.hipLossEpisodes = 0; this.hipLossStartedAt = null;
  }
}
