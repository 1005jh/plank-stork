import { LIMBS, type Limb } from './discoveryFeatures';
import type { Channel, MultiFrame } from './multiSignalFeatures';
import { Y_KICK_ENTER, Y_KICK_ENTER_DWELL_MS, Y_KICK_CLEAR_THRESHOLD, Y_KICK_CLEAR_DWELL_MS,
  Y_TRACKING_LOSS_MIN_MS, KICK_STALE_MS } from '../pose/kick/kneeKickDetectorV3';

export type MultiStrategy = 'Y_ONLY' | 'X_ONLY_CONTROL' | 'Y_OR_X_CONTROL' | 'Y_OR_FLEXION';
export type ReturnPolicy = 'TRIGGER_CHANNEL_CLEAR' | 'ALL_AVAILABLE_CHANNELS_CLEAR';
export interface MultiConfig {
  strategy: MultiStrategy; xEnter: number; xDwellMs: number;
  flexEnter: number; flexDwellMs: number; flexClear: number; flexClearDwellMs: number; returnPolicy: ReturnPolicy;
}
export const MULTI_DEFAULT: MultiConfig = { strategy: 'Y_ONLY', xEnter: .28, xDwellMs: 50,
  flexEnter: 10, flexDwellMs: 50, flexClear: 5, flexClearDwellMs: 100, returnPolicy: 'TRIGGER_CHANNEL_CLEAR' };
export const MULTI_SWEEP = { xEnter: [.28, .30, .34, .40], flexEnter: [8, 10, 12, 15, 20],
  dwellMs: [33, 50, 67, 80, 100], flexClear: [3, 5, 8], flexClearDwellMs: [100, 150, 180] } as const;
export function multiConfigs(): MultiConfig[] {
  const configs: MultiConfig[] = [{ ...MULTI_DEFAULT }];
  for (const strategy of ['X_ONLY_CONTROL', 'Y_OR_X_CONTROL'] as const)
    for (const xEnter of MULTI_SWEEP.xEnter) for (const xDwellMs of MULTI_SWEEP.dwellMs) configs.push({ ...MULTI_DEFAULT, strategy, xEnter, xDwellMs });
  for (const flexEnter of MULTI_SWEEP.flexEnter) for (const flexDwellMs of MULTI_SWEEP.dwellMs)
    for (const flexClear of MULTI_SWEEP.flexClear) for (const flexClearDwellMs of MULTI_SWEEP.flexClearDwellMs)
      for (const returnPolicy of ['TRIGGER_CHANNEL_CLEAR', 'ALL_AVAILABLE_CHANNELS_CLEAR'] as const)
        configs.push({ ...MULTI_DEFAULT, strategy: 'Y_OR_FLEXION', flexEnter, flexDwellMs, flexClear, flexClearDwellMs, returnPolicy });
  return configs;
}
export function multiConfigId(c: MultiConfig) {
  return c.strategy === 'Y_ONLY' ? c.strategy : c.strategy === 'X_ONLY_CONTROL' || c.strategy === 'Y_OR_X_CONTROL' ? `${c.strategy}/${c.xEnter}/${c.xDwellMs}`
    : `${c.strategy}/${c.flexEnter}/${c.flexDwellMs}/${c.flexClear}/${c.flexClearDwellMs}/${c.returnPolicy}`;
}
export function activeChannels(c: MultiConfig): Channel[] {
  return c.strategy === 'Y_ONLY' ? ['Y'] : c.strategy === 'X_ONLY_CONTROL' ? ['X'] : c.strategy === 'Y_OR_X_CONTROL' ? ['Y', 'X'] : ['Y', 'FLEXION'];
}
interface ChannelState {
  value: number | null; tracking: 'READY' | 'LOST' | 'REACQUIRED_NOT_READY' | 'FLEX_REACQUIRED_NOT_READY';
  lossAt: number | null; reacquiredAt: number | null; disarmed: boolean; clearAt: number | null;
  epoch: number; runEpoch: number; runAt: number | null; integrated: number; previousEvidence: number | null;
  episode: number | null;
}
const empty = (): ChannelState => ({ value: null, tracking: 'LOST', lossAt: null, reacquiredAt: null, disarmed: false,
  clearAt: null, epoch: 0, runEpoch: 0, runAt: null, integrated: 0, previousEvidence: null, episode: null });
const side = () => ({ Y: empty(), X: empty(), FLEXION: empty() });
type State = 'ARMED' | 'CANDIDATE' | 'WAIT_RETURN' | 'WAIT_CLEAR';
export interface MultiEvent {
  id: number; timestamp: number; side: Limb; direction: 'KNEE_LEFT' | 'KNEE_RIGHT';
  triggerSource: 'Y' | 'X' | 'FLEXION' | 'BOTH' | 'Y_X_BOTH'; channels: Channel[];
  candidateStartedAt: number; confirmationLatencyMs: number;
  normalizedIntegrated: Partial<Record<Channel, number>>; opponentScore: number;
  epochs: Partial<Record<Channel, { run: number; current: number }>>;
  crossGap: boolean; source: 'NORMAL_TRACKING' | 'POST_REACQUISITION';
}
interface Episode { side: Limb; channel: Channel; startedAt: number; reacquiredAt: number; durationMs: number;
  gated: boolean; readyAt: number | null; interruptedAt: number | null }

/** Analysis only. No imports/calls from live useKneeKick. Independent channel runs and gates,
 * frozen input features, recorded timestamps, one global event/return latch. */
export class MultiSignalShadow {
  readonly config: Readonly<MultiConfig>;
  private sides = { LEFT: side(), RIGHT: side() };
  private previousAt: number | null = null;
  private state: State = 'ARMED';
  private count = 0;
  private latched: { side: Limb; channels: Channel[] }[] = [];
  private returnRuns: Partial<Record<`${Limb}/${Channel}`, number>> = {};
  private episodes: Episode[] = [];
  private ambiguityCount = 0;
  constructor(config: MultiConfig) {
    if (![config.xEnter, config.xDwellMs, config.flexEnter, config.flexDwellMs, config.flexClear, config.flexClearDwellMs].every((n) => Number.isFinite(n) && n > 0) ||
      !['Y_ONLY', 'X_ONLY_CONTROL', 'Y_OR_X_CONTROL', 'Y_OR_FLEXION'].includes(config.strategy) ||
      !['TRIGGER_CHANNEL_CLEAR', 'ALL_AVAILABLE_CHANNELS_CLEAR'].includes(config.returnPolicy)) throw new Error('Invalid multi-signal config');
    this.config = Object.freeze({ ...config });
  }
  private enter(channel: Channel) { return channel === 'Y' ? Y_KICK_ENTER : channel === 'X' ? this.config.xEnter : this.config.flexEnter; }
  private dwell(channel: Channel) { return channel === 'Y' ? Y_KICK_ENTER_DWELL_MS : channel === 'X' ? this.config.xDwellMs : this.config.flexDwellMs; }
  private clear(channel: Channel) { return channel === 'FLEXION' ? this.config.flexClear : Y_KICK_CLEAR_THRESHOLD; }
  private clearDwell(channel: Channel) { return channel === 'FLEXION' ? this.config.flexClearDwellMs : Y_KICK_CLEAR_DWELL_MS; }
  private resetRun(s: ChannelState) { s.runAt = null; s.integrated = 0; s.previousEvidence = null; }
  private updateTracking(limb: Limb, channel: Channel, frame: MultiFrame, gap: boolean) {
    const s = this.sides[limb][channel], now = frame.timestamp;
    const value = frame[limb][channel], gateValue = channel === 'X' ? frame[limb].Y : value;
    s.value = value !== null && Number.isFinite(value) ? Math.max(0, value) : null;
    const usable = s.value !== null && gateValue !== null && Number.isFinite(gateValue);
    if (gap || !usable) {
      this.resetRun(s); s.clearAt = null;
      if (s.lossAt === null) { s.lossAt = gap ? this.previousAt! : now; s.epoch++; }
      if (s.episode !== null && this.episodes[s.episode].readyAt === null) this.episodes[s.episode].interruptedAt ??= now;
    }
    if (!usable) {
      if (now - s.lossAt! >= Y_TRACKING_LOSS_MIN_MS) s.disarmed = true;
      s.tracking = 'LOST'; return;
    }
    if (s.lossAt !== null) {
      s.disarmed ||= now - s.lossAt >= Y_TRACKING_LOSS_MIN_MS;
      this.episodes.push({ side: limb, channel, startedAt: s.lossAt, reacquiredAt: now, durationMs: now - s.lossAt,
        gated: s.disarmed, readyAt: null, interruptedAt: null });
      s.episode = this.episodes.length - 1; s.reacquiredAt = now; s.lossAt = null; s.clearAt = null;
    }
    if (gateValue! < this.clear(channel)) s.clearAt ??= now; else s.clearAt = null;
    if (s.disarmed && s.clearAt !== null && now - s.clearAt >= this.clearDwell(channel)) s.disarmed = false;
    s.tracking = s.disarmed ? channel === 'FLEXION' ? 'FLEX_REACQUIRED_NOT_READY' : 'REACQUIRED_NOT_READY' : 'READY';
    if (!s.disarmed && s.episode !== null) this.episodes[s.episode].readyAt ??= now;
  }
  private returned(now: number, gap: boolean): boolean {
    return this.latched.map((latch) => {
      // Trigger policy never ignores a missing trigger channel. ALL_AVAILABLE always needs Y;
      // missing flexion may be skipped, but its independent reacquisition gate remains armed.
      const channels: Channel[] = this.config.returnPolicy === 'ALL_AVAILABLE_CHANNELS_CLEAR'
        ? ['Y', ...(this.sides[latch.side].FLEXION.value === null ? [] : ['FLEXION' as const])] : latch.channels;
      return channels.map((channel) => {
        const s = this.sides[latch.side][channel], key = `${latch.side}/${channel}` as const;
        if (gap || s.value === null || s.value >= this.clear(channel)) delete this.returnRuns[key];
        if (s.value !== null && s.value < this.clear(channel)) this.returnRuns[key] ??= now;
        return this.returnRuns[key] !== undefined && now - this.returnRuns[key]! >= this.clearDwell(channel) &&
          (this.state !== 'WAIT_CLEAR' || s.tracking === 'READY');
      }).every(Boolean);
    }).every(Boolean);
  }
  processFrame(frame: MultiFrame): MultiEvent | null {
    const now = frame.timestamp;
    if (!Number.isFinite(now) || this.previousAt !== null && now <= this.previousAt) return null;
    const dt = this.previousAt === null ? 0 : now - this.previousAt, gap = dt >= KICK_STALE_MS;
    // Process all gate observations even during WAIT_RETURN. Ankle loss never gates Y/X.
    for (const limb of LIMBS) for (const channel of ['Y', 'X', 'FLEXION'] as const) this.updateTracking(limb, channel, frame, gap);
    this.previousAt = now;
    // Reset even channels currently optional for return so a later observation cannot bridge loss.
    for (const limb of LIMBS) for (const channel of ['Y', 'X', 'FLEXION'] as const)
      if (gap || this.sides[limb][channel].value === null) delete this.returnRuns[`${limb}/${channel}`];
    if (this.state === 'WAIT_RETURN' || this.state === 'WAIT_CLEAR') {
      if (this.returned(now, gap)) { this.state = 'ARMED'; this.latched = []; this.returnRuns = {}; }
      return null;
    }
    const channels = activeChannels(this.config);
    for (const limb of LIMBS) for (const channel of channels) {
      const s = this.sides[limb][channel], threshold = this.enter(channel);
      if (s.tracking !== 'READY' || s.value === null || s.value < threshold) { this.resetRun(s); continue; }
      if (s.runAt === null) { s.runAt = now; s.runEpoch = s.epoch; }
      else if (s.previousEvidence !== null) s.integrated +=
        (Math.max(0, s.previousEvidence / threshold - 1) + Math.max(0, s.value / threshold - 1)) / 2 * dt / 1000;
      s.previousEvidence = s.value;
    }
    this.state = LIMBS.some((limb) => channels.some((c) => this.sides[limb][c].runAt !== null)) ? 'CANDIDATE' : 'ARMED';
    const eligible = LIMBS.map((limb) => ({ side: limb, channels: channels.filter((c) => {
      const s = this.sides[limb][c]; return s.runAt !== null && now - s.runAt >= this.dwell(c);
    }) })).filter((e) => e.channels.length);
    if (!eligible.length) return null;
    // First observed dwell wins. Simultaneous sides compare max dimensionless channel area;
    // duplicate channels do not add a voting advantage. Exact ties have no limb owner.
    const score = (e: typeof eligible[number]) => Math.max(...e.channels.map((c) => this.sides[e.side][c].integrated));
    if (eligible.length === 2 && score(eligible[0]) === score(eligible[1])) {
      this.ambiguityCount++; this.state = 'WAIT_CLEAR'; this.latched = eligible; this.returnRuns = {};
      for (const limb of LIMBS) for (const c of channels) this.resetRun(this.sides[limb][c]);
      return null;
    }
    const winner = eligible.length === 1 || score(eligible[0]) > score(eligible[1]) ? eligible[0] : eligible[1];
    const sources = winner.channels, states = sources.map((c) => this.sides[winner.side][c]);
    const startedAt = Math.min(...states.map((s) => s.runAt!));
    const event: MultiEvent = { id: ++this.count, timestamp: now, side: winner.side,
      direction: winner.side === 'LEFT' ? 'KNEE_LEFT' : 'KNEE_RIGHT', channels: [...sources],
      triggerSource: sources.length === 2 ? sources.includes('FLEXION') ? 'BOTH' : 'Y_X_BOTH' : sources[0],
      candidateStartedAt: startedAt, confirmationLatencyMs: now - startedAt,
      normalizedIntegrated: Object.fromEntries(sources.map((c) => [c, this.sides[winner.side][c].integrated])),
      opponentScore: eligible.length === 2 ? score(eligible.find((e) => e !== winner)!) : 0,
      epochs: Object.fromEntries(sources.map((c) => [c, { run: this.sides[winner.side][c].runEpoch, current: this.sides[winner.side][c].epoch }])),
      crossGap: states.some((s) => s.runEpoch !== s.epoch), source: states.some((s) => s.reacquiredAt !== null) ? 'POST_REACQUISITION' : 'NORMAL_TRACKING' };
    this.state = 'WAIT_RETURN'; this.latched = [winner]; this.returnRuns = {};
    for (const limb of LIMBS) for (const c of channels) this.resetRun(this.sides[limb][c]);
    return event;
  }
  getView() {
    return { state: this.state, ambiguityCount: this.ambiguityCount, sides: structuredClone(this.sides),
      returnRuns: { ...this.returnRuns }, latched: structuredClone(this.latched) };
  }
  getEpisodes() { return structuredClone(this.episodes); }
}
