import { LIMBS, type Limb } from './discoveryFeatures';
import { BODY_STALE_MS, FEATURE_FAMILIES, type FeatureFamily } from './bodyLocalFeatures';
import { trajectorySummary, type TrajectoryPoint } from './causalTrajectory';
export interface TemporalRule { metric: 'directionalCoherence' | 'efficiency'; minimum: number; waitMs: 100 | 150 | 200 }
export interface FeatureConfig { featureFamily: FeatureFamily; threshold: number; dwell: number; temporalRule: TemporalRule | null }
export const FEATURE_GRID = { thresholds: [.15, .20, .25, .30, .40, .50, .60, .80], dwellMs: [50, 67, 100, 150] } as const;
export const FEATURE_RUNTIME = {
  clearRatio: .625, clearDwellMs: 100, lossGateMs: 33, staleMs: BODY_STALE_MS,
  explanation: 'Fixed exploratory return: enter*(.25/.40), 100ms clear. No return sweep. Independent core, no production detector invocation.',
  arbitration: 'FIRST observed dwell; simultaneous readiness uses accumulated excess magnitude integral; exact tie waits for both to clear. Never infer side from residual sign.',
  temporal: 'Entry above threshold then continuous above-threshold evidence for T ms; first observed frame at/after T decides using only frames <= entry+T. Rejection waits for clear. No interpolation/future samples.',
} as const;
export function directFeatureConfigs(): FeatureConfig[] {
  return FEATURE_FAMILIES.flatMap((featureFamily) => FEATURE_GRID.thresholds.flatMap((threshold) => FEATURE_GRID.dwellMs.map((dwell) => ({ featureFamily, threshold, dwell, temporalRule: null }))));
}
/** Fixed bounded extension, not selected from winning direct thresholds. Residual side ties are structural. */
export function temporalFeatureConfigs(): FeatureConfig[] {
  return FEATURE_FAMILIES.slice(0, 5).flatMap((featureFamily) => [.30, .50].flatMap((threshold) => ([100, 150, 200] as const).flatMap((waitMs) =>
    (['directionalCoherence', 'efficiency'] as const).flatMap((metric) => (metric === 'directionalCoherence' ? [.5, .65, .8] : [.4, .6, .8]).map((minimum) =>
      ({ featureFamily, threshold, dwell: waitMs, temporalRule: { metric, minimum, waitMs } }))))));
}
export function featureConfigId(c: FeatureConfig) { return `${c.featureFamily}/${c.threshold}/${c.dwell}/${c.temporalRule ? `${c.temporalRule.metric}:${c.temporalRule.minimum}` : 'DIRECT'}`; }
interface SideState {
  lastValid: number | null; missingSince: number | null; gate: boolean; clearSince: number | null;
  run: TrajectoryPoint[]; score: number; postLoss: boolean; blocked: boolean;
}
const emptySide = (): SideState => ({ lastValid: null, missingSince: null, gate: false, clearSince: null, run: [], score: 0, postLoss: false, blocked: false });
export interface FeatureEvent { timestamp: number; candidateStart: number; side: Limb; direction: 'KNEE_LEFT' | 'KNEE_RIGHT'; latencyMs: number; crossGap: boolean; postReacquisition: boolean; temporalSummary: ReturnType<typeof trajectorySummary> | null }
export class FeatureKickShadow {
  private sides = { LEFT: emptySide(), RIGHT: emptySide() };
  private previous: number | null = null;
  private waiting: Limb[] = [];
  private ambiguityCount = 0;
  constructor(readonly config: FeatureConfig) {}
  processFrame(timestamp: number, values: Record<Limb, number | null>): FeatureEvent | null {
    if (!Number.isFinite(timestamp) || this.previous !== null && timestamp <= this.previous) throw new Error('FeatureKickShadow requires strictly increasing recorded timestamps');
    const hardGap = this.previous !== null && timestamp - this.previous >= BODY_STALE_MS;
    const wasWaiting = this.waiting.length > 0;
    const ready: { side: Limb; summary: ReturnType<typeof trajectorySummary> | null }[] = [];
    for (const side of LIMBS) {
      const s = this.sides[side], value = values[side], magnitude = value === null ? null : Math.abs(value);
      if (hardGap) { s.gate = true; s.postLoss = true; s.run = []; s.score = 0; s.clearSince = null; }
      if (value === null || !Number.isFinite(value)) {
        s.missingSince ??= timestamp; s.postLoss = true; s.run = []; s.score = 0; s.clearSince = null; continue;
      }
      if (s.missingSince !== null) {
        if (timestamp - (s.lastValid ?? s.missingSince) >= FEATURE_RUNTIME.lossGateMs) s.gate = true;
        s.missingSince = null;
      }
      s.lastValid = timestamp;
      if (magnitude! < this.config.threshold * FEATURE_RUNTIME.clearRatio) s.clearSince ??= timestamp;
      else s.clearSince = null;
      const clearReady = s.clearSince !== null && timestamp - s.clearSince >= FEATURE_RUNTIME.clearDwellMs;
      if (s.gate || s.blocked || this.waiting.includes(side)) {
        s.run = []; s.score = 0;
        if (clearReady) { s.gate = false; s.blocked = false; this.waiting = this.waiting.filter((x) => x !== side); }
        continue;
      }
      if (wasWaiting || magnitude! < this.config.threshold) { s.run = []; s.score = 0; continue; }
      const before = s.run.at(-1);
      if (before) s.score += ((Math.abs(before.value!) - this.config.threshold) + (magnitude! - this.config.threshold)) / 2 * (timestamp - before.timestamp) / 1000;
      s.run.push({ timestamp, value });
      const start = s.run[0].timestamp, rule = this.config.temporalRule, wait = rule?.waitMs ?? this.config.dwell;
      if (timestamp - start < wait) continue;
      const summary = rule ? trajectorySummary(s.run, start, start + rule.waitMs, start + rule.waitMs) : null;
      if (rule && (summary![rule.metric] === null || !summary!.continuous || summary![rule.metric]! < rule.minimum)) {
        s.blocked = true; s.run = []; s.score = 0; s.clearSince = null; continue;
      }
      ready.push({ side, summary });
    }
    this.previous = timestamp;
    if (!ready.length || this.waiting.length) return null;
    if (ready.length === 2 && this.sides.LEFT.score === this.sides.RIGHT.score) {
      this.ambiguityCount++; this.waiting = [...LIMBS];
      for (const s of Object.values(this.sides)) { s.run = []; s.score = 0; s.clearSince = null; }
      return null;
    }
    const winner = ready.length === 1 ? ready[0] : this.sides.LEFT.score > this.sides.RIGHT.score ? ready[0] : ready[1];
    const s = this.sides[winner.side], start = s.run[0].timestamp;
    const crossGap = s.run.some((p, i) => i > 0 && p.timestamp - s.run[i - 1].timestamp >= BODY_STALE_MS);
    const event: FeatureEvent = { timestamp, candidateStart: start, side: winner.side, direction: `KNEE_${winner.side}`, latencyMs: timestamp - start,
      crossGap, postReacquisition: s.postLoss, temporalSummary: winner.summary };
    this.waiting = [winner.side];
    for (const state of Object.values(this.sides)) { state.run = []; state.score = 0; state.clearSince = null; }
    return event;
  }
  getView() {
    return { state: this.waiting.length ? 'WAIT_CLEAR' : LIMBS.some((s) => this.sides[s].run.length) ? 'CANDIDATE' : 'ARMED', ambiguityCount: this.ambiguityCount,
      sides: Object.fromEntries(LIMBS.map((s) => [s, { gate: this.sides[s].gate, missing: this.sides[s].missingSince !== null, blocked: this.sides[s].blocked, candidateStart: this.sides[s].run[0]?.timestamp ?? null }])) };
  }
}
