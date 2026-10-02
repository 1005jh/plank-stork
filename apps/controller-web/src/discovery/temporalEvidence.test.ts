import { describe, expect, it } from 'vitest';
import { directionWindows, summarizeTemporalSide, trimSeries, type EvidencePair, type TemporalPoint } from './temporalEvidence';

const point = (timestamp: number, y: number | null, displacement2D = y === null ? null : Math.abs(y)): TemporalPoint =>
  ({ timestamp, deltaDyNorm: y, absY: y === null ? null : Math.abs(y), displacement2D, normalizedX: 0, usable: y !== null,
    visibility: { leftHip: 0.99, rightHip: 0.99, knee: y === null ? null : 0.9 } });
const summary = (points: TemporalPoint[], endMs = points.at(-1)!.timestamp + 1) => summarizeTemporalSide(points, 0, endMs);
const threshold = (points: TemporalPoint[], t = 0.3) => summary(points).thresholds.find((r) => r.threshold === t)!;
const dwell = (points: TemporalPoint[], ms: number, confirmation2D: number | null = null) =>
  threshold(points).dwellResults.find((r) => r.dwellMs === ms && r.confirmation2D === confirmation2D)!;

describe('experimental temporal threshold/dwell sweep', () => {
  it('one-frame spike triggers dwell 0 but never invents 100ms persistence', () => {
    const points = [0, 50, 100, 150, 200].map((t) => point(t, t === 100 ? 0.8 : 0));
    expect(dwell(points, 0).triggerTime).toBe(100); expect(dwell(points, 100).triggered).toBe(false);
    expect(threshold(points)).toMatchObject({ framesAbove: 1, fractionAbove: 0.2, longestContiguousRunFrames: 1, longestContiguousRunMs: 0, crossingCount: 1 });
  });
  it('sustained 200ms movement triggers at the first observed dwell-eligible frame', () => {
    const points = [0, 50, 100, 150, 200, 250, 300].map((t) => point(t, t >= 50 && t <= 250 ? 0.5 : 0));
    expect(dwell(points, 100)).toMatchObject({ triggered: true, triggerTime: 150, maxContiguousDurationMs: 200 });
    expect(dwell(points, 200).triggerTime).toBe(250); expect(dwell(points, 300).triggered).toBe(false);
    expect(threshold(points)).toMatchObject({ firstCrossingMs: 50, lastCrossingMs: 50, lastAboveMs: 250 });
  });
  it('repeated crossings reset contiguous duration rather than summing bursts', () => {
    const points = [0.5, 0, 0.5, 0.5, 0, 0.5].map((y, i) => point(i * 40, y));
    expect(threshold(points)).toMatchObject({ crossingCount: 3, longestContiguousRunFrames: 2, longestContiguousRunMs: 40, firstCrossingMs: 0, lastCrossingMs: 200 });
    expect(dwell(points, 50).triggered).toBe(false);
  });
  it('uses variable recorded intervals without assuming 30fps', () => {
    const points = [0, 17, 83, 119, 201].map((t) => point(t, 0.5));
    expect(dwell(points, 100).triggerTime).toBe(119); expect(threshold(points).longestContiguousRunMs).toBe(201);
  });
  it('treats negative Y as magnitude for evidence and signed Y for velocity', () => {
    const points = [point(0, -0.5), point(100, -0.6), point(200, -0.4)];
    expect(dwell(points, 100).triggered).toBe(true); expect(summary(points).peakAbsVelocity).toBeCloseTo(2);
    expect(summary(points).p95AbsVelocity).toBeCloseTo(2);
  });
  it('resets at exactly 400ms for runs, velocity and integration', () => {
    const points = [point(0, 0.4), point(400, 0.6), point(450, 0.65)];
    expect(threshold(points).longestContiguousRunMs).toBe(50); expect(threshold(points).crossingCount).toBe(2);
    expect(dwell(points, 100).observedTrigger).toBe(false); expect(summary(points).observableStage).toBe(false);
    expect(summary(points).velocitySampleCount).toBe(1); expect(summary(points).peakAbsVelocity).toBeCloseTo(1);
    expect(summary(points).usableGaps).toEqual([{ startMs: 0, endMs: 400, durationMs: 400, reason: 'TIMESTAMP_GAP' }]);
  });
  it('resets on missing frame even when reacquisition is within 400ms', () => {
    const points = [point(0, 0.5), point(50, null), point(100, 0.7), point(150, 0.7)];
    expect(dwell(points, 100).observedTrigger).toBe(false); expect(threshold(points).crossingCount).toBe(2);
    expect(summary(points).usableGaps).toEqual([{ startMs: 0, endMs: 100, durationMs: 100, reason: 'MISSING' }]);
    expect(summary(points).velocitySampleCount).toBe(1);
  });
  it('reports absent STRESS evidence as UNKNOWN, not false negative', () => {
    const points = [point(0, null), point(50, null), point(100, null)];
    expect(summary(points)).toMatchObject({ coverage: 0, observableStage: false, peak: null, p95: null, peakAbsVelocity: null });
    expect(dwell(points, 100)).toMatchObject({ triggered: null, observedTrigger: false, triggerTime: null });
  });
  it('requires 2D confirmation at an eligible Y dwell frame and keeps all combinations', () => {
    const points = [point(0, 0.4, 0.4), point(50, 0.4, 0.4), point(100, 0.4, 0.4), point(150, 0.4, 0.6)];
    expect(dwell(points, 100).triggerTime).toBe(100); expect(dwell(points, 100, 0.5).triggerTime).toBe(150);
    expect(threshold(points).dwellResults).toHaveLength(28); expect(summary(points).thresholds).toHaveLength(7);
  });
  it('trims exactly [start+200, end-200) and preserves FULL independently', () => {
    const points = [0, 199.999, 200, 200.001, 799.999, 800, 999].map((t) => point(t, 0.5));
    expect(trimSeries(points, 200, 800).map((p) => p.timestamp)).toEqual([200, 200.001, 799.999]);
    expect(trimSeries(points, 0, 1000)).toHaveLength(7);
  });
  it('does not use nonpositive dt for velocity or dwell continuity', () => {
    const points = [point(50, 0.4), point(50, 0.8), point(40, 0.8)];
    expect(summary(points).velocitySampleCount).toBe(0); expect(threshold(points).longestContiguousRunMs).toBe(0);
  });
});

describe('candidate-window integrated limb evidence', () => {
  const pairs = (left: number, right: number): EvidencePair[] => [0, 50, 100, 150, 200].map((t) =>
    ({ timestamp: t, LEFT: point(t, left), RIGHT: point(t, right) }));
  it.each(['LEFT', 'RIGHT'] as const)('identifies %s limb by integrated evidence regardless of Y sign', (side) => {
    const result = directionWindows(pairs(side === 'LEFT' ? -0.5 : 0.1, side === 'RIGHT' ? -0.5 : 0.1), `KNEE_${side}`).find((d) => d.threshold === 0.25)!;
    expect(result.direction).toBe(side); expect(result.correctSideMargin).toBeCloseTo(0.05);
    expect(side === 'LEFT' ? result.leftIntegratedEvidence : result.rightIntegratedEvidence).toBeCloseTo(0.05);
  });
  it('equal limbs and one-frame zero area stay ambiguous', () => {
    expect(directionWindows(pairs(0.5, 0.5), 'KNEE_LEFT').every((d) => d.direction === 'AMBIGUOUS')).toBe(true);
    const spike = directionWindows(pairs(0.5, 0.1).slice(0, 1), 'KNEE_LEFT')[0];
    expect(spike.direction).toBe('AMBIGUOUS'); expect(spike.leftIntegratedEvidence).toBe(0);
  });
  it('integrates with actual irregular time and never joins missing or gap-separated windows', () => {
    const samples = [0, 30, 130, 530, 560].map((t) => ({ timestamp: t, LEFT: point(t, 0.5), RIGHT: point(t, 0.1) }));
    const windows = directionWindows(samples, 'KNEE_LEFT').filter((d) => d.threshold === 0.3);
    expect(windows).toHaveLength(2); expect(windows[0].leftIntegratedEvidence).toBeCloseTo(0.2 * 0.13);
    samples[1].RIGHT = point(30, null);
    const missing = directionWindows(samples, 'KNEE_LEFT').filter((d) => d.threshold === 0.3);
    expect(missing).toHaveLength(3); expect(missing[0].durationMs).toBe(0);
  });
});
