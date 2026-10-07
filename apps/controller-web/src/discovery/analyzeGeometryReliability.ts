import { GEOMETRY_STATUS, type GeometryFixture, type GeometryFrame } from './geometryReliabilityFeatures';
import { BODY_ROLES, AXIS_EPSILON } from './bodyLocalFeatures';
import { createTwistConfusionEvidence } from './analyzeTwistConfusion';
import { distribution } from './integrityFeatures';
import { LIMBS, type Limb } from './discoveryFeatures';
import { stageForTime } from './discoveryStages';
import { runIntegrityFixture } from './analyzeIntegrity';
import { PRE_REGISTERED_INTEGRITY_CONFIG } from './integrityGuard';
import { RELIABILITY_CUTS, reliabilityMarkers, markerId, markerDecision, descriptiveCategories, GeometryEntryGuard, qualityGateConfigs, type QualityGateConfig } from './geometryReliabilityMarkers';

const evaluated = (f: GeometryFrame) => !f.calibrationOnly && f.stageIndex !== null;
function distributions(rows: readonly GeometryFrame[], keys: readonly string[]) {
  return Object.fromEntries(keys.map((key) => [key, distribution(rows.map((r) => r.values[key] ?? null))]));
}
export function trackingLossEpisodes(f: GeometryFixture) {
  const episodes: { side: Limb; startMs: number; endMs: number | null; stageIndex: number | null; reason: 'MISSING_IMAGE_OR_WORLD_KNEE_GEOMETRY' | 'HARD_GAP' }[] = [];
  for (const side of LIMBS) {
    const limb = side === 'LEFT' ? 'left' : 'right'; let active: typeof episodes[number] | null = null, previous: GeometryFrame | null = null;
    for (const row of f.frames.filter(evaluated)) {
      if (previous && row.timestamp - previous.timestamp >= 400) episodes.push({ side, startMs: row.timestamp, endMs: row.timestamp, stageIndex: row.stageIndex, reason: 'HARD_GAP' });
      const missing = row.values[`image.${limb}HipKneeLength`] === null || row.values[`world.${limb}HipKneeLength`] === null;
      if (missing && !active) { active = { side, startMs: row.timestamp, endMs: null, stageIndex: row.stageIndex, reason: 'MISSING_IMAGE_OR_WORLD_KNEE_GEOMETRY' }; episodes.push(active); }
      if (!missing && active) { active.endMs = row.timestamp; active = null; }
      previous = row;
    }
  }
  return episodes;
}
export type GeometryGroup = 'TRUE_KICK' | 'TWIST_FALSE' | 'TRACKING_CORRUPTION_FALSE' | 'TRACKING_LOSS' | 'NORMAL_NON_KICK';
interface Window { side: Limb; startMs: number; endMs: number; kind: string; expected: string }
export function groupRows(f: GeometryFixture, anchors: readonly Window[], group: GeometryGroup) {
  const windows = anchors.filter((a) => group === 'TRUE_KICK' ? a.kind === 'TRUE_EVENT' : group === 'TWIST_FALSE' ? a.kind === 'FALSE_EVENT' && a.expected.startsWith('TWIST_') :
    group === 'TRACKING_CORRUPTION_FALSE' ? a.kind === 'FALSE_EVENT' && a.expected === 'NEUTRAL' : group === 'TRACKING_LOSS' ? a.kind === 'TRACKING_LOSS' : false);
  const excluded = anchors.filter((a) => a.kind === 'TRUE_EVENT' || a.kind === 'FALSE_EVENT' || a.kind === 'TRACKING_LOSS');
  const eligible = f.frames.filter(evaluated);
  const rows = eligible.filter((r) => group === 'NORMAL_NON_KICK' ? !stageForTime(f.stages, r.timestamp)!.expected.startsWith('KNEE_') && !excluded.some((a) => r.timestamp >= a.startMs && r.timestamp <= a.endMs) : windows.some((a) => r.timestamp >= a.startMs && r.timestamp <= a.endMs));
  // Side-aligned comparisons count each (timestamp, side) once even when multiple anchors overlap.
  const sideRows = rows.flatMap((row) => LIMBS.filter((side) => group === 'NORMAL_NON_KICK' || windows.some((a) => a.side === side && row.timestamp >= a.startMs && row.timestamp <= a.endMs)).map((side) => ({ row, side })));
  return { rows, sideRows, windowCount: windows.length };
}
export const GEOMETRY_GROUPS: GeometryGroup[] = ['TRUE_KICK', 'TWIST_FALSE', 'TRACKING_CORRUPTION_FALSE', 'TRACKING_LOSS', 'NORMAL_NON_KICK'];
const INFORMATION_FEATURES = ['imageMovementMagnitude', 'worldMovementMagnitude', 'worldLocal3DMagnitude', 'deltaWorldLongNorm', 'deltaWorldDepthNorm'] as const;
function informationDistributions(pairs: { row: GeometryFrame; side: Limb }[]) {
  return Object.fromEntries(INFORMATION_FEATURES.flatMap((feature) => {
    const values = pairs.map(({ row, side }) => row.values[`${side}.${feature}`] ?? null);
    return [[feature, distribution(values)], [`abs.${feature}`, distribution(values.map((v) => v === null ? null : Math.abs(v)))]];
  }));
}
export function createGeometryEvidence(fixtures: readonly GeometryFixture[]) {
  const legacy = createTwistConfusionEvidence(fixtures.map((f) => f.reference));
  const perFixture = fixtures.map((f, i) => {
    const keys = Object.keys(f.frames[0]?.values ?? {}), rows = f.frames.filter(evaluated), ref = legacy.references[i], lossEpisodes = trackingLossEpisodes(f);
    const lossAnchors = f.input.role === 'STRESS' ? lossEpisodes.map((e) => ({ kind: 'TRACKING_LOSS', mode: 'DIAGNOSTIC_LOSS_NOT_EVENT', side: e.side, stageIndex: e.stageIndex,
      candidateStart: e.startMs, kickConfirm: null, expected: stageForTime(f.stages, e.startMs)?.expected ?? 'UNLABELLED', anchorMeaning: e.reason, startMs: e.startMs - 750, endMs: e.startMs + 750 })) : [];
    const anchors = [...legacy.twistConfusionEvidence.perFixture[i].eventTraces.map(({ rows: _rows, distributions: _d, candidateDistributions: _c, temporalPeaks: _p, ...a }) => a), ...lossAnchors];
    // Group TRACKING_LOSS across all fixtures, independent of how many loss traces are rendered.
    const groupAnchors = [...anchors.filter((a) => a.kind !== 'TRACKING_LOSS'), ...lossEpisodes.map((e) => ({ side: e.side, startMs: e.startMs - 750, endMs: (e.endMs ?? f.stages.at(-1)!.endMs) + 750, kind: 'TRACKING_LOSS', expected: stageForTime(f.stages, e.startMs)?.expected ?? 'UNLABELLED' }))];
    const groups = GEOMETRY_GROUPS.map((group) => { const g = groupRows(f, groupAnchors, group);
      return { group, windowCount: g.windowCount, frameCount: g.rows.length, sideFrameCount: g.sideRows.length, features: distributions(g.rows, keys), candidateAligned: informationDistributions(g.sideRows) }; });
    const anchorTraces = anchors.map((a) => ({ ...a, rows: f.frames.filter((r) => r.timestamp >= a.startMs && r.timestamp <= a.endMs).map((r) => ({ timestamp: r.timestamp,
      relativeToAnchorMs: r.timestamp - a.candidateStart, fixture: f.input.captureId, role: f.input.role, stage: r.stageIndex,
      expected: stageForTime(f.stages, r.timestamp)?.expected ?? null, side: a.side, calibrationOnly: r.calibrationOnly, ...r.values, ...r.flags,
      leftIntegrity12Activation: ref.yIntegrity12.softEpisodes.some((e) => e.side === 'LEFT' && e.startedAt === r.timestamp),
      rightIntegrity12Activation: ref.yIntegrity12.softEpisodes.some((e) => e.side === 'RIGHT' && e.startedAt === r.timestamp),
      leftFixedIntegrity12Activation: ref.fixedFlexionIntegrity12.softEpisodes.some((e) => e.side === 'LEFT' && e.startedAt === r.timestamp),
      rightFixedIntegrity12Activation: ref.fixedFlexionIntegrity12.softEpisodes.some((e) => e.side === 'RIGHT' && e.startedAt === r.timestamp),
    })) }));
    const subset = (predicate: (key: string) => boolean) => Object.fromEntries(Object.entries(distributions(rows, keys)).filter(([key]) => predicate(key)));
    return { input: f.input, liveReplayParity: f.liveReplayParity, baseline: f.baseline,
      perStageDistributions: f.stages.map((s) => ({ ...s, calibrationOnly: s.stageIndex === f.baseline.excludedStageIndex, features: distributions(rows.filter((r) => r.stageIndex === s.stageIndex), keys) })),
      perLabelDistributions: ['NEUTRAL', 'TWIST_LEFT', 'TWIST_RIGHT', 'KNEE_LEFT', 'KNEE_RIGHT'].map((label) => ({ label, features: distributions(rows.filter((r) => stageForTime(f.stages, r.timestamp)?.expected === label), keys) })),
      groups, anchorTraces, lossEpisodes, groupAnchors,
      segmentStability: subset((k) => /Ratio|Length/.test(k) && !k.startsWith('projection.')),
      projectionDisagreement: subset((k) => k.startsWith('projection.') || k.includes('imageVsWorld')),
      overlapDiagnostics: subset((k) => /Pair|Depth/.test(k)), identityContinuity: subset((k) => /Ordering|Assignment|Advantage/.test(k)),
      worldInformationGain: groups.map((g) => ({ group: g.group, sideFrameCount: g.sideFrameCount, distributions: g.candidateAligned })),
    };
  });
  return { version: 1, step: '4N', analysisStatus: GEOMETRY_STATUS, assessment: 'DIAGNOSTIC_ONLY' as const,
    warning: 'World is a recorded pose estimate, not absolute ground truth. Suspect labels and assignment advantage do not establish projection failure or identity swap. No automatic BEST or production gate.',
    settings: { visibility: { hip: .7, knee: .5, ankle: .5, shoulder: .5 }, worldEligibility: 'Image joint eligibility plus finite world XYZ and optional world visibility (same joint threshold); absent world visibility is allowed, absent world coordinates are not.',
      imageUnits: 'normalized XY (z ignored)', worldUnits: 'recorded MediaPipe XYZ, diagnostic only', numericEpsilon: AXIS_EPSILON,
      baseline: 'latest successful/frozen before Guided; last <=1000ms bounded Neutral. OLD CLEAN-only first-Neutral compatibility excluded. Frozen positive segment medians, component medians, bodyScale and worldLegScale.',
      orientation: 'HL->HR eLat; Gram-Schmidt shoulderCenter-hipCenter eLong; eDepth=cross(eLat,eLong). Deterministic right-handed, no temporal sign correction and no front/back semantics.',
      continuity: 'adjacent recorded frames only; missing or dt<=0 or dt>=400ms yields null, shortest image axis delta. No stale bridging.',
      ordering: 'dot(RK-LK, pelvis lateral); neutral sign inversion/positive swapAdvantage is not proof of identity swap. Assignment uses hip-center-relative points and fixed scales.',
      grouping: 'Union windows avoids duplicate frames within a group. Different groups can overlap and are not independent classes. Information-gain uses unique anchor-side/timestamp pairs; normal non-kick excludes event/loss windows. Loss groups span entire loss episode plus750ms; STRESS additionally exports onset±750ms traces.',
      markers: 'Not executed during inspection. Later compare declared coarse cuts; partial unknown observations never become anomaly0.',
    }, inputs: fixtures.map((f) => f.input), geometryReliabilityEvidence: { perFixture }, references: legacy.references };
}
export type GeometryEvidence = ReturnType<typeof createGeometryEvidence>;
function assertSame(fixtures: readonly GeometryFixture[], evidence: GeometryEvidence) {
  if (JSON.stringify(fixtures.map((f) => f.input)) !== JSON.stringify(evidence.inputs)) throw new Error('Inspect the same assigned geometry fixtures before comparison');
}
export function compareReliabilityMarkers(fixtures: readonly GeometryFixture[], evidence: GeometryEvidence) {
  assertSame(fixtures, evidence);
  const summarize = (pairs: { row: GeometryFrame; side: Limb }[]) => reliabilityMarkers().map((marker) => {
    const observations = pairs.map(({ row, side }) => markerDecision(row, side, marker));
    const available = observations.filter((o) => o.decision !== null), positive = available.filter((o) => o.decision);
    return { id: markerId(marker), ...marker, frames: observations.length, usable: available.length, coverage: observations.length ? available.length / observations.length : null,
      marked: positive.length, markedFraction: available.length ? positive.length / available.length : null };
  });
  const perFixture = fixtures.map((f, i) => {
    const rows = f.frames.filter(evaluated), e = evidence.geometryReliabilityEvidence.perFixture[i];
    const pairs = rows.flatMap((row) => LIMBS.map((side) => ({ row, side })));
    return { input: f.input, perLabel: ['NEUTRAL', 'TWIST_LEFT', 'TWIST_RIGHT', 'KNEE_LEFT', 'KNEE_RIGHT'].map((label) => ({ label,
      markers: summarize(pairs.filter(({ row }) => stageForTime(f.stages, row.timestamp)?.expected === label)) })),
      groups: GEOMETRY_GROUPS.map((group) => ({ group, markers: summarize(groupRows(f, e.groupAnchors, group).sideRows) })),
      categoryProfiles: RELIABILITY_CUTS.segment.map((_, profile) => ({ profile, rows: pairs.map(({ row, side }) => ({ timestamp: row.timestamp, side,
        expected: stageForTime(f.stages, row.timestamp)?.expected, labels: descriptiveCategories(row, side, profile).labels })) })),
      // These frames already meet current image joint visibility; missing world/baselines remain in the denominator.
      visibilityGeometryMismatch: LIMBS.map((side) => {
        const limb = side === 'LEFT' ? 'left' : 'right', eligible = rows.filter((r) => r.values[`${limb}HipVisibility`] !== null && r.values[`${limb}HipVisibility`]! >= .7 && r.values[`${limb}KneeVisibility`] !== null && r.values[`${limb}KneeVisibility`]! >= .5);
        return { side, visibleHipKneeFrames: eligible.length, kneeVisibility: distribution(eligible.map((r) => r.values[`${limb}KneeVisibility`])), markers: summarize(eligible.map((row) => ({ row, side }))),
          hipKneeRatios: { image: distribution(eligible.map((r) => r.values[`image.${limb}HipKneeRatio`])), world: distribution(eligible.map((r) => r.values[`world.${limb}HipKneeRatio`])) } };
      }),
      worldInformationGainCuts: GEOMETRY_GROUPS.map((group) => {
        const selected = groupRows(f, e.groupAnchors, group).sideRows;
        return { group, cuts: INFORMATION_FEATURES.map((feature) => ({ feature, interpretation: 'absolute normalized value; descriptive cut only, no temporal detector',
          thresholds: RELIABILITY_CUTS.worldMotion.map((threshold) => { const values = selected.map(({ row, side }) => row.values[`${side}.${feature}`]).filter((v): v is number => v !== null);
            return { threshold, usable: values.length, above: values.filter((v) => Math.abs(v) >= threshold).length, fraction: values.length ? values.filter((v) => Math.abs(v) >= threshold).length / values.length : null }; }) })) };
      }),
    };
  });
  return { analysisStatus: GEOMETRY_STATUS, assessment: 'DIAGNOSTIC_ONLY' as const, cuts: RELIABILITY_CUTS, perFixture,
    interpretation: 'Segment marker = same-side hip-knee OR knee-ankle. Projection likewise. Identity = image OR world swapAdvantage > cut. Axis = numeric degeneracy OR abs(pelvis/torso image axis velocity)>=cut. Unknown OR false stays unknown; any known true remains suspect.' };
}
export type GeometryMarkerReport = ReturnType<typeof compareReliabilityMarkers>;
export function analyzeQualityGate(fixtures: readonly GeometryFixture[], evidence: GeometryEvidence, markers: GeometryMarkerReport, config: QualityGateConfig) {
  assertSame(fixtures, evidence);
  if (JSON.stringify(markers.perFixture.map((f) => f.input)) !== JSON.stringify(evidence.inputs)) throw new Error('Compare reliability markers before the thought experiment');
  if (!qualityGateConfigs().some((c) => JSON.stringify(c) === JSON.stringify(config))) throw new Error('Unknown bounded quality-gate configuration');
  const complete = BODY_ROLES.slice(1).every((role) => fixtures.some((f) => f.input.role === role)) && fixtures.every((f) => f.input.role !== 'UNASSIGNED');
  const perFixture = fixtures.map((f, i) => {
    const guard = new GeometryEntryGuard(new Map(f.frames.map((r) => [r.timestamp, r])), config), reference = evidence.references[i].fixedFlexionIntegrity12;
    const result = runIntegrityFixture(f.reference, PRE_REGISTERED_INTEGRITY_CONFIG, 'FIXED_Y_OR_FLEXION', false, guard.evaluate);
    const changes = result.stageOutcomes.map((s) => {
      const before = reference.stageOutcomes.find((r) => r.stageIndex === s.stageIndex)!;
      return { stageIndex: s.stageIndex, expected: s.expected, falseRemoved: Math.max(0, before.falseEvents - s.falseEvents), falseAdded: Math.max(0, s.falseEvents - before.falseEvents),
        truePreserved: Math.min(before.correct, s.correct), trueLost: Math.max(0, before.correct - s.correct) };
    });
    const sum = (key: 'falseRemoved' | 'falseAdded' | 'truePreserved' | 'trueLost') => changes.reduce((n, c) => n + c[key], 0);
    const stress = f.input.role === 'STRESS', knees = result.stageOutcomes.filter((s) => s.expected.startsWith('KNEE_'));
    const checks = { trueEventsPreserved: sum('trueLost') === 0,
      completeReferenceKicks: stress || ['KNEE_LEFT', 'KNEE_RIGHT'].every((label) => knees.some((s) => s.expected === label && s.frameCount > 0 && s.correct === 1 && s.eventCount === 1)),
      noFalse: stress ? result.observableFalseEvents <= reference.observableFalseEvents : result.falseEvents === 0,
      noHardGap: result.crossGap === 0, noSoftGap: result.softGapCross === 0, noWrong: result.wrong === 0, noDuplicate: result.duplicates === 0 };
    const observations = guard.observations;
    return { input: f.input, result, changes, falseRemoved: sum('falseRemoved'), falseAdded: sum('falseAdded'), truePreserved: sum('truePreserved'), trueLost: sum('trueLost'),
      trueEventTiming: result.events.filter((event) => !event.falseEvent && !event.wrong).map((event) => {
        const before = reference.events.find((r) => r.stageIndex === event.stageIndex && r.direction === event.direction && !r.falseEvent && !r.wrong);
        return { side: event.side, stageIndex: event.stageIndex, candidateStart: event.candidateStartedAt, confirm: event.timestamp,
          baselineCandidateStart: before?.candidateStartedAt ?? null, baselineConfirm: before?.timestamp ?? null,
          confirmShiftMs: before ? event.timestamp - before.timestamp : null };
      }),
      attemptedEntries: observations.length, unknownEntries: observations.filter((o) => o.decision === null).length, blockedEntryFrames: observations.filter((o) => o.decision).length,
      activations: observations.filter((o) => o.activation).length, entryObservations: observations, checks, accepted: Object.values(checks).every(Boolean) };
  });
  return { config, analysisStatus: GEOMETRY_STATUS, perFixture,
    assessment: !complete ? 'INSUFFICIENT_EVIDENCE' as const : perFixture.every((f) => f.accepted) ? 'EXPLORATORY_QUALITY_VIABLE' as const : 'REJECTED' as const };
}
export type QualityGateResult = ReturnType<typeof analyzeQualityGate>;
export function createGeometryReport(evidence: GeometryEvidence, reliabilityMarkers: GeometryMarkerReport | null, qualityGateExperiments: QualityGateResult[] = [], createdAt = new Date().toISOString()) {
  return { ...evidence, createdAt, reliabilityMarkers, qualityGateExperiments,
    experimentSemantics: 'Fixed Y+flexion+integrity12 baseline. Only eligible current-frame entry; no continuing channel run cancellation, no held veto or changed recovery. Null is unavailable, not anomaly0. Rejected entries may retry. All deltas compare per stage with unchanged full candidate; LIVE2 false already removed by integrity12 is not credited to a quality gate.',
    exploratoryQualityViableConfigs: qualityGateExperiments.filter((r) => r.assessment === 'EXPLORATORY_QUALITY_VIABLE').map((r) => r.config.id) };
}
export type GeometryReport = ReturnType<typeof createGeometryReport>;
export function geometryTracesCsv(evidence: GeometryEvidence) {
  const rows = evidence.geometryReliabilityEvidence.perFixture.flatMap((f) => f.anchorTraces.flatMap((a) => a.rows.map((r) => ({ analysisStatus: GEOMETRY_STATUS, trialId: f.input.trialId,
    anchorKind: a.kind, anchorMode: a.mode, anchorAt: a.candidateStart, confirmAt: a.kickConfirm, ...r }))));
  if (!rows.length) return 'analysisStatus,fixture,timestamp';
  const keys = Object.keys(rows[0]) as (keyof typeof rows[number])[];
  const quote = (v: unknown) => `"${(v === null || v === undefined ? '' : typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : String(v)).replaceAll('"', '""')}"`;
  return [keys.join(','), ...rows.map((r) => keys.map((k) => quote(r[k])).join(','))].join('\r\n');
}
