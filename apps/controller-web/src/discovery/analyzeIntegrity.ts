import { stageForTime } from './discoveryStages';
import { analyzeMultiFixture, type PreparedMultiFixture } from './analyzeMultiSignal';
import { MULTI_DEFAULT } from './multiSignalShadow';
import { integrityDistributions, INTEGRITY_FEATURE_SETTINGS, type IntegrityFixture, type IntegrityFrame } from './integrityFeatures';
import { IntegrityShadow, FIXED_FLEXION_CONFIG, INTEGRITY_SWEEP, NO_INTEGRITY_GUARD, integrityConfigId, integrityConfigs, type IntegrityConfig } from './integrityGuard';

export type IntegrityMode = 'Y_ONLY' | 'FIXED_Y_OR_FLEXION';
export const INTEGRITY_SETTINGS = {
  analysisOnly: true, features: INTEGRITY_FEATURE_SETTINGS, sweep: INTEGRITY_SWEEP, fixedFlexion: FIXED_FLEXION_CONFIG,
  velocityVeto: 'current or immediately preceding usable frame at eligible channel entry only; abs velocity >= veto. Fixed flexion mode checks Y or flexion entries; no future samples',
  collapseVeto: 'current usable knee-ankle length / frozen Neutral median < MIN_RATIO; continuous including active candidates; ankle missing never invalidates Y',
  softRecovery: 'per-side SUSPECT_NOT_READY, discard all channel entry runs; observed abs(Y)<.25 continuously for 100ms; missing/dt>=400ms resets clear; recovery frame itself cannot start a gesture',
  continuity: 'original frame times/availability and hard-loss gates preserved; soft veto blocks both Y and flexion of that side, not the other side; no Guided pause',
  counting: 'one activation per READY -> SUSPECT transition; already suspect frames extend the episode. candidateCancelled includes prevented entry and interrupted existing run, also reported separately',
  reference: 'Y_ONLY without guard must match current production replay; first LIVE recall/false regression is relative to the same evidence mode without guard',
  acceptance: 'all four explicit roles required; old CLEAN/independent L=1 R=1 false/wrong/duplicate/cross-gap/soft-gap=0; first LIVE preserves per-stage true recall, no added false/wrong/duplicate; STRESS observable false/cross-gap/reacquisition false=0, unobservable misses excluded',
  fixedReturnPolicy: 'TRIGGER_CHANNEL_CLEAR, existing STEP 4J default; no new flexion or return-policy sweep',
  warnings: ['Exploratory post-failure analysis of four saved fixtures, not an independent validation of a newly selected guard. No BEST or production threshold selection.',
    'A visibility-valid geometric discontinuity is evidence of suspected corruption, not proof of the physical pose. World values are diagnostics only.'],
} as const;

export function runIntegrityFixture(f: IntegrityFixture, config: IntegrityConfig, mode: IntegrityMode, collectTrace = false) {
  const evidence = mode === 'Y_ONLY' ? MULTI_DEFAULT : FIXED_FLEXION_CONFIG, detector = new IntegrityShadow(config, evidence);
  const emitted: NonNullable<ReturnType<IntegrityShadow['processFrame']>>[] = [];
  const channelTrace: { timestamp: number; LEFT: number; RIGHT: number }[] = [];
  const summary = analyzeMultiFixture({ ...f, input: { ...f.input, role: f.input.role.startsWith('REFERENCE_LIVE') ? 'REFERENCE_LIVE' : f.input.role } } as PreparedMultiFixture,
    evidence, { processFrame: (frame) => {
      const event = detector.processFrame(frame as IntegrityFrame); if (event) emitted.push(event);
      if (collectTrace) {
        const view = detector.getView(), run = (side: 'LEFT' | 'RIGHT') => {
          const starts = (mode === 'Y_ONLY' ? [view.sides[side].Y.runAt] : [view.sides[side].Y.runAt, view.sides[side].FLEXION.runAt]).filter((v): v is number => v !== null);
          return starts.length ? frame.timestamp - Math.min(...starts) : 0;
        };
        channelTrace.push({ timestamp: frame.timestamp, LEFT: run('LEFT'), RIGHT: run('RIGHT') });
      }
      return event;
    }, getView: detector.getView, getEpisodes: detector.getEpisodes });
  const events = summary.events.map((event) => {
    const original = emitted.find((e) => e.timestamp === event.timestamp)!;
    return { ...event, softEpoch: original.softEpoch, softGapCrossConfirmation: original.softGapCrossConfirmation,
      softRecoveryFalse: (event.falseEvent || event.wrong) && original.softEpoch > 0 };
  });
  const episodes = detector.getSoftEpisodes().map((e) => ({ ...e, expected: stageForTime(f.stages, e.startedAt)?.expected ?? null }));
  const latencies = episodes.map((e) => e.timeToReadyMs).filter((v): v is number => v !== null).sort((a, b) => a - b);
  return { ...summary, input: f.input, mode, events, softGapCross: events.filter((e) => e.softGapCrossConfirmation).length,
    softRecoveryFalse: events.filter((e) => e.softRecoveryFalse).length,
    guardActivationCount: episodes.length, guardActivationsDuringTrueKick: episodes.filter((e) => e.expected?.startsWith('KNEE_')).length,
    guardActivationsDuringExpectedLimbKick: episodes.filter((e) => e.expected === `KNEE_${e.side}`).length,
    guardActivationsDuringNeutral: episodes.filter((e) => e.expected === 'NEUTRAL').length,
    candidateCancelledBySoftLoss: episodes.filter((e) => e.candidateCancelled).length,
    existingRunCancelledBySoftLoss: episodes.filter((e) => e.existingRunCancelled).length,
    entryPreventedBySoftLoss: episodes.filter((e) => e.entryPrevented).length,
    timeToReadyAfterSoftLoss: { completed: latencies.length, unresolved: episodes.length - latencies.length, minMs: latencies[0] ?? null,
      maxMs: latencies.at(-1) ?? null, meanMs: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null },
    softEpisodes: episodes, finalSoftTracking: detector.getSoftView(), channelTrace };
}
type FixtureResult = ReturnType<typeof runIntegrityFixture>;
export function createIntegrityEvidence(fixtures: readonly IntegrityFixture[]) {
  const references = fixtures.map((f) => ({ input: f.input,
    yOnly: runIntegrityFixture(f, NO_INTEGRITY_GUARD, 'Y_ONLY', true), fixedFlexion: runIntegrityFixture(f, NO_INTEGRITY_GUARD, 'FIXED_Y_OR_FLEXION', true) }));
  for (const [index, f] of fixtures.entries()) {
    const actual = references[index].yOnly, expected = f.production.result;
    if (actual.events.length !== expected.events.length || actual.events.some((e, i) => e.direction !== expected.events[i].direction || Math.abs(e.timestamp - expected.events[i].tMs) > .000001) ||
      actual.finalState !== expected.finalState) throw new Error(`Integrity NONE differs from production: ${f.input.filename}`);
  }
  const perFixture = fixtures.map((f, index) => {
    const reference = references[index];
    // Actual production anchors first. A known Y miss (LIVE1 RIGHT) uses the explicitly
    // labelled fixed-flexion diagnostic anchor, never pretends that LIVE Y detected it.
    const anchors = reference.yOnly.events.filter((e) => f.input.role === 'REFERENCE_LIVE_2_INDEPENDENT' && e.falseEvent || !e.falseEvent && !e.wrong && f.input.role !== 'STRESS')
      .map((event) => ({ mode: 'Y_ONLY' as IntegrityMode, event }));
    if (f.input.role !== 'STRESS') for (const e of reference.fixedFlexion.events) {
      if (!e.falseEvent && !e.wrong && !anchors.some((a) => a.event.stageIndex === e.stageIndex && a.event.direction === e.direction))
        anchors.push({ mode: 'FIXED_Y_OR_FLEXION', event: e });
    }
    const traces = anchors.map(({ event, mode }) => {
      const clock = new Map((mode === 'Y_ONLY' ? reference.yOnly : reference.fixedFlexion).channelTrace.map((t) => [t.timestamp, t[event.side]]));
      return { kind: event.falseEvent ? 'FALSE' : 'TRUE', referenceMode: mode, event,
        startMs: event.candidateStartedAt - 500, endMs: event.candidateStartedAt + 500,
        rows: f.frames.filter((r) => r.timestamp >= event.candidateStartedAt - 500 && r.timestamp <= event.candidateStartedAt + 500).map((r) => ({
          timestamp: r.timestamp, relativeToEntryMs: r.timestamp - event.candidateStartedAt, side: event.side,
          stageIndex: r.stageIndex, expected: stageForTime(f.stages, r.timestamp)?.expected ?? null,
          ...r.measurements[event.side], flexionEvidence: r[event.side].FLEXION,
          referenceCandidateRunMs: clock.get(r.timestamp) ?? 0, isCandidateEntry: r.timestamp === event.candidateStartedAt, isConfirmation: r.timestamp === event.timestamp,
        })) };
    });
    return { input: f.input, liveReplayParity: f.liveReplayParity, segmentBaseline: f.segmentBaseline, flexionBaseline: f.baseline,
      yBaseline: f.yBaseline, distributions: integrityDistributions(f), traces,
      // Primitive measurements only, with every evaluated/missing frame retained for audit.
      frames: f.frames.map((r) => ({ timestamp: r.timestamp, stageIndex: r.stageIndex, calibrationOnly: r.calibrationOnly, measurements: r.measurements })) };
  });
  return { version: 1, step: '4K.1', settings: INTEGRITY_SETTINGS, inputs: fixtures.map((f) => f.input),
    liveReplayParity: fixtures.map((f) => f.liveReplayParity), references, perFixture };
}
export type IntegrityEvidence = ReturnType<typeof createIntegrityEvidence>;
export function integrityTracesCsv(evidence: IntegrityEvidence) {
  const header = ['captureId', 'role', 'trialId', 'kind', 'referenceMode', 'candidateStartMs', 'eventMs', 'timestamp', 'relativeToEntryMs', 'side', 'stage',
    'Y', 'YVelocity', 'relativeX', 'relativeY', 'relativeXNorm', 'relativeYNorm', 'relative2DVelocity', 'hipKneeLength', 'hipKneeRatio',
    'kneeAnkleLength', 'kneeAnkleRatio', 'imageAngle', 'angleVelocity', 'hipVisibility', 'otherHipVisibility', 'kneeVisibility', 'ankleVisibility',
    'YTrackingState', 'YCandidateRunMs', 'referenceCandidateRunMs', 'flexionEvidence', 'worldHipKneeLength', 'worldKneeAnkleLength', 'worldAngle'];
  const quote = (v: string | number | null) => {
    const text = v === null ? '' : typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : String(v);
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = evidence.perFixture.flatMap((f) => f.traces.flatMap((trace) => trace.rows.map((r) => [
    f.input.captureId, f.input.role, f.input.trialId, trace.kind, trace.referenceMode, trace.event.candidateStartedAt, trace.event.timestamp,
    r.timestamp, r.relativeToEntryMs, r.side, r.expected, r.deltaDyNorm, r.deltaDyNormVelocity, r.kneeRelativeX, r.kneeRelativeY, r.kneeRelativeXNorm, r.kneeRelativeYNorm,
    r.kneeCenterRelative2DVelocity, r.hipKneeLength, r.hipKneeRatio, r.kneeAnkleLength, r.kneeAnkleRatio, r.kneeAngle, r.kneeAngleVelocity,
    r.visibility.hip, r.visibility.otherHip, r.visibility.knee, r.visibility.ankle, r.trackingState, r.candidateRunMs, r.referenceCandidateRunMs, r.flexionEvidence,
    r.worldHipKneeLength, r.worldKneeAnkleLength, r.worldKneeAngle,
  ].map(quote).join(','))));
  return [header.join(','), ...rows].join('\r\n');
}
function compare(reference: FixtureResult, result: FixtureResult) {
  const stagePairs = result.stageOutcomes.map((s) => ({ current: s, previous: reference.stageOutcomes.find((r) => r.stageIndex === s.stageIndex)! }));
  return { falseEventsRemoved: stagePairs.reduce((n, { current: c, previous: p }) => n + Math.max(0, p.falseEvents - c.falseEvents), 0),
    falseEventsAdded: stagePairs.reduce((n, { current: c, previous: p }) => n + Math.max(0, c.falseEvents - p.falseEvents), 0),
    trueEventsLost: stagePairs.reduce((n, { current: c, previous: p }) => n + Math.max(0, p.correct - c.correct), 0),
    recallPreserved: stagePairs.every(({ current: c, previous: p }) => c.correct >= p.correct && c.falseEvents <= p.falseEvents && c.wrong <= p.wrong && c.duplicates <= p.duplicates) };
}
function accepted(result: FixtureResult, regression: ReturnType<typeof compare>) {
  const safety = result.crossGap === 0 && result.softGapCross === 0;
  if (result.input.role === 'STRESS') return safety && result.stressAccepted && result.softRecoveryFalse === 0;
  if (result.input.role === 'REFERENCE_LIVE_1') return safety && regression.recallPreserved;
  return safety && result.referenceAccepted;
}
export function analyzeIntegrityConfig(fixtures: readonly IntegrityFixture[], evidence: IntegrityEvidence, config: IntegrityConfig) {
  const completeRoles = ['REFERENCE_OLD_CLEAN', 'STRESS', 'REFERENCE_LIVE_1', 'REFERENCE_LIVE_2_INDEPENDENT'].every((role) => fixtures.some((f) => f.input.role === role)) &&
    fixtures.every((f) => f.input.role !== 'UNASSIGNED');
  const run = (mode: IntegrityMode) => {
    const perFixture = fixtures.map((f, index) => {
      const { channelTrace: _unused, ...result } = runIntegrityFixture(f, config, mode);
      const ref = mode === 'Y_ONLY' ? evidence.references[index].yOnly : evidence.references[index].fixedFlexion;
      const regression = compare(ref, { ...result, channelTrace: [] });
      return { ...result, regression, accepted: accepted({ ...result, channelTrace: [] }, regression) };
    });
    return { mode, assessment: !completeRoles ? 'INSUFFICIENT_EVIDENCE' : perFixture.every((f) => f.accepted) ? 'VIABLE' : 'REJECTED', perFixture };
  };
  return { id: integrityConfigId(config), config: { ...config }, yOnly: run('Y_ONLY'), fixedFlexionDiagnostic: run('FIXED_Y_OR_FLEXION') };
}
export type IntegrityConfigResult = ReturnType<typeof analyzeIntegrityConfig>;
export function createIntegrityReport(evidence: IntegrityEvidence, strategies: IntegrityConfigResult[], createdAt = new Date().toISOString()) {
  return { ...evidence, createdAt, strategies,
    viableIntegrityConfigs: strategies.filter((s) => s.yOnly.assessment === 'VIABLE').map((s) => ({ id: s.id, ...s.config })),
    viableFixedFlexionDiagnosticConfigs: strategies.filter((s) => s.fixedFlexionDiagnostic.assessment === 'VIABLE').map((s) => ({ id: s.id, ...s.config })) };
}
export function analyzeIntegrity(fixtures: readonly IntegrityFixture[], configs = integrityConfigs(), createdAt?: string) {
  const evidence = createIntegrityEvidence(fixtures);
  return createIntegrityReport(evidence, configs.map((c) => analyzeIntegrityConfig(fixtures, evidence, c)), createdAt);
}
export type IntegrityReport = ReturnType<typeof createIntegrityReport>;
