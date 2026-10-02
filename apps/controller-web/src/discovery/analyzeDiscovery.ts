import { orderedFrames } from '../replay/landmarkReplay';
import type { ReplaySession } from '../replay/replayTypes';
import { buildNeutralReference, discoveryFeatures, DISCOVERY_FEATURES, DISCOVERY_SETTINGS, FEATURE_IDS, median, recordedVelocity,
  type FeatureId, type FeatureValues, type NeutralReference, type Side } from './discoveryFeatures';
import { discoveryStages, stageForTime, type DiscoveryLabel, type DiscoveryStage } from './discoveryStages';

export interface DiscoveryInput { filename: string; captureId: string; trialId: number }
export interface StageFeatureSummary {
  stageIndex: number; expected: DiscoveryLabel; feature: FeatureId; side: Side;
  frameCount: number; usableFrameCount: number; coverage: number | null;
  median: number | null; p90: number | null; p95: number | null; max: number | null; peak: number | null;
  peakAbsVelocity: number | null; velocitySampleCount: number;
}
export interface DirectionObservation {
  input: DiscoveryInput; stageIndex: number; expected: 'KNEE_LEFT' | 'KNEE_RIGHT';
  leftPeak: number | null; rightPeak: number | null; correctSideMargin: number | null;
}
export interface FeatureSummary {
  feature: FeatureId;
  overallCoverage: number | null; neutralCoverage: number | null; twistCoverage: number | null;
  kneeLeftCoverage: number | null; kneeRightCoverage: number | null; lowCoverage: boolean;
  nonKickP95: number | null; nonKickMax: number | null; kneeLeftPeak: number | null; kneeRightPeak: number | null;
  minKickPeak: number | null; sampleSeparationMargin: number | null; robustSeparationMargin: number | null;
  directionLeftMargin: number | null; directionRightMargin: number | null;
  directionConsistentAcrossObservedKicks: boolean | null; directions: DirectionObservation[];
}
export interface DatasetSummary {
  input: DiscoveryInput; stageSource: string; stages: DiscoveryStage[]; warnings: string[];
  bodyScale: number; neutralStageIndex: number | null; neutralReference: NeutralReference;
  frameCount: number; unattributedFrameCount: number;
  stageSummaries: StageFeatureSummary[]; features: FeatureSummary[];
}
export interface FeatureDiscoveryReport {
  version: 1; createdAt: string; inputs: DiscoveryInput[];
  features: { definitions: typeof DISCOVERY_FEATURES; settings: typeof DISCOVERY_SETTINGS };
  perDataset: DatasetSummary[]; aggregate: FeatureSummary[];
}
interface Bucket {
  stage: DiscoveryStage; feature: FeatureId; side: Side; frameCount: number;
  values: number[]; peakAbsVelocity: number | null; velocitySampleCount: number;
}
// Transient scalar samples needed for exact pooled percentiles. Never placed in React state/export.
export interface DiscoveryAnalysis { summary: DatasetSummary; buckets: Bucket[] }
const ratio = (count: number, total: number) => total ? count / total : null;
const peak = (values: readonly number[]): number | null => values.length ? values.reduce((max, v) => Math.max(max, Math.abs(v)), 0) : null;
const difference = (a: number | null, b: number | null) => a === null || b === null ? null : a - b;
const percentile = (sorted: readonly number[], fraction: number) => sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1] : null;
const isKick = (label: DiscoveryLabel) => label === 'KNEE_LEFT' || label === 'KNEE_RIGHT';

function stageSummary(bucket: Bucket): StageFeatureSummary {
  const sorted = [...bucket.values].sort((a, b) => a - b);
  return { stageIndex: bucket.stage.stageIndex, expected: bucket.stage.expected, feature: bucket.feature, side: bucket.side,
    frameCount: bucket.frameCount, usableFrameCount: sorted.length, coverage: ratio(sorted.length, bucket.frameCount),
    median: median(sorted), p90: percentile(sorted, 0.9), p95: percentile(sorted, 0.95), max: sorted.at(-1) ?? null,
    peak: peak(sorted), peakAbsVelocity: bucket.peakAbsVelocity, velocitySampleCount: bucket.velocitySampleCount };
}

function summarizeFeature(feature: FeatureId, datasets: readonly DiscoveryAnalysis[]): FeatureSummary {
  const definition = DISCOVERY_FEATURES[feature];
  const buckets = datasets.flatMap((dataset) => dataset.buckets.filter((bucket) => bucket.feature === feature));
  const coverage = (accept: (label: DiscoveryLabel) => boolean) => {
    const selected = buckets.filter((b) => accept(b.stage.expected));
    return ratio(selected.reduce((n, b) => n + b.values.length, 0), selected.reduce((n, b) => n + b.frameCount, 0));
  };
  const overallCoverage = coverage(() => true), neutralCoverage = coverage((s) => s === 'NEUTRAL');
  const twistCoverage = coverage((s) => s === 'TWIST_LEFT' || s === 'TWIST_RIGHT');
  const kneeLeftCoverage = coverage((s) => s === 'KNEE_LEFT'), kneeRightCoverage = coverage((s) => s === 'KNEE_RIGHT');
  const nonKick = definition.evidence ? buckets.filter((b) => !isKick(b.stage.expected)).flatMap((b) => b.values.map(Math.abs)).sort((a, b) => a - b) : [];
  const kickPeak = (label: DiscoveryLabel, side: Side) => definition.evidence ? peak(buckets
    .filter((b) => b.stage.expected === label && (b.side === side || b.side === 'GLOBAL')).flatMap((b) => b.values)) : null;
  const kneeLeftPeak = kickPeak('KNEE_LEFT', 'LEFT'), kneeRightPeak = kickPeak('KNEE_RIGHT', 'RIGHT');
  const minKickPeak = kneeLeftPeak === null || kneeRightPeak === null ? null : Math.min(kneeLeftPeak, kneeRightPeak);
  const nonKickP95 = percentile(nonKick, 0.95), nonKickMax = nonKick.at(-1) ?? null;
  const directions: DirectionObservation[] = [];
  if (definition.evidence && definition.sides.length === 2) for (const dataset of datasets) {
    for (const stage of dataset.summary.stages) {
      if (stage.expected !== 'KNEE_LEFT' && stage.expected !== 'KNEE_RIGHT') continue;
      const values = (side: Side) => dataset.buckets.find((b) => b.feature === feature && b.stage.stageIndex === stage.stageIndex && b.side === side)?.values ?? [];
      const leftPeak = peak(values('LEFT')), rightPeak = peak(values('RIGHT'));
      directions.push({ input: dataset.summary.input, stageIndex: stage.stageIndex, expected: stage.expected, leftPeak, rightPeak,
        correctSideMargin: stage.expected === 'KNEE_LEFT' ? difference(leftPeak, rightPeak) : difference(rightPeak, leftPeak) });
    }
  }
  const margin = (label: DiscoveryLabel) => {
    const observations = directions.filter((o) => o.expected === label);
    return observations.length && observations.every((o) => o.correctSideMargin !== null)
      ? Math.min(...observations.map((o) => o.correctSideMargin!)) : null;
  };
  const directionLeftMargin = margin('KNEE_LEFT'), directionRightMargin = margin('KNEE_RIGHT');
  const directionConsistentAcrossObservedKicks = directions.some((o) => o.correctSideMargin !== null && o.correctSideMargin <= 0) ? false
    : directionLeftMargin !== null && directionRightMargin !== null ? true : null;
  return { feature, overallCoverage, neutralCoverage, twistCoverage, kneeLeftCoverage, kneeRightCoverage,
    lowCoverage: [overallCoverage, neutralCoverage, twistCoverage, kneeLeftCoverage, kneeRightCoverage].some((c) => c === null || c < DISCOVERY_SETTINGS.lowCoverageBelow),
    nonKickP95, nonKickMax, kneeLeftPeak, kneeRightPeak, minKickPeak,
    sampleSeparationMargin: difference(minKickPeak, nonKickMax), robustSeparationMargin: difference(minKickPeak, nonKickP95),
    directionLeftMargin, directionRightMargin, directionConsistentAcrossObservedKicks, directions };
}

/** Read-only offline analysis. No model, clock, smoothing, live state or detector event is used. */
export function analyzeDiscovery(session: ReplaySession, filename: string): DiscoveryAnalysis[] {
  if (!session.liveResult.trials.length) throw new Error('Guided trial이 없는 Replay Capture입니다.');
  const ids = session.liveResult.trials.map((t) => t.id);
  if (new Set(ids).size !== ids.length) throw new Error('중복 trial ID가 있는 Replay Capture입니다.');
  const ordered = orderedFrames(session.poseFrames); // shallow reference sort, not landmark copies
  return session.liveResult.trials.map((trial) => {
    const mapped = discoveryStages(session, trial);
    const firstNeutral = mapped.stages.find((stage) => stage.expected === 'NEUTRAL');
    const neutral = buildNeutralReference(firstNeutral ? ordered.filter((f) => f.tMs >= firstNeutral.startMs && f.tMs < firstNeutral.endMs) : []);
    const warnings = [...mapped.warnings];
    if (!neutral.frameCount) warnings.push('첫 NEUTRAL frame이 없습니다. 새 candidate의 neutral delta는 null입니다.');
    if (neutral.usableCounts.LEFT.dx === 0 || neutral.usableCounts.RIGHT.dx === 0) warnings.push('첫 NEUTRAL의 일부 limb reference가 없습니다. 해당 feature는 null입니다.');
    const buckets: Bucket[] = mapped.stages.flatMap((stage) => FEATURE_IDS.flatMap((feature) => DISCOVERY_FEATURES[feature].sides.map((side) =>
      ({ stage, feature, side, frameCount: 0, values: [], peakAbsVelocity: null, velocitySampleCount: 0 }))));
    const byStage = mapped.stages.map((s) => buckets.filter((b) => b.stage.stageIndex === s.stageIndex));
    let previous: { tMs: number; stageIndex: number; values: FeatureValues } | null = null;
    let frameCount = 0, unattributedFrameCount = 0;
    for (const frame of ordered) {
      if (frame.tMs < trial.startMs || frame.tMs >= (trial.endMs ?? session.timing.durationMs)) continue;
      const stage = stageForTime(mapped.stages, frame.tMs);
      if (!stage) { unattributedFrameCount++; previous = null; continue; }
      frameCount++;
      const values = discoveryFeatures(frame, neutral, trial.baseline);
      for (const bucket of byStage[stage.stageIndex]) {
        bucket.frameCount++;
        const value = values[bucket.feature][bucket.side] ?? null;
        if (value !== null) bucket.values.push(value);
        if (DISCOVERY_FEATURES[bucket.feature].velocity) {
          const before = previous?.stageIndex === stage.stageIndex ? { value: previous.values[bucket.feature][bucket.side] ?? null, tMs: previous.tMs } : null;
          const velocity = recordedVelocity(value, frame.tMs, before);
          if (velocity !== null) {
            bucket.velocitySampleCount++;
            bucket.peakAbsVelocity = Math.max(bucket.peakAbsVelocity ?? 0, Math.abs(velocity));
          }
        }
      }
      previous = { tMs: frame.tMs, stageIndex: stage.stageIndex, values };
    }
    const summary: DatasetSummary = { input: { filename, captureId: session.captureId, trialId: trial.id },
      stageSource: mapped.source, stages: mapped.stages, warnings, bodyScale: trial.baseline.bodyScale,
      neutralStageIndex: firstNeutral?.stageIndex ?? null, neutralReference: neutral, frameCount, unattributedFrameCount,
      stageSummaries: buckets.map(stageSummary), features: [] };
    const result = { summary, buckets };
    summary.features = FEATURE_IDS.map((id) => summarizeFeature(id, [result]));
    return result;
  });
}

export function createDiscoveryReport(datasets: readonly DiscoveryAnalysis[], createdAt = new Date().toISOString()): FeatureDiscoveryReport {
  return { version: 1, createdAt, inputs: datasets.map((d) => d.summary.input),
    features: { definitions: DISCOVERY_FEATURES, settings: DISCOVERY_SETTINGS }, perDataset: datasets.map((d) => d.summary),
    aggregate: FEATURE_IDS.map((id) => summarizeFeature(id, datasets)) };
}
