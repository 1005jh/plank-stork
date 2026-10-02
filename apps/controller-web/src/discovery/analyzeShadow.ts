import type { DiscoveryInput } from './analyzeDiscovery';
import type { PreparedTemporalDataset, TemporalDataset } from './analyzeTemporal';
import { stageForTime, type DiscoveryLabel } from './discoveryStages';
import { YKickShadowDetector, type DirectionStrategy, type ShadowConfig, type ShadowState } from './yKickShadowDetector';

export const SHADOW_SETTINGS = {
  enter: [0.35, 0.4, 0.45], dwellMs: [33, 50, 80], exit: [0.15, 0.2, 0.25, 0.3], returnDwellMs: [100, 150, 180, 200], decisionWindowMs: 100,
  primary: 'abs(deltaDyNorm), exactly STEP 4G analysis-only neutral/bodyScale',
  continuity: 'recorded dt; missing owner or dt >= 400ms cancels candidate into WAIT_CLEAR; unusable opponent resets only its own evidence',
  return: 'triggered/clear owner ONLY; usable abs(Y) < EXIT continuously for returnDwellMs; missing/gap resets dwell, never unlocks',
  firstDwell: 'first observed side to satisfy dwell; simultaneous eligibility is AMBIGUOUS, no arbitrary event direction',
  integratedWindow: '100ms after first dwell; only dwell-eligible sides can win; trapezoidal supra-threshold area clipped at deadline; event on first frame at/after deadline; missing opponent cannot veto',
  margin: 'absoluteMargin = abs(leftIntegrated-rightIntegrated); ratio = max(leftIntegrated,rightIntegrated)/(leftIntegrated+rightIntegrated), null if total=0; diagnostics only',
  recoveryFalse: 'false/wrong event linked to a POSE_LOSS/TIMESTAMP_GAP clear OR an above-threshold run starting on the first reacquired frame; conservative association, not a causal claim',
  observability: 'expected KNEE uses that side only; non-kick coverage is diagnostic, not a veto on observed-timeline event counts; viable is not proof about unobserved frames',
  readiness: 'last observed shadow state BEFORE the next action stage boundary, without synthetic frame/clock advancement',
} as const;
export function shadowConfigId(c: ShadowConfig) { return `${c.enter}/${c.dwellMs}/${c.exit}/${c.returnDwellMs}/${c.directionStrategy}`; }
export function shadowConfigs(): ShadowConfig[] {
  const configs: ShadowConfig[] = [];
  for (const enter of SHADOW_SETTINGS.enter) for (const dwellMs of SHADOW_SETTINGS.dwellMs)
    for (const exit of SHADOW_SETTINGS.exit) for (const returnDwellMs of SHADOW_SETTINGS.returnDwellMs)
      for (const directionStrategy of ['FIRST_DWELL', 'INTEGRATED_WINDOW'] as DirectionStrategy[])
        configs.push({ enter, dwellMs, exit, returnDwellMs, directionStrategy, decisionWindowMs: 100 });
  return configs;
}
export const discoveryInputKey = (input: DiscoveryInput) => JSON.stringify([input.filename, input.captureId, input.trialId]);
export interface ShadowStageResult {
  stageIndex: number; expected: DiscoveryLabel; observable: boolean;
  leftCoverage: number | null; rightCoverage: number | null; leftUsable: number; rightUsable: number; frameCount: number;
  eventCount: number; correct: number; wrongDirection: number; duplicates: number; falseEvents: number;
  outcome: 'CORRECT' | 'MISS' | 'UNOBSERVABLE' | 'FALSE_EVENT' | 'CLEAR' | 'WRONG_OR_DUPLICATE';
}
function replayShadow(prepared: PreparedTemporalDataset, temporal: TemporalDataset, config: ShadowConfig) {
  const detector = new YKickShadowDetector(config);
  const readiness: { stageIndex: number; expected: DiscoveryLabel; startMs: number; stateBefore: ShadowState; armedBeforeStart: boolean; lastObservedFrameAt: number | null }[] = [];
  let nextStage = 0, previousTime: number | null = null;
  for (const frame of prepared.frames) {
    while (prepared.stages[nextStage] && frame.timestamp >= prepared.stages[nextStage].startMs) {
      const stage = prepared.stages[nextStage++];
      if (stage.expected !== 'NEUTRAL') readiness.push({ stageIndex: stage.stageIndex, expected: stage.expected, startMs: stage.startMs,
        stateBefore: detector.getState(), armedBeforeStart: detector.getState() === 'ARMED', lastObservedFrameAt: previousTime });
    }
    detector.processFrame({ timestamp: frame.timestamp, LEFT: frame.LEFT.usable ? frame.LEFT.absY : null, RIGHT: frame.RIGHT.usable ? frame.RIGHT.absY : null });
    previousTime = frame.timestamp;
  }
  const result = detector.result();
  const events = result.events.map((event) => {
    const stage = stageForTime(prepared.stages, event.timestamp);
    const expected = stage?.expected ?? null;
    const falseEvent = expected === null || expected === 'NEUTRAL' || expected === 'TWIST_LEFT' || expected === 'TWIST_RIGHT';
    return { ...event, expected, stageIndex: stage?.stageIndex ?? null, falseEvent,
      wrongDirection: !falseEvent && expected !== event.direction,
      poseLossGeneratedFalseEvent: (falseEvent || expected !== event.direction) &&
        (event.recovery?.reason === 'POSE_LOSS' || event.recovery?.reason === 'TIMESTAMP_GAP' || event.entryReacquisition !== null) };
  });
  const stages: ShadowStageResult[] = temporal.stages.filter((stage) => stage.window === 'FULL').map((stage) => {
    const stageEvents = events.filter((e) => e.stageIndex === stage.stageIndex), kick = stage.expected.startsWith('KNEE_');
    const correct = stageEvents.filter((e) => e.direction === stage.expected).length, wrongDirection = stageEvents.filter((e) => e.wrongDirection).length;
    const falseEvents = stageEvents.filter((e) => e.falseEvent).length, duplicates = kick ? Math.max(0, stageEvents.length - 1) : 0;
    const observable = stage.expected === 'KNEE_LEFT' ? stage.sides.LEFT.observableStage : stage.expected === 'KNEE_RIGHT' ? stage.sides.RIGHT.observableStage
      : stage.sides.LEFT.observableStage && stage.sides.RIGHT.observableStage;
    const outcome = kick ? wrongDirection || duplicates ? 'WRONG_OR_DUPLICATE' : correct === 1 ? 'CORRECT' : observable ? 'MISS' : 'UNOBSERVABLE'
      : falseEvents ? 'FALSE_EVENT' : observable ? 'CLEAR' : 'UNOBSERVABLE';
    return { stageIndex: stage.stageIndex, expected: stage.expected, observable, outcome, leftCoverage: stage.sides.LEFT.coverage, rightCoverage: stage.sides.RIGHT.coverage,
      leftUsable: stage.sides.LEFT.usableFrameCount, rightUsable: stage.sides.RIGHT.usableFrameCount, frameCount: stage.sides.LEFT.frameCount,
      eventCount: stageEvents.length, correct, wrongDirection, duplicates, falseEvents };
  });
  const completeLabels = ['NEUTRAL', 'TWIST_LEFT', 'TWIST_RIGHT', 'KNEE_LEFT', 'KNEE_RIGHT'].every((label) => stages.some((s) => s.expected === label));
  const observable = completeLabels && stages.filter((s) => s.expected.startsWith('KNEE_')).every((s) => s.observable);
  const cleanAccepted = observable && stages.every((s) => s.expected.startsWith('KNEE_') ? s.outcome === 'CORRECT' : s.falseEvents === 0);
  const nonKickCoverageLimited = stages.filter((s) => !s.expected.startsWith('KNEE_') && !s.observable).map((s) => s.stageIndex);
  const nextActionReadiness = readiness;
  const rearmTimes = result.rearmTimes.map((rearm) => ({ ...rearm,
    nextAction: readiness.find((stage) => stage.startMs > rearm.waitingSince) ?? null }));
  return { input: prepared.input, role: temporal.role, stageSource: prepared.stageSource, warnings: prepared.warnings,
    events, cancelledCandidates: result.cancelledCandidates, rearmTimes, nextActionReadiness, transitions: result.transitions,
    finalState: result.state, finalPending: { candidate: result.candidate, waitingSide: result.waitingSide, returnStartedAt: result.returnStartedAt },
    stages, nonKickCoverageLimited, cleanAssessment: !observable ? 'INSUFFICIENT_EVIDENCE' as const : cleanAccepted ? 'ACCEPTED' as const : 'REJECTED' as const,
    correctLeft: stages.filter((s) => s.expected === 'KNEE_LEFT').reduce((n, s) => n + s.correct, 0),
    correctRight: stages.filter((s) => s.expected === 'KNEE_RIGHT').reduce((n, s) => n + s.correct, 0),
    falseEvents: events.filter((e) => e.falseEvent).length, wrongDirection: events.filter((e) => e.wrongDirection).length,
    duplicates: stages.reduce((n, s) => n + s.duplicates, 0),
    crossGapConfirmations: events.filter((e) => e.crossGapConfirmation).length,
    poseLossGeneratedFalseEvents: events.filter((e) => e.poseLossGeneratedFalseEvent).length };
}
export type ShadowDatasetResult = ReturnType<typeof replayShadow>;
function summarizeRole(datasets: ShadowDatasetResult[]) {
  return { datasets, events: datasets.flatMap((d) => d.events.map((e) => ({ ...e, input: d.input }))),
    correctLeft: datasets.reduce((n, d) => n + d.correctLeft, 0), correctRight: datasets.reduce((n, d) => n + d.correctRight, 0),
    falseEvents: datasets.reduce((n, d) => n + d.falseEvents, 0), wrongDirection: datasets.reduce((n, d) => n + d.wrongDirection, 0),
    duplicates: datasets.reduce((n, d) => n + d.duplicates, 0), crossGapConfirmations: datasets.reduce((n, d) => n + d.crossGapConfirmations, 0),
    poseLossGeneratedFalseEvents: datasets.reduce((n, d) => n + d.poseLossGeneratedFalseEvents, 0),
    cancelledCandidates: datasets.flatMap((d) => d.cancelledCandidates.map((c) => ({ ...c, input: d.input }))),
    rearmTimes: datasets.flatMap((d) => d.rearmTimes.map((r) => ({ ...r, input: d.input }))),
    finalStates: datasets.map((d) => ({ input: d.input, state: d.finalState })),
  };
}
export function analyzeShadowConfig(prepared: readonly PreparedTemporalDataset[], temporal: readonly TemporalDataset[], config: ShadowConfig) {
  const lookup = new Map(temporal.map((d) => [discoveryInputKey(d.input), d]));
  const results = prepared.map((dataset) => {
    const summary = lookup.get(discoveryInputKey(dataset.input));
    if (!summary) throw new Error('Shadow input/role summary mismatch');
    return replayShadow(dataset, summary, config);
  });
  const clean = summarizeRole(results.filter((d) => d.role === 'CLEAN'));
  const stress = summarizeRole(results.filter((d) => d.role === 'STRESS'));
  const unassigned = results.filter((d) => d.role === 'UNASSIGNED');
  const enough = clean.datasets.length > 0 && clean.datasets.every((d) => d.cleanAssessment !== 'INSUFFICIENT_EVIDENCE');
  const accepted = enough && clean.datasets.every((d) => d.cleanAssessment === 'ACCEPTED') && stress.crossGapConfirmations === 0 && stress.poseLossGeneratedFalseEvents === 0;
  return { id: shadowConfigId(config), ...config, clean, stress, unassigned,
    assessment: !enough ? 'INSUFFICIENT_EVIDENCE' as const : accepted ? 'VIABLE' as const : 'REJECTED' as const };
}
export type ShadowConfigResult = ReturnType<typeof analyzeShadowConfig>;
export function createShadowReport(temporal: readonly TemporalDataset[], perConfig: ShadowConfigResult[], createdAt = new Date().toISOString()) {
  return { version: 1, createdAt, inputs: temporal.map((d) => ({ ...d.input, role: d.role })), settings: SHADOW_SETTINGS,
    configs: perConfig.map(({ enter, dwellMs, exit, returnDwellMs, directionStrategy, decisionWindowMs }) => ({ enter, dwellMs, exit, returnDwellMs, directionStrategy, decisionWindowMs })),
    perConfig, viableStatefulConfigs: perConfig.filter((r) => r.assessment === 'VIABLE').map((r) => ({ id: r.id, enter: r.enter, dwellMs: r.dwellMs,
      exit: r.exit, returnDwellMs: r.returnDwellMs, directionStrategy: r.directionStrategy, decisionWindowMs: r.decisionWindowMs })),
    warnings: temporal.some((d) => d.role === 'CLEAN') ? [] : ['No CLEAN dataset selected'] };
}
export type ShadowReport = ReturnType<typeof createShadowReport>;
