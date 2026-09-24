import { POSE_ACTIONS, type ActionFeatureKey, type ActionPrototypes, type PoseAction, type PoseActionState } from '../actions/poseActionTypes';
import type { ActionSummary, LabelSummary, ValidationSample, ValidationSummary } from './validationTypes';

const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
const rate = (count: number, total: number) => total ? count / total : null;
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function counts(samples: readonly ValidationSample[], expected: PoseActionState): LabelSummary {
  const valid = samples.filter((sample) => sample.poseValid);
  return {
    totalRecordedFrames: samples.length, validPoseFrames: valid.length, staleFrames: samples.length - valid.length,
    rawCorrectRate: rate(valid.filter(({ classification }) => classification.rawAction === expected).length, valid.length),
    stableCorrectRate: rate(valid.filter(({ classification }) => classification.stableAction === expected).length, valid.length),
  };
}

/** Measurement only: no thresholds or PASS/FAIL. Uses the experiment's saved scales. */
export function summarizeValidation(
  samples: readonly ValidationSample[], prototypes: ActionPrototypes, scales: Record<ActionFeatureKey, number>,
): ValidationSummary {
  const actions = Object.fromEntries(POSE_ACTIONS.map((action) => {
    const labeled = samples.filter((sample) => sample.expectedAction === action);
    const valid = labeled.filter((sample) => sample.poseValid);
    const distances = valid.flatMap(({ classification }) => {
      const own = classification.actionDistances[action];
      const others = POSE_ACTIONS.filter((key) => key !== action).map((key) => classification.actionDistances[key]);
      if (!finite(own) || !others.every(finite)) return [];
      const other = Math.min(...others);
      return [{ own, other, margin: other - own }];
    });
    const featureRepeatability = Object.fromEntries((Object.keys(scales) as ActionFeatureKey[]).map((key) => {
      const values = valid.filter((sample) => sample.smoothedFeatures.validNow).map((sample) => sample.smoothedFeatures.values[key]).filter(finite);
      const prototype = prototypes[action]?.features[key] ?? null;
      const validationMedian = median(values);
      const difference = finite(prototype) && validationMedian !== null ? validationMedian - prototype : null;
      return [key, { sampleCount: values.length, prototype, validationMedian, difference,
        normalizedDrift: difference !== null && finite(scales[key]) && scales[key] > 0 ? Math.abs(difference) / scales[key] : null }];
    })) as ActionSummary['featureRepeatability'];
    return [action, {
      ...counts(labeled, action), distanceComparableFrames: distances.length,
      // Ties are not uniquely nearest; the denominator requires all four finite distances.
      ownPrototypeNearestRate: rate(distances.filter(({ own, other }) => own < other).length, distances.length),
      medianConfidence: median(valid.map((sample) => sample.classification.confidence).filter(finite)),
      medianOwnDistance: median(distances.map(({ own }) => own)),
      medianClosestOtherDistance: median(distances.map(({ other }) => other)),
      medianMargin: median(distances.map(({ margin }) => margin)), featureRepeatability,
    }];
  })) as Record<PoseAction, ActionSummary>;
  const neutral = samples.filter((sample) => sample.expectedAction === 'NONE');
  const scores = neutral.filter((sample) => sample.poseValid).map((sample) => sample.classification.neutralMovementScore).filter(finite).sort((a, b) => a - b);
  return { actions, neutral: {
    ...counts(neutral, 'NONE'), scoreFrames: scores.length,
    medianNeutralMovementScore: median(scores),
    // Nearest-rank percentile, explicitly defined for small datasets too.
    p90NeutralMovementScore: scores.length ? scores[Math.ceil(0.9 * scores.length) - 1] : null,
  } };
}
