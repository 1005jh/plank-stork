import { BODY_STALE_MS } from './bodyLocalFeatures';
export interface TrajectoryPoint { timestamp: number; value: number | null }
/** Discrete observed samples, trapezoidal time integrals (seconds), no extrapolation. */
export function trajectorySummary(points: readonly TrajectoryPoint[], start: number, end: number, availableAt = end) {
  const rows = points.filter((p) => p.timestamp >= start && p.timestamp <= Math.min(end, availableAt));
  const valid = rows.filter((p): p is TrajectoryPoint & { value: number } => p.value !== null && Number.isFinite(p.value));
  let signedArea = 0, absArea = 0, pathLength = 0, connectedMs = 0, breaks = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i], dt = b.timestamp - a.timestamp;
    if (a.value === null || b.value === null || dt <= 0 || dt >= BODY_STALE_MS) { breaks++; continue; }
    signedArea += (a.value + b.value) / 2 * dt / 1000;
    // Integrate |linear segment| exactly when it crosses zero.
    const aa = Math.abs(a.value), bb = Math.abs(b.value);
    absArea += (a.value * b.value < 0 ? (aa * aa + bb * bb) / (2 * (aa + bb)) : (aa + bb) / 2) * dt / 1000;
    pathLength += Math.abs(b.value - a.value); connectedMs += dt;
  }
  const values = valid.map((p) => p.value), startValue = rows[0]?.value ?? null, endValue = rows.at(-1)?.value ?? null;
  const continuous = rows.length > 0 && valid.length === rows.length && breaks === 0;
  const netChange = continuous && startValue !== null && endValue !== null ? endValue - startValue : null;
  const min = values.length ? Math.min(...values) : null, max = values.length ? Math.max(...values) : null;
  return { startMs: start, endMs: end, availableAt, frames: rows.length, usable: valid.length, coverage: rows.length ? valid.length / rows.length : null,
    firstObservedAt: valid[0]?.timestamp ?? null, lastObservedAt: valid.at(-1)?.timestamp ?? null, continuous, breaks, connectedMs,
    startValue, endValue, min, max, range: min === null || max === null ? null : max - min,
    absPeak: values.length ? Math.max(...values.map(Math.abs)) : null, RMS: values.length ? Math.sqrt(values.reduce((n, v) => n + v * v, 0) / values.length) : null,
    signedArea: connectedMs ? signedArea : null, absArea: connectedMs ? absArea : null,
    directionalCoherence: continuous && absArea > 0 ? Math.abs(signedArea) / absArea : null,
    netChange, pathLength: connectedMs ? pathLength : null, efficiency: netChange !== null && pathLength > 0 ? Math.abs(netChange) / pathLength : null };
}
export function observedOnset(points: readonly TrajectoryPoint[], anchor: number, threshold: number) {
  const rows = points.filter((p) => p.timestamp >= anchor - 200 && p.timestamp <= anchor);
  let previous: TrajectoryPoint | null = null, censored = false;
  for (const row of rows) {
    if (row.value !== null && Math.abs(row.value) >= threshold) {
      if (previous?.value !== null && previous && row.timestamp - previous.timestamp < BODY_STALE_MS && Math.abs(previous.value) < threshold)
        return { at: row.timestamp, leftCensored: censored };
      if (!previous || previous.value === null) censored = true;
    }
    previous = row;
  }
  return { at: null, leftCensored: censored };
}
export function onsetRelation(candidate: readonly TrajectoryPoint[], opponent: readonly TrajectoryPoint[], anchor: number, threshold: number) {
  const c = observedOnset(candidate, anchor, threshold), o = observedOnset(opponent, anchor, threshold);
  return { threshold, candidateOnsetAt: c.at, opponentOnsetAt: o.at, candidateLeftCensored: c.leftCensored, opponentLeftCensored: o.leftCensored,
    onsetLagMs: c.at === null || o.at === null ? null : o.at - c.at };
}
