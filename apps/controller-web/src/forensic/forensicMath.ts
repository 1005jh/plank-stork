import { FORENSIC_RULES as R } from './forensicRules';
export const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  return n ? n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : null;
};
export function stats(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (p: number) => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
  return { count: values.length, median: median(values), p90: quantile(.9), p95: quantile(.95), max: sorted.at(-1) ?? null };
}
export function pearson(a: readonly number[], b: readonly number[]): number | null {
  if (a.length !== b.length || a.length < R.minCorrelationSamples) return null;
  const meanA = a.reduce((s, v) => s + v, 0) / a.length, meanB = b.reduce((s, v) => s + v, 0) / b.length;
  let xx = 0, yy = 0, xy = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] - meanA, y = b[i] - meanB; xx += x * x; yy += y * y; xy += x * y; }
  if (xx / a.length <= R.varianceEpsilon || yy / a.length <= R.varianceEpsilon) return null;
  return Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy)));
}
export function assertTimeline(frames: readonly { tMs: number }[]) {
  if (frames.some((f, i) => !Number.isFinite(f.tMs) || f.tMs < 0 || i > 0 && f.tMs <= frames[i - 1].tMs)) throw new Error('Forensic traces require strictly increasing recorded timestamps.');
}
export function matchFrames(recorded: readonly { tMs: number }[], inferred: readonly { tMs: number }[]) {
  assertTimeline(recorded); assertTimeline(inferred);
  const matches: { recordedIndex: number; inferredIndex: number; dtMs: number }[] = [];
  let cursor = 0;
  for (let r = 0; r < recorded.length; r++) {
    const t = recorded[r].tMs; // STEP4F media PTS mapping: no offset or fitted clock.
    while (cursor < inferred.length && inferred[cursor].tMs < t - R.timestampToleranceMs) cursor++;
    let best = -1, error = Infinity;
    for (let i = cursor; i < inferred.length && inferred[i].tMs <= t + R.timestampToleranceMs; i++) {
      const distance = Math.abs(inferred[i].tMs - t);
      if (distance < error) { best = i; error = distance; }
    }
    if (best >= 0) { matches.push({ recordedIndex: r, inferredIndex: best, dtMs: inferred[best].tMs - t }); cursor = best + 1; }
  }
  return matches;
}
