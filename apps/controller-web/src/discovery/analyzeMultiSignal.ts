import type { AnalysisNeutralWindow } from './multiSignalFeatures';
import { LIMBS, type Limb } from './discoveryFeatures';
import { discoveryStages, stageForTime, type DiscoveryStage } from './discoveryStages';
import { flexionBaseline, flexionIncrease, kneeAngle, FLEXION_VISIBILITY, type Channel, type MultiFrame, type MultiRole } from './multiSignalFeatures';
import { activeChannels, multiConfigId, multiConfigs, MultiSignalShadow, MULTI_DEFAULT, MULTI_SWEEP, type MultiConfig, type MultiEvent } from './multiSignalShadow';
import { replayKneeKickV3 } from '../replay/kneeKickV3Replay';
import { orderedFrames, type CalibrationSelection } from '../replay/landmarkReplay';
import { replayDetectorMode, type ReplaySession } from '../replay/replayTypes';
import { KICK_STALE_MS, Y_KICK_V3_CONFIG } from '../pose/kick/kneeKickDetectorV3';

export interface MultiInput { filename: string; role: MultiRole; session: ReplaySession; calibrationSelection?: CalibrationSelection }
type SeriesFrame = MultiFrame & { stageIndex: number | null; calibrationOnly: boolean; ankleVisible: Record<Limb, boolean> };
export const MULTI_SETTINGS = {
  analysisOnly: true, y: Y_KICK_V3_CONFIG, sweep: MULTI_SWEEP, flexionVisibility: FLEXION_VISIBILITY,
  flexion: 'max(0, Neutral median angle - current same-side hip/knee/ankle normalized image XY angle); independent of Y/world geometry',
  baseline: 'latest calibration START -> first FROZEN; last 1000ms bounded window, start exclusive/end inclusive; no samples from later movements; old captures use first Neutral, excluded from evaluation',
  temporal: 'recorded tMs; no missing or dt>=400ms bridging; initial missing frames are loss episodes; >=33ms reacquisition needs channel clear',
  arbitration: 'FIRST observed dwell; simultaneous sides compare MAX eligible-channel integral of max(0,evidence/enter-1) in seconds; exact tie -> WAIT_CLEAR both; same-side simultaneous channels -> one event',
  return: 'triggered side only; separate channel clear clocks AFTER event; Y 0.25/100ms; flexion swept; TRIGGER_CHANNEL requires every trigger channel even if missing; ALL_AVAILABLE requires Y plus flexion when observable; missing flexion resets its clear clock and does not remove its reacquisition gate',
  xControl: 'per-limb abs(X), not legacy candidate events; entry shares Y hip/knee availability and Y reacquisition clear gate; trigger-channel X return <0.25 for 100ms; not a production proposal',
  observability: 'strategy OR availability coverage >=80% and no usable gap >=400ms; gates do not change raw coverage; missing baseline is unavailable',
  viability: 'requires both reference roles and STRESS, every reference observable L/R exactly1 and false/wrong/duplicate0; STRESS observable kick misses count, unobservable misses excluded; observable non-kick false/crossGap/reacquisitionFalse/wrong/duplicate must be0; no automatic BEST',
  attribution: 'GUIDED_STAGE_CHANGE markers only; calibration-only first Neutral and post-trial frames never count as false or successful kicks',
  reacquisitionFalse: 'false/wrong event whose triggering channel is in a tracking segment after a loss; temporal association, not proof of causation',
} as const;

function liveParity(session: ReplaySession, trialId: number, replay: ReturnType<typeof replayKneeKickV3>) {
  const calibration = replay.calibrationParity, comparison = replay.comparison;
  const required = replayDetectorMode(session) === 'Y_V3';
  const matched = required ? comparison?.eventsEqual === true && comparison.guidedSummaryEqual && comparison.finalStateEqual &&
    calibration?.kickBaselineV3Equal === true && calibration.neutralBaselineEqual && calibration.kickBaselineEqual : null;
  return { captureId: session.captureId, trialId, required, matched, comparison, calibration,
    trialResult: replay.result, postTrialEventsExcluded: session.liveResult.events.filter((e) => e.tMs >= (session.liveResult.trials.find((t) => t.id === trialId)?.endMs ?? Infinity)) };
}

/** Availability/longest-run statistics do not infer time between missing observations. */
export function signalStats(points: readonly { timestamp: number; value: number | null }[], startMs: number, endMs: number, thresholds: readonly number[]) {
  const valid = points.filter((p) => p.value !== null), coverage = points.length ? valid.length / points.length : null;
  let lastValid = startMs, missing = false, maxGapMs = 0;
  for (const p of points) {
    if (p.value === null) { missing = true; continue; }
    const dt = p.timestamp - lastValid;
    if (missing || dt >= KICK_STALE_MS) maxGapMs = Math.max(maxGapMs, dt);
    lastValid = p.timestamp; missing = false;
  }
  if (!valid.length || missing || endMs - lastValid >= KICK_STALE_MS) maxGapMs = Math.max(maxGapMs, endMs - lastValid);
  const sorted = valid.map((p) => p.value!).sort((a, b) => a - b), peak = sorted.at(-1) ?? null;
  return { frames: points.length, usableFrames: valid.length, coverage, maxGapMs,
    observable: coverage !== null && coverage >= .8 && maxGapMs < KICK_STALE_MS,
    peak, p95: sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1] : null,
    peakAt: peak === null ? null : valid.find((p) => p.value === peak)!.timestamp,
    thresholds: thresholds.map((threshold) => {
      let start: number | null = null, previous: number | null = null, longestAboveMs = 0, framesAbove = 0;
      for (const p of points) {
        if (p.value === null || p.value < threshold) start = null;
        else {
          if (start === null || previous !== null && p.timestamp - previous >= KICK_STALE_MS) start = p.timestamp;
          longestAboveMs = Math.max(longestAboveMs, p.timestamp - start); framesAbove++;
        }
        previous = p.timestamp;
      }
      return { threshold, longestAboveMs, framesAbove };
    }) };
}
export function prepareMultiFixture(input: MultiInput, trialId: number, production: ReturnType<typeof replayKneeKickV3>, analysisWindow?: AnalysisNeutralWindow) {
  const { session, filename, role } = input, trial = session.liveResult.trials.find((t) => t.id === trialId)!;
  const stages = discoveryStages(session, trial);
  if (stages.source !== 'GUIDED_STAGE_CHANGE') throw new Error(`${filename}: STEP 4J는 GUIDED_STAGE_CHANGE marker가 필요합니다.`);
  const baseline = flexionBaseline(session, trial, input.calibrationSelection, analysisWindow), yByTime = new Map(production.diagnostics.map((d) => [d.timestamp, d]));
  const frames: SeriesFrame[] = orderedFrames(session.poseFrames).flatMap((f) => {
    const y = yByTime.get(f.tMs); if (!y) return [];
    const stage = stageForTime(stages.stages, f.tMs);
    const limb = (side: Limb) => {
      const sy = side === 'LEFT' ? y.normalizedYLeft : y.normalizedYRight;
      const sx = side === 'LEFT' ? y.normalizedXLeft : y.normalizedXRight;
      return { Y: sy === null ? null : Math.abs(sy), X: sx === null ? null : Math.abs(sx),
        FLEXION: flexionIncrease(baseline[side].neutralAngle, kneeAngle(f.landmarks, side)) };
    };
    const visibleAnkle = (index: number) => {
      const p = f.landmarks[index]; return !!p && p.visibility !== null && p.visibility >= FLEXION_VISIBILITY && Number.isFinite(p.x) && Number.isFinite(p.y);
    };
    return [{ timestamp: f.tMs, stageIndex: stage?.stageIndex ?? null,
      calibrationOnly: y.calibrationOnly || baseline.excludedStageIndex !== null && stage?.stageIndex === baseline.excludedStageIndex,
      LEFT: limb('LEFT'), RIGHT: limb('RIGHT'), ankleVisible: { LEFT: visibleAnkle(27), RIGHT: visibleAnkle(28) } }];
  });
  const stageSignals = stages.stages.flatMap((stage) => LIMBS.map((side) => {
    const selected = frames.filter((f) => f.stageIndex === stage.stageIndex && !f.calibrationOnly);
    const summary = (channel: Channel, thresholds: readonly number[]) => signalStats(selected.map((f) => ({ timestamp: f.timestamp, value: f[side][channel] })), stage.startMs, stage.endMs, thresholds);
    return { stageIndex: stage.stageIndex, expected: stage.expected, side,
      calibrationOnly: stage.stageIndex === baseline.excludedStageIndex || production.baseline.calibrationOnly?.startMs === stage.startMs,
      neutralAngle: baseline[side].neutralAngle, ankleCoverage: selected.length ? selected.filter((f) => f.ankleVisible[side]).length / selected.length : null,
      Y: summary('Y', [.4]), X: summary('X', MULTI_SWEEP.xEnter), FLEXION: summary('FLEXION', MULTI_SWEEP.flexEnter) };
  }));
  return { input: { filename, captureId: session.captureId, trialId, role }, stages: stages.stages, stageSignals, frames,
    baseline, yBaseline: production.baseline, productionY: production.result, liveReplayParity: liveParity(session, trialId, production) };
}
export type PreparedMultiFixture = ReturnType<typeof prepareMultiFixture>;
export function prepareMultiInputs(inputs: readonly MultiInput[]): PreparedMultiFixture[] {
  const seen = new Set<string>();
  // All new LIVE parity checks finish before any multi-signal extraction/sweep begins.
  const checked = inputs.flatMap((input) => input.session.liveResult.trials.map((trial) => {
    const key = `${input.session.captureId}/${trial.id}`;
    if (seen.has(key)) throw new Error('동일 capture/trial을 중복 입력할 수 없습니다.'); seen.add(key);
    const production = replayKneeKickV3(input.session, trial.id, input.calibrationSelection), parity = liveParity(input.session, trial.id, production);
    if (parity.required && !parity.matched) throw new Error(`LIVE_V3_PARITY_MISMATCH ${input.filename}: ${JSON.stringify(parity)}`);
    return { input, trialId: trial.id, production };
  }));
  return checked.map(({ input, trialId, production }) => prepareMultiFixture(input, trialId, production));
}
function outcome(stage: DiscoveryStage, fixture: PreparedMultiFixture, config: MultiConfig, events: MultiEvent[]) {
  const frames = fixture.frames.filter((f) => f.stageIndex === stage.stageIndex && !f.calibrationOnly), channels = activeChannels(config);
  const observable = (limb: Limb) => signalStats(frames.map((f) => ({ timestamp: f.timestamp,
    value: channels.some((c) => f[limb][c] !== null) ? 0 : null })), stage.startMs, stage.endMs, []).observable;
  const leftObservable = observable('LEFT'), rightObservable = observable('RIGHT');
  const current = events.filter((e) => e.timestamp >= stage.startMs && e.timestamp < stage.endMs);
  const kick = stage.expected.startsWith('KNEE_'), correct = current.filter((e) => e.direction === stage.expected).length;
  const expectedObservable = stage.expected === 'KNEE_LEFT' ? leftObservable : stage.expected === 'KNEE_RIGHT' ? rightObservable : leftObservable && rightObservable;
  const falseEvents = kick ? 0 : current.length, wrong = kick ? current.filter((e) => e.direction !== stage.expected).length : 0;
  return { ...stage, frameCount: frames.length, calibrationOnly: fixture.stageSignals.some((s) => s.stageIndex === stage.stageIndex && s.calibrationOnly),
    leftObservable, rightObservable, expectedObservable, correct, wrong, duplicates: kick ? Math.max(0, current.length - 1) : 0,
    falseEvents, observableFalseEvents: kick ? 0 : current.filter((e) => e.side === 'LEFT' ? leftObservable : rightObservable).length,
    triggerSources: current.map((e) => e.triggerSource), eventCount: current.length,
    outcome: !frames.length ? 'NOT_EVALUATED' : !kick ? current.length ? 'FALSE_EVENT' : 'CLEAR' :
      correct === 1 && current.length === 1 ? 'CORRECT' : current.length ? 'WRONG_OR_DUPLICATE' : expectedObservable ? 'MISS' : 'UNOBSERVABLE' };
}
export function analyzeMultiFixture(fixture: PreparedMultiFixture, config: MultiConfig,
  detector: Pick<MultiSignalShadow, 'processFrame' | 'getView' | 'getEpisodes'> = new MultiSignalShadow(config)) {
  const events: MultiEvent[] = [];
  for (const f of fixture.frames) {
    if (f.calibrationOnly) continue;
    const event = detector.processFrame(f);
    if (event && f.stageIndex !== null) events.push(event);
  }
  const stageOutcomes = fixture.stages.map((s) => outcome(s, fixture, config, events));
  const tagged = events.map((e) => {
    const stage = stageForTime(fixture.stages, e.timestamp)!;
    const falseEvent = !stage.expected.startsWith('KNEE_'), wrong = !falseEvent && stage.expected !== e.direction;
    return { ...e, stageIndex: stage.stageIndex, expected: stage.expected, falseEvent, wrong,
      reacquisitionFalse: (falseEvent || wrong) && e.source === 'POST_REACQUISITION' };
  });
  const final = detector.getView();
  const sum = (key: 'falseEvents' | 'observableFalseEvents' | 'wrong' | 'duplicates') => stageOutcomes.reduce((n, s) => n + s[key], 0);
  const counts = { left: tagged.filter((e) => e.expected === 'KNEE_LEFT' && !e.wrong).length,
    right: tagged.filter((e) => e.expected === 'KNEE_RIGHT' && !e.wrong).length, falseEvents: sum('falseEvents'),
    observableFalseEvents: sum('observableFalseEvents'), wrong: sum('wrong'), duplicates: sum('duplicates'),
    crossGap: tagged.filter((e) => e.crossGap).length, reacquisitionFalse: tagged.filter((e) => e.reacquisitionFalse).length };
  const knees = stageOutcomes.filter((s) => s.expected.startsWith('KNEE_'));
  const completeKneeLabels = ['KNEE_LEFT', 'KNEE_RIGHT'].every((label) => knees.some((s) => s.expected === label && s.frameCount > 0));
  const referenceAccepted = completeKneeLabels && knees.every((s) => s.expectedObservable && s.correct === 1 && s.eventCount === 1) &&
    counts.falseEvents === 0 && counts.wrong === 0 && counts.duplicates === 0 && counts.crossGap === 0 && counts.reacquisitionFalse === 0;
  const stressAccepted = counts.observableFalseEvents === 0 && counts.crossGap === 0 && counts.reacquisitionFalse === 0 && counts.wrong === 0 && counts.duplicates === 0 &&
    knees.every((s) => !s.expectedObservable || s.correct === 1 && s.eventCount === 1);
  return { input: fixture.input, events: tagged, stageOutcomes, ...counts, finalState: final.state,
    finalTracking: { LEFT: Object.fromEntries(activeChannels(config).map((c) => [c, final.sides.LEFT[c].tracking])),
      RIGHT: Object.fromEntries(activeChannels(config).map((c) => [c, final.sides.RIGHT[c].tracking])) },
    ambiguityCount: final.ambiguityCount, episodes: detector.getEpisodes().filter((e) => activeChannels(config).includes(e.channel)), referenceAccepted, stressAccepted };
}
export function analyzeMultiConfig(fixtures: readonly PreparedMultiFixture[], config: MultiConfig) {
  const perFixture = fixtures.map((f) => analyzeMultiFixture(f, config));
  const completeRoles = ['REFERENCE_OLD_CLEAN', 'REFERENCE_LIVE', 'STRESS'].every((role) => fixtures.some((f) => f.input.role === role));
  const assigned = fixtures.every((f) => f.input.role !== 'UNASSIGNED');
  const viable = completeRoles && assigned && perFixture.every((r) => r.input.role === 'STRESS' ? r.stressAccepted : r.referenceAccepted);
  return { id: multiConfigId(config), strategy: config.strategy, config: { ...config }, perFixture,
    assessment: !completeRoles || !assigned ? 'INSUFFICIENT_EVIDENCE' : viable ? 'VIABLE' : 'REJECTED' };
}
export type MultiConfigResult = ReturnType<typeof analyzeMultiConfig>;
export function createMultiReport(fixtures: readonly PreparedMultiFixture[], strategies: MultiConfigResult[], createdAt = new Date().toISOString()) {
  return { version: 1, step: '4J', createdAt, settings: MULTI_SETTINGS, inputs: fixtures.map((f) => f.input),
    liveReplayParity: fixtures.map((f) => f.liveReplayParity),
    perFixture: fixtures.map(({ frames: _frames, liveReplayParity: _parity, ...summary }) => summary), strategies,
    viableConfigs: strategies.filter((r) => r.assessment === 'VIABLE').map((r) => ({ id: r.id, ...r.config })),
    warnings: ['Limited saved-fixture evidence; no automatic BEST or production threshold selection. First-Neutral compatibility frames are excluded, missing evidence is unavailable.'] };
}
export function assertYReferenceParity(fixtures: readonly PreparedMultiFixture[]) {
  for (const fixture of fixtures) {
    const shadow = analyzeMultiFixture(fixture, MULTI_DEFAULT), reference = fixture.productionY;
    const sameEvents = shadow.events.length === reference.events.length && shadow.events.every((e, i) =>
      e.direction === reference.events[i].direction && Math.abs(e.timestamp - reference.events[i].tMs) <= .000001);
    if (!sameEvents || shadow.finalState !== reference.finalState) throw new Error(`Y_ONLY shadow differs from production V3: ${fixture.input.filename}`);
  }
}
export function analyzeMultiSignals(inputs: readonly MultiInput[], configs = multiConfigs(), createdAt?: string) {
  const fixtures = prepareMultiInputs(inputs); assertYReferenceParity(fixtures);
  return createMultiReport(fixtures, configs.map((c) => analyzeMultiConfig(fixtures, c)), createdAt);
}
export type MultiReport = ReturnType<typeof createMultiReport>;
