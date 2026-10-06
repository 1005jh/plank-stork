import { BODY_STATUS, BODY_ROLES, FEATURE_FAMILIES, familySignal, flattenBodyValues, type BodyFixture, type BodyFrame, type FeatureFamily } from './bodyLocalFeatures';
import { createTwistConfusionEvidence } from './analyzeTwistConfusion';
import { distribution } from './integrityFeatures';
import { stageForTime } from './discoveryStages';
import { LIMBS, type Limb } from './discoveryFeatures';
import { signalStats } from './analyzeMultiSignal';
import { trajectorySummary, onsetRelation } from './causalTrajectory';
import { FeatureKickShadow, FEATURE_GRID, FEATURE_RUNTIME, featureConfigId, type FeatureConfig, type FeatureEvent } from './featureKickShadow';

const evaluated = (f: { calibrationOnly: boolean; stageIndex: number | null }) => !f.calibrationOnly && f.stageIndex !== null;
function distributions(frames: readonly BodyFrame[]) {
  const values = frames.map((r) => flattenBodyValues(r.values));
  return Object.fromEntries(Object.keys(values[0] ?? {}).map((key) => [key, distribution(values.map((v) => v[key]))]));
}
const SIGNALS = [...FEATURE_FAMILIES, 'OLD_Y'] as const;
function series(frames: readonly BodyFrame[], side: Limb, signal: typeof SIGNALS[number]) {
  return frames.map((f) => ({ timestamp: f.timestamp, value: signal === 'OLD_Y' ? f.values[side].oldY : familySignal(f.values, side, signal) }));
}
export function createBodyEvidence(fixtures: readonly BodyFixture[]) {
  // Reuse exactly the measured 4L anchors/references without changing its report or entry rules.
  const legacy = createTwistConfusionEvidence(fixtures.map((f) => f.reference));
  const perFixture = fixtures.map((f, i) => {
    const rows = f.frames.filter(evaluated), anchors = legacy.twistConfusionEvidence.perFixture[i].eventTraces;
    const anchorTraces = anchors.map((a) => ({ kind: a.kind, mode: a.mode, side: a.side, expected: a.expected, stageIndex: a.stageIndex,
      candidateStart: a.candidateStart, kickConfirm: a.kickConfirm, anchorMeaning: a.anchorMeaning, startMs: a.startMs, endMs: a.endMs,
      rows: f.frames.filter((r) => r.timestamp >= a.startMs && r.timestamp <= a.endMs).map((r) => ({ ...r, flat: flattenBodyValues(r.values) })) }));
    const temporalSummaries = anchors.map((a) => ({ kind: a.kind, mode: a.mode, side: a.side, expected: a.expected, candidateStart: a.candidateStart,
      anchorMeaning: a.anchorMeaning, signals: SIGNALS.map((signal) => {
        const candidate = series(f.frames, a.side, signal), opponent = series(f.frames, a.side === 'LEFT' ? 'RIGHT' : 'LEFT', signal);
        return { signal, onsets: [.15, .20, .25, .30].map((t) => onsetRelation(candidate, opponent, a.candidateStart, t)),
          windows: [50, 100, 150, 200].flatMap((duration) => (['PAST_ONLY', 'WAIT_THEN_CONFIRM'] as const).map((mode) => {
            const start = mode === 'PAST_ONLY' ? a.candidateStart - duration : a.candidateStart, end = mode === 'PAST_ONLY' ? a.candidateStart : a.candidateStart + duration;
            return { mode, duration, decisionAt: end, candidate: trajectorySummary(candidate, start, end), opponent: trajectorySummary(opponent, start, end) };
          })) };
      }) }));
    const groups = (['TRUE_KICK', 'TWIST_FALSE', 'TRACKING_CORRUPTION_FALSE'] as const).map((group) => {
      const selected = anchors.filter((a) => group === 'TRUE_KICK' ? a.kind === 'TRUE_EVENT' : group === 'TWIST_FALSE' ? a.kind === 'FALSE_EVENT' && a.expected.startsWith('TWIST_') : a.kind === 'FALSE_EVENT' && a.expected === 'NEUTRAL');
      return { group, windows: selected.length, features: distributions(rows.filter((r) => selected.some((a) => r.timestamp >= a.startMs && r.timestamp <= a.endMs))) };
    });
    return { input: f.input, analysisStatus: BODY_STATUS, liveReplayParity: f.liveReplayParity, baseline: f.baseline,
      coverage: distributions(rows), perStageDistributions: f.stages.map((s) => ({ ...s, calibrationOnly: s.stageIndex === f.baseline.excludedStageIndex, features: distributions(rows.filter((r) => r.stageIndex === s.stageIndex)) })),
      perLabelDistributions: ['NEUTRAL', 'TWIST_LEFT', 'TWIST_RIGHT', 'KNEE_LEFT', 'KNEE_RIGHT'].map((label) => ({ label, features: distributions(rows.filter((r) => stageForTime(f.stages, r.timestamp)?.expected === label)) })),
      eventWindowGroups: groups, anchorTraces, temporalSummaries };
  });
  return { version: 1, step: '4M', analysisStatus: BODY_STATUS,
    warning: 'All five fixtures are discovery data. No new holdout, automatic BEST, or production-ready claim. Preregister a config and collect an independent live holdout before rollout.',
    settings: { visibility: { hips: .7, knees: .5, shoulders: .5, ankles: .5 }, numericAxisEpsilon: 1e-8,
      coordinates: 'Normalized image XY; same-side knee minus hip, pelvis left-to-right axes, torso shoulderCenter-minus-hipCenter axes with pelvis-aligned lateral sign.',
      baseline: 'Latest successful/frozen before Guided; OLD CLEAN only FIRST_NEUTRAL_COMPATIBILITY excluded from evaluation. Frozen bodyScale; per-feature frozen medians, circular angle means. No dynamic scale.',
      aliases: { PELVIS_RESIDUAL: 'PELVIS_DIFFERENTIAL', TORSO_RESIDUAL: 'TORSO_DIFFERENTIAL' },
      residualLimitation: 'L residual=(L-R)/2 and R residual=-L residual; magnitudes identical. Direction cannot be identified without extra evidence. Symmetric ties WAIT_CLEAR; never map sign to side.',
      temporal: 'Past-only or explicitly wait T ms; observed frame samples, trapezoidal integral in seconds, no missing/dt>=400ms path. Full anchor traces are diagnostics only, never detector inputs. Boundary samples not interpolated.',
      onset: 'Pre-entry 200ms observed low-to-high crossing, .15/.20/.25/.30 diagnostic references. Already high/missing before high is left-censored, not invented onset.',
      groups: 'Union ±750ms anchor windows within evaluated stages; repeated reference anchors do not multiply frame weights. Neutral false association is not proof of tracking cause.',
      directGrid: FEATURE_GRID, runtime: FEATURE_RUNTIME,
      temporalGrid: 'Only after complete direct grid has no viable configuration: first five directional families x thresholds .30/.50 x waits100/150/200 x (coherence .5/.65/.8 OR efficiency .4/.6/.8) =180. Predetermined bounded comparison; no exhaustive temporal claim.',
      acceptance: 'Four references both kicks observable/exactly1, false/wrong/duplicate/hardgap/reacquisitionFalse0; STRESS observable false0, observable kicks exactly1, wrong/duplicate/hardgap/reacquisitionFalse0. Missing roles => insufficient evidence.' },
    inputs: fixtures.map((f) => f.input), bodyLocalEvidence: { perFixture }, references: legacy.references,
    referenceMatrix: legacy.references.map((ref, i) => ({ input: fixtures[i].input, modes: [ref.yOnly, ref.yIntegrity12, ref.fixedFlexionIntegrity12].map((r, mode) => ({
      mode: ['PRODUCTION_Y', 'Y_INTEGRITY12', 'FIXED_Y_FLEXION_INTEGRITY12'][mode], left: r.left, right: r.right, falseEvents: r.falseEvents,
      wrong: r.wrong, duplicates: r.duplicates, hardCrossGap: r.crossGap, reacquisitionFalse: r.reacquisitionFalse,
      coverage: Object.fromEntries(LIMBS.map((side) => { const rows = fixtures[i].reference.frames.filter(evaluated);
        return [side, { frames: rows.length, usable: rows.filter((f) => f[side].Y !== null || mode === 2 && f[side].FLEXION !== null).length,
          fraction: rows.length ? rows.filter((f) => f[side].Y !== null || mode === 2 && f[side].FLEXION !== null).length / rows.length : null }]; })),
      trueEvents: r.events.filter((e) => !e.falseEvent && !e.wrong).map((e) => ({ side: e.side, candidateStart: e.candidateStartedAt, confirm: e.timestamp, latency: e.timestamp - e.candidateStartedAt })),
      latency: latency(r.events.filter((e) => !e.falseEvent && !e.wrong).map((e) => ({ latencyMs: e.timestamp - e.candidateStartedAt }))),
    })) })) };
}
export type BodyEvidence = ReturnType<typeof createBodyEvidence>;
function latency(events: { latencyMs: number }[]) {
  const d = distribution(events.map((e) => e.latencyMs)); return { count: d.usable, p50: d.median, p95: d.p95, max: d.max };
}
export function runFeatureFixture(f: BodyFixture, config: FeatureConfig) {
  const core = new FeatureKickShadow(config), rawEvents: FeatureEvent[] = [], rows = f.frames.filter(evaluated);
  for (const row of rows) {
    const event = core.processFrame(row.timestamp, { LEFT: familySignal(row.values, 'LEFT', config.featureFamily), RIGHT: familySignal(row.values, 'RIGHT', config.featureFamily) });
    if (event) rawEvents.push(event);
  }
  const events = rawEvents.map((e) => {
    const stage = stageForTime(f.stages, e.timestamp)!;
    const falseEvent = !stage.expected.startsWith('KNEE_'), wrong = !falseEvent && e.direction !== stage.expected;
    return { ...e, stageIndex: stage.stageIndex, expected: stage.expected, falseEvent, wrong, reacquisitionFalse: (falseEvent || wrong) && e.postReacquisition };
  });
  const stageOutcomes = f.stages.map((s) => {
    const frames = rows.filter((r) => r.stageIndex === s.stageIndex), current = events.filter((e) => e.stageIndex === s.stageIndex);
    const availability = (side: Limb) => signalStats(frames.map((r) => ({ timestamp: r.timestamp, value: familySignal(r.values, side, config.featureFamily) })), s.startMs, s.endMs, []);
    const LEFT = availability('LEFT'), RIGHT = availability('RIGHT'), kick = s.expected.startsWith('KNEE_');
    return { ...s, calibrationOnly: s.stageIndex === f.baseline.excludedStageIndex, frameCount: frames.length, coverage: { LEFT, RIGHT },
      expectedObservable: s.expected === 'KNEE_LEFT' ? LEFT.observable : s.expected === 'KNEE_RIGHT' ? RIGHT.observable : LEFT.observable && RIGHT.observable,
      correct: current.filter((e) => e.direction === s.expected).length, falseEvents: current.filter((e) => e.falseEvent).length,
      observableFalseEvents: current.filter((e) => e.falseEvent && (e.side === 'LEFT' ? LEFT : RIGHT).observable).length,
      wrong: current.filter((e) => e.wrong).length, duplicates: kick ? Math.max(0, current.length - 1) : 0, eventCount: current.length };
  });
  const sum = (key: 'falseEvents' | 'observableFalseEvents' | 'wrong' | 'duplicates') => stageOutcomes.reduce((n, s) => n + s[key], 0);
  const counts = { left: events.filter((e) => e.expected === 'KNEE_LEFT' && !e.wrong).length, right: events.filter((e) => e.expected === 'KNEE_RIGHT' && !e.wrong).length,
    falseEvents: sum('falseEvents'), observableFalseEvents: sum('observableFalseEvents'), wrong: sum('wrong'), duplicates: sum('duplicates'),
    crossGap: events.filter((e) => e.crossGap).length, reacquisitionFalse: events.filter((e) => e.reacquisitionFalse).length };
  const knees = stageOutcomes.filter((s) => s.expected.startsWith('KNEE_'));
  const complete = ['KNEE_LEFT', 'KNEE_RIGHT'].every((s) => knees.some((k) => k.expected === s && k.frameCount > 0));
  const stress = f.input.role === 'STRESS';
  const accepted = complete && knees.every((s) => stress && !s.expectedObservable || s.expectedObservable && s.correct === 1 && s.eventCount === 1) &&
    (stress ? counts.observableFalseEvents === 0 : counts.falseEvents === 0 && counts.left === 1 && counts.right === 1) &&
    counts.wrong === 0 && counts.duplicates === 0 && counts.crossGap === 0 && counts.reacquisitionFalse === 0;
  return { input: f.input, ...counts, events, stageOutcomes, coverage: Object.fromEntries(LIMBS.map((s) => [s, distribution(rows.map((r) => familySignal(r.values, s, config.featureFamily)))])),
    latency: latency(events.filter((e) => !e.falseEvent && !e.wrong)), final: core.getView(), accepted };
}
export function analyzeFeatureConfig(fixtures: readonly BodyFixture[], evidence: BodyEvidence, config: FeatureConfig) {
  if (JSON.stringify(fixtures.map((f) => f.input)) !== JSON.stringify(evidence.inputs)) throw new Error('Inspect the same assigned fixtures before comparison');
  const complete = BODY_ROLES.slice(1).every((role) => fixtures.some((f) => f.input.role === role)) && fixtures.every((f) => f.input.role !== 'UNASSIGNED');
  const perFixture = fixtures.map((f, i) => {
    const result = runFeatureFixture(f, config), reference = evidence.references[i].yOnly;
    const changes = result.stageOutcomes.map((s) => {
      const before = reference.stageOutcomes.find((b) => b.stageIndex === s.stageIndex)!;
      return { stageIndex: s.stageIndex, falseRemoved: Math.max(0, before.falseEvents - s.falseEvents), falseAdded: Math.max(0, s.falseEvents - before.falseEvents),
        truePreserved: Math.min(before.correct, s.correct), trueLost: Math.max(0, before.correct - s.correct) };
    });
    const sum = (key: 'falseRemoved' | 'falseAdded' | 'truePreserved' | 'trueLost') => changes.reduce((n, s) => n + s[key], 0);
    return { ...result, changes, falseRemoved: sum('falseRemoved'), falseAdded: sum('falseAdded'), truePreserved: sum('truePreserved'), trueLost: sum('trueLost') };
  });
  const sum = (k: 'falseRemoved' | 'falseAdded' | 'truePreserved' | 'trueLost') => perFixture.reduce((n, f) => n + f[k], 0);
  return { id: featureConfigId(config), ...config, analysisStatus: BODY_STATUS, perFixture, falseRemoved: sum('falseRemoved'), falseAdded: sum('falseAdded'),
    truePreserved: sum('truePreserved'), trueLost: sum('trueLost'), latency: latency(perFixture.flatMap((f) => f.events.filter((e) => !e.falseEvent && !e.wrong))),
    assessment: !complete ? 'INSUFFICIENT_EVIDENCE' as const : perFixture.every((f) => f.accepted) ? 'EXPLORATORY_VIABLE' as const : 'REJECTED' as const };
}
export type FeatureResult = ReturnType<typeof analyzeFeatureConfig>;
export function featureNeighborhood(results: readonly FeatureResult[], family: FeatureFamily) {
  const selected = results.filter((r) => r.featureFamily === family && r.temporalRule === null), passing = selected.filter((r) => r.assessment === 'EXPLORATORY_VIABLE');
  const configs = passing.map((r) => {
    const ti = FEATURE_GRID.thresholds.indexOf(r.threshold as typeof FEATURE_GRID.thresholds[number]), di = FEATURE_GRID.dwellMs.indexOf(r.dwell as typeof FEATURE_GRID.dwellMs[number]);
    const thresholdNeighbors = [ti - 1, ti + 1].filter((i) => i >= 0 && i < FEATURE_GRID.thresholds.length).map((i) => ({ threshold: FEATURE_GRID.thresholds[i], pass: passing.some((p) => p.threshold === FEATURE_GRID.thresholds[i] && p.dwell === r.dwell) }));
    const dwellNeighbors = [di - 1, di + 1].filter((i) => i >= 0 && i < FEATURE_GRID.dwellMs.length).map((i) => ({ dwell: FEATURE_GRID.dwellMs[i], pass: passing.some((p) => p.threshold === r.threshold && p.dwell === FEATURE_GRID.dwellMs[i]) }));
    return { id: r.id, thresholdNeighbors, dwellNeighbors, neighborhood: thresholdNeighbors.some((n) => n.pass) && dwellNeighbors.some((n) => n.pass) ? 'BROAD_NEIGHBORHOOD' : 'FRAGILE' };
  });
  return { featureFamily: family, tested: selected.length, acceptancePassingCount: passing.length, broadCount: configs.filter((c) => c.neighborhood === 'BROAD_NEIGHBORHOOD').length, configs };
}
export function createBodyReport(evidence: BodyEvidence, results: FeatureResult[], createdAt = new Date().toISOString()) {
  const neighborhoodSummary = FEATURE_FAMILIES.map((f) => featureNeighborhood(results, f));
  const candidateFamilyResults = results.map((r) => {
    const direct = neighborhoodSummary.flatMap((n) => n.configs).find((c) => c.id === r.id);
    // Temporal acceptance alone has no complete threshold/dwell neighborhood in this bounded extension.
    return { ...r, assessment: r.assessment === 'EXPLORATORY_VIABLE' && (r.temporalRule !== null || direct?.neighborhood === 'FRAGILE') ? 'FRAGILE' : r.assessment };
  });
  return { ...evidence, createdAt, candidateFamilyResults, neighborhoodSummary,
    acceptancePassingConfigs: results.filter((r) => r.assessment === 'EXPLORATORY_VIABLE').map((r) => r.id),
    exploratoryViableConfigs: candidateFamilyResults.filter((r) => r.assessment === 'EXPLORATORY_VIABLE').map((r) => r.id),
    comparisonCounting: 'False removed/added and true preserved/lost relative to production Y, per stage; no cancellation between stages. Temporal passing configs remain FRAGILE until neighborhood validation.' };
}
export type BodyReport = ReturnType<typeof createBodyReport>;
