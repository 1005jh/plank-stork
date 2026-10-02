import { DISCOVERY_SETTINGS, median, recordedVelocity, type Limb } from './discoveryFeatures';

export const TEMPORAL_SETTINGS = {
  thresholds: [0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60],
  dwellMs: [0, 50, 80, 100, 150, 200, 300], confirmation2D: [0.30, 0.40, 0.50],
  trimMs: 200, continuityGapMs: 400, observableCoverage: 0.8,
  evidence: 'abs(deltaDyNorm), limb identity, never sign-based direction',
  duration: 'last observed above frame minus first; no extrapolation; missing/below/stage edge/dt >= 400ms break continuity',
  crossing: 'rising run entries; first/lastCrossingMs are capture-relative entry timestamps',
  integration: 'trapezoidal max(0, abs(Y)-threshold) over paired-usable candidate windows; seconds; no missing/gap bridging',
  confirmation: 'at a Y dwell trigger-eligible observed frame, same-limb 2D >= confirmation threshold; no separate 2D dwell',
  observable: 'coverage >= 0.8 and no usable gap >= 400ms; zero/missing evidence is not a false negative',
} as const;
export type TemporalRole = 'CLEAN' | 'STRESS' | 'UNASSIGNED';
export type WindowMode = 'FULL' | 'TRIMMED';
export interface TemporalPoint {
  timestamp: number; deltaDyNorm: number | null; absY: number | null;
  displacement2D: number | null; normalizedX: number | null; usable: boolean;
  visibility: { leftHip: number | null; rightHip: number | null; knee: number | null };
}
export interface EvidencePair { timestamp: number; LEFT: TemporalPoint; RIGHT: TemporalPoint }
export interface UsableGap { startMs: number; endMs: number; durationMs: number; reason: 'MISSING' | 'TIMESTAMP_GAP' | 'WINDOW_EDGE' }
export interface TemporalDwell {
  dwellMs: number; confirmation2D: number | null; triggered: boolean | null; observedTrigger: boolean;
  triggerTime: number | null; maxContiguousDurationMs: number;
}
export interface ThresholdSummary {
  threshold: number; framesAbove: number; fractionAbove: number | null;
  longestContiguousRunFrames: number; longestContiguousRunMs: number;
  firstCrossingMs: number | null; lastCrossingMs: number | null; lastAboveMs: number | null; crossingCount: number;
  dwellResults: TemporalDwell[];
}
export interface ScalarSummary { usableFrameCount: number; peak: number | null; p95: number | null }
export interface TemporalSideSummary {
  frameCount: number; usableFrameCount: number; coverage: number | null; observableStage: boolean;
  usableGaps: UsableGap[]; maxUsableGapMs: number;
  peak: number | null; p95: number | null;
  features: { deltaDyNorm: ScalarSummary; hipCenterRelative2DDisplacement: ScalarSummary; normalizedXDisplacement: ScalarSummary };
  velocitySampleCount: number; peakAbsVelocity: number | null; p95AbsVelocity: number | null;
  visibility: { kneeMedian: number | null; minHipMedian: number | null };
  thresholds: ThresholdSummary[];
}
export interface DirectionWindow {
  threshold: number; startMs: number; endMs: number; durationMs: number; frames: number;
  leftPeak: number; rightPeak: number; leftIntegratedEvidence: number; rightIntegratedEvidence: number;
  direction: Limb | 'AMBIGUOUS'; correctSideMargin: number | null;
}
const finite = (v: number | null): v is number => v !== null && Number.isFinite(v);
export function scalarSummary(values: readonly (number | null)[]): ScalarSummary {
  const sorted = values.filter(finite).map(Math.abs).sort((a, b) => a - b);
  return { usableFrameCount: sorted.length, peak: sorted.at(-1) ?? null, p95: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null };
}
export function trimSeries<T extends { timestamp: number }>(series: readonly T[], startMs: number, endMs: number): T[] {
  return series.filter((point) => point.timestamp >= startMs && point.timestamp < endMs);
}

function usableGaps(points: readonly TemporalPoint[], startMs: number, endMs: number): UsableGap[] {
  const gaps: UsableGap[] = [];
  let lastValid: number | null = null, missing = false;
  const add = (start: number, end: number, reason: UsableGap['reason']) => {
    if (end > start) gaps.push({ startMs: start, endMs: end, durationMs: end - start, reason });
  };
  for (const point of points) {
    if (!point.usable) { missing = true; continue; }
    const from = lastValid ?? startMs, dt = point.timestamp - from;
    if (missing || dt >= TEMPORAL_SETTINGS.continuityGapMs) add(from, point.timestamp, missing ? 'MISSING' : lastValid === null ? 'WINDOW_EDGE' : 'TIMESTAMP_GAP');
    lastValid = point.timestamp; missing = false;
  }
  if (lastValid === null || missing || endMs - lastValid >= TEMPORAL_SETTINGS.continuityGapMs) {
    add(lastValid ?? startMs, endMs, missing ? 'MISSING' : 'WINDOW_EDGE');
  }
  return gaps;
}

export function summarizeTemporalSide(points: readonly TemporalPoint[], startMs: number, endMs: number): TemporalSideSummary {
  const usable = points.filter((p) => p.usable), coverage = points.length ? usable.length / points.length : null;
  const gaps = usableGaps(points, startMs, endMs), maxUsableGapMs = gaps.reduce((max, gap) => Math.max(max, gap.durationMs), 0);
  const observableStage = coverage !== null && coverage >= TEMPORAL_SETTINGS.observableCoverage && maxUsableGapMs < TEMPORAL_SETTINGS.continuityGapMs;
  const velocities = points.map((p, index) => recordedVelocity(p.usable ? p.deltaDyNorm : null, p.timestamp, index > 0 ?
    { value: points[index - 1].usable ? points[index - 1].deltaDyNorm : null, tMs: points[index - 1].timestamp } : null));
  const velocity = scalarSummary(velocities), y = scalarSummary(usable.map((p) => p.absY));
  const thresholds = TEMPORAL_SETTINGS.thresholds.map((threshold): ThresholdSummary => {
    const runs: TemporalPoint[][] = [];
    let run: TemporalPoint[] | null = null, previous: TemporalPoint | null = null;
    for (const point of points) {
      const dt = previous ? point.timestamp - previous.timestamp : 0;
      if (!point.usable || point.absY === null || point.absY < threshold) run = null;
      else {
        if (!run || dt <= 0 || dt >= TEMPORAL_SETTINGS.continuityGapMs) { run = []; runs.push(run); }
        run.push(point);
      }
      previous = point;
    }
    const framesAbove = runs.reduce((n, r) => n + r.length, 0);
    const maxDuration = runs.reduce((max, r) => Math.max(max, r.at(-1)!.timestamp - r[0].timestamp), 0);
    const dwellResults = TEMPORAL_SETTINGS.dwellMs.flatMap((dwellMs) => [null, ...TEMPORAL_SETTINGS.confirmation2D].map((confirmation2D): TemporalDwell => {
      let triggerTime: number | null = null;
      for (const r of runs) {
        const trigger = r.find((p) => p.timestamp - r[0].timestamp >= dwellMs &&
          (confirmation2D === null || (p.displacement2D !== null && p.displacement2D >= confirmation2D)));
        if (trigger) { triggerTime = trigger.timestamp; break; }
      }
      const observedTrigger = triggerTime !== null;
      return { dwellMs, confirmation2D, observedTrigger, triggered: observedTrigger ? true : observableStage ? false : null,
        triggerTime, maxContiguousDurationMs: maxDuration };
    }));
    return { threshold, framesAbove, fractionAbove: usable.length ? framesAbove / usable.length : null,
      longestContiguousRunFrames: runs.reduce((max, r) => Math.max(max, r.length), 0), longestContiguousRunMs: maxDuration,
      firstCrossingMs: runs[0]?.[0].timestamp ?? null, lastCrossingMs: runs.at(-1)?.[0].timestamp ?? null,
      lastAboveMs: runs.at(-1)?.at(-1)?.timestamp ?? null, crossingCount: runs.length, dwellResults };
  });
  return { frameCount: points.length, usableFrameCount: usable.length, coverage, observableStage, usableGaps: gaps, maxUsableGapMs,
    peak: y.peak, p95: y.p95, features: { deltaDyNorm: y, hipCenterRelative2DDisplacement: scalarSummary(points.map((p) => p.displacement2D)),
      normalizedXDisplacement: scalarSummary(points.map((p) => p.normalizedX)) },
    velocitySampleCount: velocity.usableFrameCount, peakAbsVelocity: velocity.peak, p95AbsVelocity: velocity.p95,
    visibility: { kneeMedian: median(points.map((p) => p.visibility.knee).filter(finite)),
      minHipMedian: median(points.map((p) => p.visibility.leftHip === null || p.visibility.rightHip === null ? null : Math.min(p.visibility.leftHip, p.visibility.rightHip)).filter(finite)) }, thresholds };
}

/** Comparable limb windows require BOTH sides usable. Missing frames/gaps never carry earlier evidence forward. */
export function directionWindows(points: readonly EvidencePair[], expected: string): DirectionWindow[] {
  return TEMPORAL_SETTINGS.thresholds.flatMap((threshold) => {
    const runs: EvidencePair[][] = [];
    let run: EvidencePair[] | null = null, previous: EvidencePair | null = null;
    for (const point of points) {
      const dt = previous ? point.timestamp - previous.timestamp : 0;
      const active = point.LEFT.usable && point.RIGHT.usable && Math.max(point.LEFT.absY!, point.RIGHT.absY!) >= threshold;
      if (!active) run = null;
      else {
        if (!run || dt <= 0 || dt >= TEMPORAL_SETTINGS.continuityGapMs) { run = []; runs.push(run); }
        run.push(point);
      }
      previous = point;
    }
    return runs.map((r): DirectionWindow => {
      const integrated = (side: Limb) => r.reduce((area, p, index) => index === 0 ? area : area +
        (Math.max(0, r[index - 1][side].absY! - threshold) + Math.max(0, p[side].absY! - threshold)) / 2 * (p.timestamp - r[index - 1].timestamp) / 1000, 0);
      const leftIntegratedEvidence = integrated('LEFT'), rightIntegratedEvidence = integrated('RIGHT');
      const margin = leftIntegratedEvidence - rightIntegratedEvidence;
      return { threshold, startMs: r[0].timestamp, endMs: r.at(-1)!.timestamp, durationMs: r.at(-1)!.timestamp - r[0].timestamp, frames: r.length,
        leftPeak: Math.max(...r.map((p) => p.LEFT.absY!)), rightPeak: Math.max(...r.map((p) => p.RIGHT.absY!)),
        leftIntegratedEvidence, rightIntegratedEvidence,
        direction: Math.abs(margin) <= DISCOVERY_SETTINGS.geometryEpsilon ? 'AMBIGUOUS' : margin > 0 ? 'LEFT' : 'RIGHT',
        correctSideMargin: expected === 'KNEE_LEFT' ? margin : expected === 'KNEE_RIGHT' ? -margin : null };
    });
  });
}
