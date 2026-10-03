import type { Limb } from './discoveryFeatures';

export type ShadowState = 'ARMED' | 'CANDIDATE' | 'WAIT_RETURN' | 'WAIT_CLEAR';
export type DirectionStrategy = 'FIRST_DWELL' | 'INTEGRATED_WINDOW';
export interface ShadowConfig { enter: number; dwellMs: number; exit: number; returnDwellMs: number; directionStrategy: DirectionStrategy; decisionWindowMs: number }
export const DEFAULT_SHADOW_CONFIG: ShadowConfig = { enter: 0.4, dwellMs: 50, exit: 0.2, returnDwellMs: 180, directionStrategy: 'FIRST_DWELL', decisionWindowMs: 100 };
export interface ShadowFrame { timestamp: number; LEFT: number | null; RIGHT: number | null; entryEligible?: Record<Limb, boolean> }
interface SideEvidence {
  runStartedAt: number | null; eligibleAt: number | null; integrated: number; peak: number | null;
  previous: number | null; epoch: number;
  entryReacquisition: EntryReacquisition | null;
}
interface EntryReacquisition { timestamp: number; lossAt: number; reason: 'POSE_LOSS' | 'TIMESTAMP_GAP' }
interface Candidate {
  id: number; startedAt: number; side: Limb; firstEligibleAt: number | null;
  decisionStartedAt: number | null; decisionEndsAt: number | null;
  LEFT: SideEvidence; RIGHT: SideEvidence;
}
export interface CandidateDiagnostic {
  id: number; candidateStartedAt: number; candidateSide: Limb;
  leftRunStartedAt: number | null; rightRunStartedAt: number | null;
  leftEligibleAt: number | null; rightEligibleAt: number | null;
  leftIntegratedEvidence: number; rightIntegratedEvidence: number; leftPeak: number | null; rightPeak: number | null;
  decisionStartedAt: number | null; decisionEndsAt: number | null;
}
export type CancelReason = 'POSE_LOSS' | 'TIMESTAMP_GAP' | 'BELOW_ENTER' | 'AMBIGUOUS';
export interface CancelledCandidate extends CandidateDiagnostic { timestamp: number; reason: CancelReason }
interface Recovery { candidateId: number; cancelledAt: number; reason: CancelReason; clearedAt: number }
export interface ShadowEvent extends CandidateDiagnostic {
  id: number; candidateId: number; timestamp: number; side: Limb; direction: 'KNEE_LEFT' | 'KNEE_RIGHT';
  absoluteMargin: number; ratio: number | null; crossGapConfirmation: boolean;
  evidenceEpoch: number; currentEpoch: number; recovery: Recovery | null;
  entryReacquisition: EntryReacquisition | null;
}
export interface Rearm { timestamp: number; side: Limb; from: 'WAIT_RETURN' | 'WAIT_CLEAR';
  waitingSince: number; returnLatencyMs: number; clearRunStartedAt: number; eventId: number | null; candidateId: number | null }
export interface ShadowTransition { timestamp: number; from: ShadowState; to: ShadowState; reason: string; side: Limb | null }

const SIDES = ['LEFT', 'RIGHT'] as const;
const MAX_GAP_MS = 400;
const value = (v: number | null) => v !== null && Number.isFinite(v) && v >= 0 ? v : null;

/** Analysis-only core. No production imports, stage labels, wall clock, UI, velocity or 2D gate. */
export class YKickShadowDetector {
  private state: ShadowState = 'ARMED';
  private previousTimestamp: number | null = null;
  private previousUsable = { LEFT: false, RIGHT: false };
  private epochs = { LEFT: 0, RIGHT: 0 };
  private pendingLoss: Record<Limb, { timestamp: number; reason: 'POSE_LOSS' | 'TIMESTAMP_GAP' } | null> = { LEFT: null, RIGHT: null };
  private reacquired: Record<Limb, EntryReacquisition | null> = { LEFT: null, RIGHT: null };
  private candidate: Candidate | null = null;
  private candidateSequence = 0;
  private waitingSide: Limb | null = null;
  private waitingSince = 0;
  private returnStartedAt: number | null = null;
  private waitingEventId: number | null = null;
  private waitingCancellation: CancelledCandidate | null = null;
  private recovery: Recovery | null = null;
  private events: ShadowEvent[] = [];
  private cancellations: CancelledCandidate[] = [];
  private rearms: Rearm[] = [];
  private transitions: ShadowTransition[] = [];
  readonly config: Readonly<ShadowConfig>;
  constructor(config: ShadowConfig = DEFAULT_SHADOW_CONFIG) {
    if (![config.enter, config.exit, config.dwellMs, config.returnDwellMs, config.decisionWindowMs].every(Number.isFinite) ||
      config.exit <= 0 || config.enter <= config.exit || config.dwellMs < 0 || config.returnDwellMs < 0 || config.decisionWindowMs < 0 ||
      !['FIRST_DWELL', 'INTEGRATED_WINDOW'].includes(config.directionStrategy)) throw new Error('Invalid shadow configuration');
    this.config = Object.freeze({ ...config });
  }
  private transition(to: ShadowState, timestamp: number, reason: string, side: Limb | null) {
    this.transitions.push({ timestamp, from: this.state, to, reason, side }); this.state = to;
  }
  private diagnostic(c: Candidate): CandidateDiagnostic {
    return { id: c.id, candidateStartedAt: c.startedAt, candidateSide: c.side,
      leftRunStartedAt: c.LEFT.runStartedAt, rightRunStartedAt: c.RIGHT.runStartedAt, leftEligibleAt: c.LEFT.eligibleAt, rightEligibleAt: c.RIGHT.eligibleAt,
      leftIntegratedEvidence: c.LEFT.integrated, rightIntegratedEvidence: c.RIGHT.integrated, leftPeak: c.LEFT.peak, rightPeak: c.RIGHT.peak,
      decisionStartedAt: c.decisionStartedAt, decisionEndsAt: c.decisionEndsAt };
  }
  private cancel(timestamp: number, reason: CancelReason) {
    const c = this.candidate!;
    const cancellation = { ...this.diagnostic(c), timestamp, reason };
    this.cancellations.push(cancellation); this.candidate = null;
    if (reason === 'BELOW_ENTER') { this.transition('ARMED', timestamp, reason, c.side); return; }
    this.waitingSide = c.side; this.waitingSince = timestamp; this.returnStartedAt = null;
    this.waitingEventId = null; this.waitingCancellation = cancellation;
    this.transition('WAIT_CLEAR', timestamp, reason, c.side);
  }
  private emit(side: Limb, now: number) {
    const c = this.candidate!, left = c.LEFT.integrated, right = c.RIGHT.integrated;
    const event: ShadowEvent = { ...this.diagnostic(c), id: this.events.length + 1, candidateId: c.id, timestamp: now,
      side, direction: side === 'LEFT' ? 'KNEE_LEFT' : 'KNEE_RIGHT', absoluteMargin: Math.abs(left - right),
      ratio: left + right > 0 ? Math.max(left, right) / (left + right) : null,
      evidenceEpoch: c[side].epoch, currentEpoch: this.epochs[side], crossGapConfirmation: c[side].epoch !== this.epochs[side],
      entryReacquisition: c[side].entryReacquisition ? { ...c[side].entryReacquisition } : null,
      recovery: this.recovery ? { ...this.recovery } : null };
    this.events.push(event); this.candidate = null; this.recovery = null;
    this.waitingSide = side; this.waitingSince = now; this.returnStartedAt = null;
    this.waitingEventId = event.id; this.waitingCancellation = null;
    this.transition('WAIT_RETURN', now, 'EVENT', side);
  }
  processFrame(input: ShadowFrame): void {
    const now = input.timestamp;
    // Duplicated/out-of-order observations cannot advance dwell or reconstruct evidence.
    if (!Number.isFinite(now) || (this.previousTimestamp !== null && now <= this.previousTimestamp)) return;
    const values = { LEFT: value(input.LEFT), RIGHT: value(input.RIGHT) };
    const dt = this.previousTimestamp === null ? 0 : now - this.previousTimestamp;
    const gap = dt >= MAX_GAP_MS;
    for (const side of SIDES) {
      this.reacquired[side] = null;
      if (values[side] === null) this.pendingLoss[side] ??= { timestamp: now, reason: 'POSE_LOSS' };
      else if (this.pendingLoss[side] || gap) {
        const loss = this.pendingLoss[side] ?? { timestamp: this.previousTimestamp!, reason: 'TIMESTAMP_GAP' as const };
        this.reacquired[side] = { timestamp: now, lossAt: loss.timestamp, reason: loss.reason }; this.pendingLoss[side] = null;
      }
      if (gap || (this.previousUsable[side] && values[side] === null)) this.epochs[side]++;
      this.previousUsable[side] = values[side] !== null;
    }
    const before = this.previousTimestamp; this.previousTimestamp = now;
    if (this.state === 'WAIT_RETURN' || this.state === 'WAIT_CLEAR') {
      const side = this.waitingSide!, observed = values[side];
      if (gap || observed === null || observed >= this.config.exit) this.returnStartedAt = null;
      if (observed !== null && observed < this.config.exit) {
        this.returnStartedAt ??= now;
        if (now - this.returnStartedAt >= this.config.returnDwellMs) {
          this.rearms.push({ timestamp: now, side, from: this.state, waitingSince: this.waitingSince,
            returnLatencyMs: now - this.waitingSince, clearRunStartedAt: this.returnStartedAt, eventId: this.waitingEventId,
            candidateId: this.waitingCancellation?.id ?? null });
          if (this.waitingCancellation) this.recovery = { candidateId: this.waitingCancellation.id,
            cancelledAt: this.waitingCancellation.timestamp, reason: this.waitingCancellation.reason, clearedAt: now };
          this.transition('ARMED', now, 'OBSERVED_CLEAR_DWELL', side);
          this.waitingSide = null; this.returnStartedAt = null; this.waitingCancellation = null; this.waitingEventId = null;
        }
      }
      return;
    }
    if (this.candidate && (values[this.candidate.side] === null || gap)) {
      this.cancel(now, values[this.candidate.side] === null ? 'POSE_LOSS' : 'TIMESTAMP_GAP'); return;
    }
    if (this.state === 'ARMED') {
      const active = SIDES.filter((side) => input.entryEligible?.[side] !== false && values[side] !== null && values[side]! >= this.config.enter);
      if (!active.length) return;
      // Seed/clear owner only; equal simultaneous onset never chooses an EVENT direction here.
      const side = active.length === 1 || values.LEFT! >= values.RIGHT! ? active[0] : 'RIGHT';
      const empty = (side: Limb): SideEvidence => ({ runStartedAt: null, eligibleAt: null, integrated: 0, peak: null, previous: null, epoch: this.epochs[side], entryReacquisition: null });
      this.candidate = { id: ++this.candidateSequence, startedAt: now, side, firstEligibleAt: null, decisionStartedAt: null,
        decisionEndsAt: null, LEFT: empty('LEFT'), RIGHT: empty('RIGHT') };
      this.transition('CANDIDATE', now, 'ENTER', side);
    }
    const c = this.candidate!;
    for (const side of SIDES) {
      const s = c[side], current = values[side];
      if (current === null || input.entryEligible?.[side] === false) {
        // Analysis-only reacquisition eligibility. Physical usability still controls loss epochs,
        // cancellation and WAIT_RETURN/CLEAR; a disarmed opponent cannot contribute evidence.
        // Opponent loss does not cancel the owner, but none of that side's earlier evidence survives.
        s.runStartedAt = null; s.eligibleAt = null; s.integrated = 0; s.peak = null; s.previous = null; s.epoch = this.epochs[side]; s.entryReacquisition = null; continue;
      }
      if (s.previous !== null && before !== null && dt > 0 && dt < MAX_GAP_MS) {
        const end = c.decisionEndsAt === null ? now : Math.min(now, c.decisionEndsAt);
        const start = c.decisionStartedAt === null ? before : Math.max(before, c.decisionStartedAt);
        if (end > start) {
          const previousExcess = Math.max(0, s.previous - this.config.enter), excess = Math.max(0, current - this.config.enter);
          const at = (t: number) => previousExcess + (excess - previousExcess) * ((t - before) / dt);
          s.integrated += (at(start) + at(end)) / 2 * (end - start) / 1000;
        }
      }
      s.peak = Math.max(s.peak ?? 0, current); s.previous = current;
      if (current >= this.config.enter) {
        if (s.runStartedAt === null && s.eligibleAt === null) s.entryReacquisition = this.reacquired[side];
        s.runStartedAt ??= now;
        if (now - s.runStartedAt >= this.config.dwellMs) s.eligibleAt ??= now;
      } else { s.runStartedAt = null; if (s.eligibleAt === null) s.entryReacquisition = null; }
    }
    const eligible = SIDES.filter((side) => c[side].eligibleAt !== null && (c.decisionEndsAt === null || c[side].eligibleAt! <= c.decisionEndsAt));
    if (eligible.length && c.firstEligibleAt === null) {
      c.firstEligibleAt = now;
      if (eligible.length === 1) c.side = eligible[0];
      if (this.config.directionStrategy === 'INTEGRATED_WINDOW') {
        c.decisionStartedAt = now; c.decisionEndsAt = now + this.config.decisionWindowMs;
        c.LEFT.integrated = 0; c.RIGHT.integrated = 0;
      }
    }
    if (this.config.directionStrategy === 'FIRST_DWELL' && eligible.length) {
      if (eligible.length === 2 && c.LEFT.eligibleAt === c.RIGHT.eligibleAt) this.cancel(now, 'AMBIGUOUS');
      else this.emit(eligible.length === 1 ? eligible[0] : c.LEFT.eligibleAt! < c.RIGHT.eligibleAt! ? 'LEFT' : 'RIGHT', now);
    } else if (this.config.directionStrategy === 'INTEGRATED_WINDOW' && c.decisionEndsAt !== null && now >= c.decisionEndsAt) {
      if (eligible.length === 1) this.emit(eligible[0], now);
      else if (Math.abs(c.LEFT.integrated - c.RIGHT.integrated) <= 1e-8) this.cancel(now, 'AMBIGUOUS');
      else this.emit(c.LEFT.integrated > c.RIGHT.integrated ? 'LEFT' : 'RIGHT', now);
    } else if (!eligible.length && SIDES.every((side) => input.entryEligible?.[side] === false || values[side] === null || values[side]! < this.config.enter)) this.cancel(now, 'BELOW_ENTER');
  }
  getState(): ShadowState { return this.state; }
  getSnapshot() {
    return { state: this.state, waitingSide: this.waitingSide, returnStartedAt: this.returnStartedAt,
      candidate: this.candidate ? this.diagnostic(this.candidate) : null };
  }
  result() {
    return { ...this.getSnapshot(), events: structuredClone(this.events), cancelledCandidates: structuredClone(this.cancellations),
      rearmTimes: structuredClone(this.rearms), transitions: structuredClone(this.transitions) };
  }
}
