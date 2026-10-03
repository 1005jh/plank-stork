import { DISCOVERY_SETTINGS, LIMBS, type Limb } from './discoveryFeatures';
import type { EvidencePair } from './temporalEvidence';

export type GateStrategy = 'FIXED_SETTLE' | 'CLEAR_ONLY' | 'SETTLE_AND_CLEAR';
export interface ReacquisitionConfig {
  lossMinMs: number; strategy: GateStrategy; settleMs: number; clearThreshold: number | null; clearDwellMs: number;
}
export interface GateFrame { timestamp: number; LEFT: number | null; RIGHT: number | null; hipUsable: boolean }
export interface LossEpisode {
  side: Limb; lastUsableBeforeGapMs: number | null; gapStartedAt: number; gapEndedAt: number;
  gapDurationMs: number; usableToUsableGapMs: number | null; reacquiredAt: number;
  reason: 'POSE_LOSS' | 'TIMESTAMP_GAP'; hipLossObserved: boolean;
  qualifies: boolean; gateApplied: boolean; continuedGate: boolean;
  readyAt: number | null; addedEligibilityLatencyMs: number | null; interruptedAt: number | null;
}
interface SideState {
  lastUsable: number | null;
  loss: { startedAt: number; lastUsable: number | null; reason: LossEpisode['reason']; hipLoss: boolean } | null;
  blocked: boolean; reacquiredAt: number | null; clearStartedAt: number | null; active: LossEpisode | null;
  tracking: 'USABLE' | 'LOST'; state: 'READY' | 'LOST' | 'REACQUIRED_NOT_READY';
}
const empty = (): SideState => ({ lastUsable: null, loss: null, blocked: false, reacquiredAt: null,
  clearStartedAt: null, active: null, tracking: 'LOST', state: 'LOST' });
const usable = (v: number | null): v is number => v !== null && Number.isFinite(v) && v >= 0;
export function gateFrame(frame: EvidencePair): GateFrame {
  const hips = frame.LEFT.visibility;
  return { timestamp: frame.timestamp, LEFT: frame.LEFT.usable ? frame.LEFT.absY : null, RIGHT: frame.RIGHT.usable ? frame.RIGHT.absY : null,
    hipUsable: [hips.leftHip, hips.rightHip].every((v) => v !== null && Number.isFinite(v) && v >= DISCOVERY_SETTINGS.hipVisibility) };
}

/** Analysis only. Disable this side's input, never pause a game/timeline or ask the user to wait.
 * A gesture during tracking loss may intentionally MISS; reappearing mid-kick is not a new gesture.
 * Missing-frame duration = first unusable observation -> first usable observation. A >=400ms
 * timestamp gap starts at the previous observation. Initial missing observations count too.
 */
export class ReacquisitionGate {
  private sides = { LEFT: empty(), RIGHT: empty() };
  private previous: number | null = null;
  private episodes: LossEpisode[] = [];
  private hipLosses: { startedAt: number; endedAt: number | null }[] = [];
  private hipLost = false;
  readonly config: Readonly<ReacquisitionConfig>;
  constructor(config: ReacquisitionConfig) {
    if (![config.lossMinMs, config.settleMs, config.clearDwellMs].every((v) => Number.isFinite(v) && v >= 0) ||
      !['FIXED_SETTLE', 'CLEAR_ONLY', 'SETTLE_AND_CLEAR'].includes(config.strategy) ||
      (config.strategy !== 'FIXED_SETTLE' && (config.clearThreshold === null || !Number.isFinite(config.clearThreshold) || config.clearThreshold <= 0))) {
      throw new Error('Invalid reacquisition gate configuration');
    }
    this.config = Object.freeze({ ...config });
  }
  processFrame(frame: GateFrame): Record<Limb, boolean> {
    const now = frame.timestamp;
    if (!Number.isFinite(now) || (this.previous !== null && now <= this.previous)) return this.eligibility();
    const gap = this.previous !== null && now - this.previous >= 400;
    if (!frame.hipUsable && !this.hipLost) this.hipLosses.push({ startedAt: now, endedAt: null });
    if (frame.hipUsable && this.hipLost) this.hipLosses.at(-1)!.endedAt = now;
    this.hipLost = !frame.hipUsable;
    for (const side of LIMBS) {
      const s = this.sides[side], observed = frame.hipUsable && usable(frame[side]);
      if (gap || !observed) {
        s.loss ??= { startedAt: gap ? this.previous! : now, lastUsable: s.lastUsable,
          reason: gap ? 'TIMESTAMP_GAP' : 'POSE_LOSS', hipLoss: false };
        s.loss.hipLoss ||= !frame.hipUsable;
        s.clearStartedAt = null;
        if (s.active && s.active.readyAt === null) s.active.interruptedAt ??= now;
      }
      if (!observed) { s.tracking = 'LOST'; s.state = 'LOST'; continue; }
      s.tracking = 'USABLE';
      if (s.loss) {
        const loss = s.loss, qualifies = now - loss.startedAt >= this.config.lossMinMs;
        const episode: LossEpisode = { side, lastUsableBeforeGapMs: loss.lastUsable, gapStartedAt: loss.startedAt, gapEndedAt: now,
          gapDurationMs: now - loss.startedAt, usableToUsableGapMs: loss.lastUsable === null ? null : now - loss.lastUsable,
          reacquiredAt: now, reason: loss.reason, hipLossObserved: loss.hipLoss, qualifies,
          gateApplied: qualifies || s.blocked, continuedGate: s.blocked, readyAt: null, addedEligibilityLatencyMs: null, interruptedAt: null };
        this.episodes.push(episode); s.active = episode; s.blocked = episode.gateApplied;
        s.reacquiredAt = now; s.clearStartedAt = null; s.loss = null;
      }
      if (s.blocked) {
        if (this.config.clearThreshold !== null && frame[side]! < this.config.clearThreshold) s.clearStartedAt ??= now;
        else s.clearStartedAt = null;
        const settled = this.config.strategy === 'CLEAR_ONLY' || now - s.reacquiredAt! >= this.config.settleMs;
        const cleared = this.config.strategy === 'FIXED_SETTLE' ||
          (s.clearStartedAt !== null && now - s.clearStartedAt >= this.config.clearDwellMs);
        // AND uses the current continuous clear run; clear and settle clocks may overlap.
        if (settled && cleared) s.blocked = false;
      }
      s.state = s.blocked ? 'REACQUIRED_NOT_READY' : 'READY'; s.lastUsable = now;
      if (!s.blocked && s.active && s.active.readyAt === null) {
        s.active.readyAt = now; s.active.addedEligibilityLatencyMs = now - s.active.reacquiredAt;
      }
    }
    this.previous = now;
    return this.eligibility();
  }
  private eligibility(): Record<Limb, boolean> { return { LEFT: this.sides.LEFT.state === 'READY', RIGHT: this.sides.RIGHT.state === 'READY' }; }
  result() {
    const side = (s: SideState) => ({ tracking: s.tracking, state: s.state, reacquiredAt: s.reacquiredAt,
      clearStartedAt: s.clearStartedAt, pendingLoss: s.loss ? { ...s.loss } : null });
    return { sides: { LEFT: side(this.sides.LEFT), RIGHT: side(this.sides.RIGHT) },
      episodes: structuredClone(this.episodes), hipLosses: structuredClone(this.hipLosses) };
  }
}
