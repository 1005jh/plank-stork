import type { EstimatorRun } from './estimatorInference';
import type { EstimatorAnalysis } from './estimatorAnalysis';

/** Diagnostic tolerance, not an event acceptance rule. GPU variation is reported rather than hidden. */
export const ESTIMATOR_REPEAT_TOLERANCE = { coordinateAbsolute: 1e-5, geometryAbsolute: 1e-5, eventTimestampMs: 1e-6 } as const;
export function compareEstimatorRepetition(a: EstimatorRun, b: EstimatorRun, before: EstimatorAnalysis, after: EstimatorAnalysis) {
  if (a.variant !== b.variant || JSON.stringify(a.config) !== JSON.stringify(b.config) || a.mediaIdentity.captureId !== b.mediaIdentity.captureId) throw new Error('Repeatability requires the same variant and media.');
  const exactFrameSequence = a.frames.length === b.frames.length && a.frames.every((f, i) => f.tMs === b.frames[i].tMs);
  if (!exactFrameSequence) throw new Error('Repeat frame sequence differs.');
  let missingnessDifferences = 0, coordinateDifferencesAboveTolerance = 0, maxCoordinateDelta = 0, geometryDifferencesAboveTolerance = 0, maxGeometryDelta = 0;
  for (let i = 0; i < a.frames.length; i++) for (const space of ['landmarks', 'worldLandmarks'] as const) {
    const left = a.frames[i][space], right = b.frames[i][space];
    if (left.length !== right.length) missingnessDifferences++;
    for (let j = 0; j < Math.max(left.length, right.length); j++) for (const key of ['x', 'y', 'z', 'visibility'] as const) {
      const x = left[j]?.[key] ?? null, y = right[j]?.[key] ?? null;
      if (x === null || y === null) { if (x !== y) missingnessDifferences++; continue; }
      const delta = Math.abs(x - y); maxCoordinateDelta = Math.max(maxCoordinateDelta, delta);
      if (delta > ESTIMATOR_REPEAT_TOLERANCE.coordinateAbsolute) coordinateDifferencesAboveTolerance++;
    }
  }
  const eventComparison = after.trials.map((trial, i) => {
    const old = before.trials[i];
    for (let j = 0; j < trial.anchorComparisons.length; j++) for (let k = 0; k < trial.anchorComparisons[j].trace.length; k++) {
      const row = trial.anchorComparisons[j].trace[k], prev = old?.anchorComparisons[j]?.trace[k];
      if (!prev || prev.timestamp !== row.timestamp) { missingnessDifferences++; continue; }
      for (const [key, value] of Object.entries(row.values)) {
        const previous = prev.values[key];
        if (value == null || previous == null) { if (value !== previous) missingnessDifferences++; continue; }
        const delta = Math.abs(value - previous); maxGeometryDelta = Math.max(maxGeometryDelta, delta);
        if (delta > ESTIMATOR_REPEAT_TOLERANCE.geometryAbsolute) geometryDifferencesAboveTolerance++;
      }
    }
    return { trialId: trial.trialId, modes: (['PRODUCTION_Y_V3', 'FIXED_REFERENCE'] as const).map((mode) => {
      const previous = old?.detectorReplay?.[mode], current = trial.detectorReplay?.[mode];
      const aEvents = previous?.events, bEvents = current?.events;
      const eventsEqual = aEvents && bEvents ? aEvents.length === bEvents.length && aEvents.every((e, n) => {
        const other = bEvents[n]; return e.direction === other.direction && e.stageIndex === other.stageIndex &&
          Math.abs(e.candidateStartedAt - other.candidateStartedAt) <= ESTIMATOR_REPEAT_TOLERANCE.eventTimestampMs && Math.abs(e.timestamp - other.timestamp) <= ESTIMATOR_REPEAT_TOLERANCE.eventTimestampMs;
      }) : null;
      return { mode, eventsEqual, finalStateEqual: previous && current ? previous.finalState === current.finalState : null };
    }) };
  });
  return { exactFrameSequence, tolerance: ESTIMATOR_REPEAT_TOLERANCE, missingnessDifferences, coordinateDifferencesAboveTolerance, maxCoordinateDelta,
    geometryDifferencesAboveTolerance, maxGeometryDelta, eventComparison,
    scope: 'Repeated offline GPU inference diagnostic. No bit-equality requirement or performance tolerance; changed events remain explicit.' };
}
