import { discoveryInputKey, replayShadow } from './analyzeShadow';
import type { PreparedTemporalDataset, TemporalDataset } from './analyzeTemporal';
import { median } from './discoveryFeatures';
import { gateFrame, ReacquisitionGate, type ReacquisitionConfig } from './reacquisitionGate';
import { CLEAR_DWELLS, CLEAR_THRESHOLDS, eventTracking, type FalseReacquisitionTrace } from './reacquisitionTrace';
import { DEFAULT_SHADOW_CONFIG, type DirectionStrategy } from './yKickShadowDetector';

export interface ReacquisitionSweepConfig extends ReacquisitionConfig { directionStrategy: DirectionStrategy }
export const REACQUISITION_SETTINGS = {
  shadow: DEFAULT_SHADOW_CONFIG,
  lossMinMs: [0, 33, 67, 100, 150, 200, 300, 400], settleMs: [0, 50, 100, 150, 200, 300, 400, 500],
  clearThreshold: CLEAR_THRESHOLDS, clearDwellMs: CLEAR_DWELLS,
  combined: { settleMs: [100, 150, 200], clearThreshold: [0.2, 0.25, 0.3], clearDwellMs: [50, 100, 150] },
  gapDefinition: 'first unusable frame -> first usable frame; timestamp gap >=400ms starts at previous observed frame; usable-to-usable gap also exported; initial missing frames count',
  belowMinimum: 'shorter loss does not create a new gate, but an already disarmed side stays disarmed and restarts settle/clear on reacquisition',
  combinedSemantics: 'minimum settle AND current continuous clear dwell, clocks may overlap; missing/dt>=400ms resets both on reacquisition',
  source: 'POST_REACQUISITION uses the winning side evidence tracking segment after any loss, even below lossMin; candidate age may be negative if the other side seeded the candidate before this side reacquired. Side evidence age is also exported. Not a causal claim or time cutoff.',
  latency: 'reacquiredAt -> first READY on recorded frames, gated episodes only; interrupted/end-of-trial unresolved episodes are censored, never zero-filled; separate by role',
  decay: 'cumulative [reacquiredAt, checkpoint] median and trailing (checkpoint-50ms,checkpoint] median, stage-bounded, usable-only; missing is null with counts, not decay to zero',
  availability: 'clear runs scanned from reacquisition to that stage end, missing/dt>=400ms reset; NO_CLEAR_OBSERVED vs CLEAR_DWELL_NOT_SATISFIED',
  viability: 'every CLEAN trial L=1 R=1 false/wrong/duplicate=0 final ARMED and expected-side observable; STRESS cross-gap/pose-loss false/reacquisition false=0; unobservable misses excluded; requires CLEAN and STRESS',
  product: 'side input only; timeline never pauses. Tracking-loss gestures may MISS intentionally. No automatic rebaseline or BEST choice.',
} as const;
export function reacquisitionConfigId(c: ReacquisitionSweepConfig) {
  return `${c.lossMinMs}/${c.strategy}/${c.settleMs}/${c.clearThreshold ?? '-'}/${c.clearDwellMs}/${c.directionStrategy}`;
}
export function reacquisitionConfigs(): ReacquisitionSweepConfig[] {
  const configs: ReacquisitionSweepConfig[] = [];
  for (const lossMinMs of REACQUISITION_SETTINGS.lossMinMs) for (const directionStrategy of ['FIRST_DWELL', 'INTEGRATED_WINDOW'] as const) {
    const add = (strategy: ReacquisitionConfig['strategy'], settleMs: number, clearThreshold: number | null, clearDwellMs: number) =>
      configs.push({ lossMinMs, directionStrategy, strategy, settleMs, clearThreshold, clearDwellMs });
    for (const settle of REACQUISITION_SETTINGS.settleMs) add('FIXED_SETTLE', settle, null, 0);
    for (const threshold of CLEAR_THRESHOLDS) for (const dwell of CLEAR_DWELLS) add('CLEAR_ONLY', 0, threshold, dwell);
    for (const settle of REACQUISITION_SETTINGS.combined.settleMs) for (const threshold of REACQUISITION_SETTINGS.combined.clearThreshold)
      for (const dwell of REACQUISITION_SETTINGS.combined.clearDwellMs) add('SETTLE_AND_CLEAR', settle, threshold, dwell);
  }
  return configs;
}
function replay(prepared: PreparedTemporalDataset, temporal: TemporalDataset, config: ReacquisitionSweepConfig) {
  const gate = new ReacquisitionGate(config);
  const shadow = replayShadow(prepared, temporal, { ...DEFAULT_SHADOW_CONFIG, directionStrategy: config.directionStrategy }, (frame) => gate.processFrame(gateFrame(frame)));
  const continuity = gate.result();
  const events = shadow.events.map((event) => {
    const sideStartedAt = (event.side === 'LEFT' ? event.leftRunStartedAt ?? event.leftEligibleAt : event.rightRunStartedAt ?? event.rightEligibleAt) ?? event.candidateStartedAt;
    const tracking = eventTracking(continuity.episodes, prepared.frames, event.side, event.candidateStartedAt, sideStartedAt);
    const reacquisitionFalseEvent = (event.falseEvent || event.wrongDirection) && tracking.source === 'POST_REACQUISITION';
    return { ...event, ...tracking, reacquisitionFalseEvent };
  });
  return { ...shadow, events, continuity,
    candidatePoseLossCancels: shadow.cancelledCandidates.filter((c) => c.reason === 'POSE_LOSS').length,
    postReacquisitionEvents: events.filter((e) => e.source === 'POST_REACQUISITION').length,
    reacquisitionFalseEvents: events.filter((e) => e.reacquisitionFalseEvent).length,
    poseLossFalseEvents: events.filter((e) => e.poseLossGeneratedFalseEvent || e.reacquisitionFalseEvent).length,
    cleanAccepted: shadow.cleanAssessment === 'ACCEPTED' && shadow.correctLeft === 1 && shadow.correctRight === 1 &&
      shadow.falseEvents === 0 && shadow.wrongDirection === 0 && shadow.duplicates === 0 && shadow.finalState === 'ARMED' };
}
type DatasetResult = ReturnType<typeof replay>;
function summarize(datasets: DatasetResult[]) {
  const sum = (key: 'correctLeft' | 'correctRight' | 'falseEvents' | 'wrongDirection' | 'duplicates' | 'crossGapConfirmations' |
    'candidatePoseLossCancels' | 'reacquisitionFalseEvents' | 'poseLossFalseEvents' | 'postReacquisitionEvents') => datasets.reduce((n, d) => n + d[key], 0);
  const gated = datasets.flatMap((d) => d.continuity.episodes.filter((e) => e.gateApplied));
  const latency = gated.map((e) => e.addedEligibilityLatencyMs).filter((v): v is number => v !== null);
  return { datasets, leftDetected: sum('correctLeft'), rightDetected: sum('correctRight'), falseEvents: sum('falseEvents'), wrongDirection: sum('wrongDirection'),
    duplicates: sum('duplicates'), candidatePoseLossCancels: sum('candidatePoseLossCancels'), crossGapConfirmations: sum('crossGapConfirmations'),
    reacquisitionFalseEvents: sum('reacquisitionFalseEvents'), poseLossFalseEvents: sum('poseLossFalseEvents'), postReacquisitionEvents: sum('postReacquisitionEvents'),
    finalStates: datasets.map((d) => ({ input: d.input, state: d.finalState })),
    addedEligibilityLatencyMs: { completedCount: latency.length, unresolvedCount: gated.length - latency.length,
      median: median(latency), max: latency.length ? Math.max(...latency) : null } };
}
export function analyzeReacquisitionConfig(prepared: readonly PreparedTemporalDataset[], temporal: readonly TemporalDataset[], config: ReacquisitionSweepConfig) {
  const lookup = new Map(temporal.map((d) => [discoveryInputKey(d.input), d]));
  const results = prepared.map((d) => {
    const summary = lookup.get(discoveryInputKey(d.input));
    if (!summary) throw new Error('Reacquisition input/role summary mismatch');
    return replay(d, summary, config);
  });
  const clean = summarize(results.filter((d) => d.role === 'CLEAN')), stress = summarize(results.filter((d) => d.role === 'STRESS'));
  const sufficient = clean.datasets.length > 0 && stress.datasets.length > 0 && clean.datasets.every((d) => d.cleanAssessment !== 'INSUFFICIENT_EVIDENCE');
  const viable = sufficient && clean.datasets.every((d) => d.cleanAccepted) && stress.crossGapConfirmations === 0 &&
    stress.reacquisitionFalseEvents === 0 && stress.poseLossFalseEvents === 0;
  return { id: reacquisitionConfigId(config), ...config, strategyComplexity: config.strategy === 'SETTLE_AND_CLEAR' ? 2 : 1,
    clean, stress, unassigned: results.filter((d) => d.role === 'UNASSIGNED'),
    assessment: !sufficient ? 'INSUFFICIENT_EVIDENCE' as const : viable ? 'VIABLE' as const : 'REJECTED' as const };
}
export type ReacquisitionConfigResult = ReturnType<typeof analyzeReacquisitionConfig>;
export function createReacquisitionReport(temporal: readonly TemporalDataset[], falseReacquisitionTrace: FalseReacquisitionTrace[], perConfig: ReacquisitionConfigResult[], createdAt = new Date().toISOString()) {
  return { version: 1, createdAt, inputs: temporal.map((d) => ({ ...d.input, role: d.role })), settings: REACQUISITION_SETTINGS,
    falseReacquisitionTrace, perConfig,
    viableReacquisitionConfigs: perConfig.filter((r) => r.assessment === 'VIABLE').map((r) => ({ id: r.id, lossMinMs: r.lossMinMs,
      strategy: r.strategy, settleMs: r.settleMs, clearThreshold: r.clearThreshold, clearDwellMs: r.clearDwellMs, directionStrategy: r.directionStrategy,
      strategyComplexity: r.strategyComplexity, addedEligibilityLatencyMs: { clean: r.clean.addedEligibilityLatencyMs, stress: r.stress.addedEligibilityLatencyMs } })),
    warnings: [!temporal.some((d) => d.role === 'CLEAN') ? 'No CLEAN dataset selected' : null,
      !temporal.some((d) => d.role === 'STRESS') ? 'No STRESS dataset selected' : null].filter((v): v is string => v !== null) };
}
export type ReacquisitionReport = ReturnType<typeof createReacquisitionReport>;
