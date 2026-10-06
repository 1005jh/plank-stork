import { LIMBS, type Limb } from './discoveryFeatures';
import { MultiSignalShadow, MULTI_DEFAULT, type MultiConfig, type ShadowGuardContext } from './multiSignalShadow';
import type { IntegrityFrame } from './integrityFeatures';
import { KICK_STALE_MS, Y_KICK_CLEAR_THRESHOLD, Y_KICK_CLEAR_DWELL_MS } from '../pose/kick/kneeKickDetectorV3';

export type IntegrityGuardType = 'NONE' | 'Y_VELOCITY' | 'KNEE_2D_VELOCITY' | 'SEGMENT_COLLAPSE' | 'Y_VELOCITY_OR_COLLAPSE';
export interface IntegrityConfig { guardType: IntegrityGuardType; velocity: number | null; minRatio: number | null }
// STEP 4K.2A: selected from 4K.1 before inspecting independent holdout data.
export const PRE_REGISTERED_INTEGRITY_CONFIG = Object.freeze({
  guardType: 'Y_VELOCITY', velocity: 12, minRatio: null,
} as const satisfies IntegrityConfig);
export const NO_INTEGRITY_GUARD: IntegrityConfig = { guardType: 'NONE', velocity: null, minRatio: null };
export const FIXED_FLEXION_CONFIG: MultiConfig = { ...MULTI_DEFAULT, strategy: 'Y_OR_FLEXION', flexEnter: 15,
  flexDwellMs: 67, flexClear: 5, flexClearDwellMs: 150, returnPolicy: 'TRIGGER_CHANNEL_CLEAR' };
export const INTEGRITY_SWEEP = { yVelocity: [10, 12, 15, 18, 20, 25, 30], knee2DVelocity: [10, 12, 15, 20, 25, 30, 35],
  minRatio: [.20, .25, .30, .35, .40, .50], combinedVelocity: [12, 15, 18, 20], combinedRatio: [.25, .30, .35, .40] } as const;
export function integrityConfigs(): IntegrityConfig[] {
  return [NO_INTEGRITY_GUARD,
    ...INTEGRITY_SWEEP.yVelocity.map((velocity): IntegrityConfig => ({ guardType: 'Y_VELOCITY', velocity, minRatio: null })),
    ...INTEGRITY_SWEEP.knee2DVelocity.map((velocity): IntegrityConfig => ({ guardType: 'KNEE_2D_VELOCITY', velocity, minRatio: null })),
    ...INTEGRITY_SWEEP.minRatio.map((minRatio): IntegrityConfig => ({ guardType: 'SEGMENT_COLLAPSE', velocity: null, minRatio })),
    ...INTEGRITY_SWEEP.combinedVelocity.flatMap((velocity) => INTEGRITY_SWEEP.combinedRatio.map((minRatio): IntegrityConfig => ({ guardType: 'Y_VELOCITY_OR_COLLAPSE', velocity, minRatio }))),
  ].map((c) => ({ ...c }));
}
export const integrityConfigId = (c: IntegrityConfig) => `${c.guardType}/${c.velocity ?? '-'}/${c.minRatio ?? '-'}`;
export interface SoftLossEpisode {
  side: Limb; epoch: number; startedAt: number; stageIndex: number | null; expected: string | null;
  reasons: { feature: 'Y_VELOCITY' | 'KNEE_2D_VELOCITY' | 'SEGMENT_COLLAPSE'; observedAt: number; value: number; threshold: number }[];
  candidateCancelled: boolean; existingRunCancelled: boolean; entryPrevented: boolean;
  readyAt: number | null; timeToReadyMs: number | null;
}
const initial = () => ({ state: 'READY' as 'READY' | 'SUSPECT_NOT_READY', epoch: 0, clearAt: null as number | null, episode: null as number | null });
export type IntegrityEntryGuard = (frame: IntegrityFrame, context: ShadowGuardContext, integrityBlocked: readonly Limb[]) => readonly Limb[];

/** Analysis-only runner. Veto both channels of the suspect limb;
 * continue original frame/time/visibility processing and the independent other limb. */
export class IntegrityShadow {
  private core: MultiSignalShadow;
  private sides = { LEFT: initial(), RIGHT: initial() };
  private previous: IntegrityFrame | null = null;
  private episodes: SoftLossEpisode[] = [];
  readonly config: Readonly<IntegrityConfig>;
  constructor(config: IntegrityConfig, evidence: MultiConfig = MULTI_DEFAULT, private entryGuard?: IntegrityEntryGuard) {
    if (!['NONE', 'Y_VELOCITY', 'KNEE_2D_VELOCITY', 'SEGMENT_COLLAPSE', 'Y_VELOCITY_OR_COLLAPSE'].includes(config.guardType) ||
      config.velocity !== null && (!Number.isFinite(config.velocity) || config.velocity <= 0) ||
      config.minRatio !== null && (!Number.isFinite(config.minRatio) || config.minRatio <= 0) ||
      ['Y_VELOCITY', 'KNEE_2D_VELOCITY', 'Y_VELOCITY_OR_COLLAPSE'].includes(config.guardType) && config.velocity === null ||
      ['SEGMENT_COLLAPSE', 'Y_VELOCITY_OR_COLLAPSE'].includes(config.guardType) && config.minRatio === null) throw new Error('Invalid integrity config');
    this.config = Object.freeze({ ...config }); this.core = new MultiSignalShadow(evidence);
  }
  private veto(frame: IntegrityFrame, context: ShadowGuardContext) {
    if (this.config.guardType === 'NONE') return [];
    const blocked: Limb[] = [], dt = this.previous ? frame.timestamp - this.previous.timestamp : 0;
    for (const side of LIMBS) {
      const s = this.sides[side], m = frame.measurements[side], now = frame.timestamp;
      if (s.state === 'SUSPECT_NOT_READY') {
        if (dt >= KICK_STALE_MS || m.deltaDyNorm === null || Math.abs(m.deltaDyNorm) >= Y_KICK_CLEAR_THRESHOLD) s.clearAt = null;
        if (m.deltaDyNorm !== null && Math.abs(m.deltaDyNorm) < Y_KICK_CLEAR_THRESHOLD) s.clearAt ??= now;
        if (s.clearAt !== null && now - s.clearAt >= Y_KICK_CLEAR_DWELL_MS) {
          s.state = 'READY'; const episode = this.episodes[s.episode!]; episode.readyAt = now; episode.timeToReadyMs = now - episode.startedAt;
          s.clearAt = null;
        }
        // Recovery observation never starts a gesture on this same frame.
        blocked.push(side); continue;
      }
      const entry = context.sides[side].entryChannels.length > 0, reasons: SoftLossEpisode['reasons'] = [];
      if (entry && this.config.velocity !== null) {
        const feature: 'KNEE_2D_VELOCITY' | 'Y_VELOCITY' = this.config.guardType === 'KNEE_2D_VELOCITY' ? 'KNEE_2D_VELOCITY' : 'Y_VELOCITY';
        const key = feature === 'Y_VELOCITY' ? 'deltaDyNormVelocity' : 'kneeCenterRelative2DVelocity';
        const observations = [{ timestamp: now, value: m[key] }];
        // Exactly the preceding usable frame, not a retained pre-loss maximum or future data.
        if (dt > 0 && dt < KICK_STALE_MS && m[key] !== null && this.previous)
          observations.push({ timestamp: this.previous.timestamp, value: this.previous.measurements[side][key] });
        for (const o of observations) if (o.value !== null && Math.abs(o.value) >= this.config.velocity)
          reasons.push({ feature, observedAt: o.timestamp, value: o.value, threshold: this.config.velocity });
      }
      // Geometry corruption is checked continuously, including mid-candidate and return.
      // Missing ankle/segment baseline is unavailable, never a zero-length segment.
      if (this.config.minRatio !== null && m.kneeAnkleRatio !== null && m.kneeAnkleRatio < this.config.minRatio)
        reasons.push({ feature: 'SEGMENT_COLLAPSE', observedAt: now, value: m.kneeAnkleRatio, threshold: this.config.minRatio });
      if (!reasons.length) continue;
      const existing = Object.values(context.sides[side].runs).some((start) => start !== null);
      s.state = 'SUSPECT_NOT_READY'; s.epoch++; s.clearAt = null; s.episode = this.episodes.length;
      this.episodes.push({ side, epoch: s.epoch, startedAt: now, stageIndex: frame.stageIndex, expected: null,
        reasons, candidateCancelled: existing || entry, existingRunCancelled: existing, entryPrevented: entry,
        readyAt: null, timeToReadyMs: null }); blocked.push(side);
    }
    return blocked;
  }
  processFrame(frame: IntegrityFrame) {
    if (!Number.isFinite(frame.timestamp) || this.previous && frame.timestamp <= this.previous.timestamp) return null;
    const event = this.core.processFrame(frame, (context) => {
      const integrityBlocked = this.veto(frame, context);
      // Separate opt-in analysis hook; cannot alter integrity thresholds/recovery.
      return [...integrityBlocked, ...(this.entryGuard?.(frame, context, integrityBlocked) ?? [])];
    });
    this.previous = frame;
    return event ? { ...event, softEpoch: this.sides[event.side].epoch,
      softGapCrossConfirmation: this.episodes.some((e) => e.side === event.side && e.startedAt >= event.candidateStartedAt && e.startedAt <= event.timestamp) } : null;
  }
  getView = () => this.core.getView();
  getEpisodes = () => this.core.getEpisodes();
  getSoftView() { return structuredClone(this.sides); }
  getSoftEpisodes() { return structuredClone(this.episodes); }
}
