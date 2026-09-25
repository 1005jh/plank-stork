import { CORRIDOR_FEATURES, finite, type CorridorFeature } from './kneeMotionFeatures';
import { EXPECTED_MOTIONS, type MotionAnalysis, type MotionMetrics, type MotionSample, type MotionStage, type NeutralCorridor, type RobustStats } from './kneeMotionTypes';

export const CORRIDOR_MULTIPLIERS = [1.5, 2, 2.5, 3] as const;
const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const peak = (values: number[]) => values.length ? Math.max(...values.map(Math.abs)) : null;
export function robustStats(values: readonly (number | null)[]): RobustStats {
  const sorted = values.filter(finite).sort((a, b) => a - b), center = median(sorted);
  return { sampleCount: sorted.length, median: center,
    p10: sorted.length ? sorted[Math.ceil(sorted.length * 0.1) - 1] : null,
    p90: sorted.length ? sorted[Math.ceil(sorted.length * 0.9) - 1] : null,
    mad: center === null ? null : median(sorted.map((value) => Math.abs(value - center))) };
}

function metrics(samples: readonly MotionSample[], corridor: NeutralCorridor): MotionMetrics {
  const offsets = samples.map((sample) => sample.features.maxAbsKneeCenterOffsetX).filter(finite);
  const displacement = (key: CorridorFeature) => {
    const center = corridor[key].median;
    return center === null ? null : peak(samples.map((sample) => sample.features[key]).filter(finite).map((value) => value - center));
  };
  return {
    totalFrames: samples.length, validFrames: samples.filter((sample) => sample.poseValid).length,
    staleFrames: samples.filter((sample) => !sample.poseValid).length,
    medianAbsKneeCenterOffsetX: median(offsets), maxAbsKneeCenterOffsetX: peak(offsets),
    peakRelativeKneeVelocity: {
      left: peak(samples.map((sample) => sample.velocity.leftKneeRelativeVelocityX).filter(finite)),
      right: peak(samples.map((sample) => sample.velocity.rightKneeRelativeVelocityX).filter(finite)),
    },
    peakKneeHipDistanceChange: { left: displacement('leftKneeHipDistance'), right: displacement('rightKneeHipDistance') },
    peakKneeHipDistanceVelocity: {
      left: peak(samples.map((sample) => sample.velocity.leftKneeHipDistanceVelocity).filter(finite)),
      right: peak(samples.map((sample) => sample.velocity.rightKneeHipDistanceVelocity).filter(finite)),
    },
    medianLeftKneeVisibility: median(samples.map((sample) => sample.features.leftKneeVisibility).filter(finite)),
    medianRightKneeVisibility: median(samples.map((sample) => sample.features.rightKneeVisibility).filter(finite)),
  };
}

/** Offline measurements only. No signal choice, body-side assumption or KICK decision. */
export function analyzeKneeMotion(samples: readonly MotionSample[], sequence: readonly MotionStage[]): MotionAnalysis {
  const neutral = samples.filter((sample) => sample.phase === 'NEUTRAL');
  const neutralCorridor = Object.fromEntries(CORRIDOR_FEATURES.map((key) => [key, robustStats(neutral.map((sample) => sample.features[key]))])) as NeutralCorridor;
  const stages = sequence.flatMap((stage, stageIndex) => stage.phase === 'PREPARE' ? [] : [{
    stageIndex, phase: stage.phase, expectedMotion: stage.expectedMotion,
    ...metrics(samples.filter((sample) => sample.stageIndex === stageIndex), neutralCorridor),
  }]);
  const byMotion = Object.fromEntries(EXPECTED_MOTIONS.map((motion) => [motion, metrics(samples.filter((sample) => sample.expectedMotion === motion), neutralCorridor)])) as MotionAnalysis['byMotion'];
  const experimentFrames = samples.filter((sample) => sample.phase === 'MOVE' || sample.phase === 'HOLD' || sample.phase === 'NEUTRAL');
  const crossingExperiments = CORRIDOR_FEATURES.flatMap((feature) => CORRIDOR_MULTIPLIERS.map((k) => {
    const { median: center, mad } = neutralCorridor[feature];
    const lower = center !== null && mad !== null ? center - k * mad : null;
    const upper = center !== null && mad !== null ? center + k * mad : null;
    const rates = Object.fromEntries(EXPECTED_MOTIONS.map((motion) => {
      const values = lower === null || upper === null ? [] : experimentFrames.filter((sample) => sample.expectedMotion === motion).map((sample) => sample.features[feature]).filter(finite);
      const crossingFrames = values.filter((value) => value < lower! || value > upper!).length;
      return [motion, { comparableFrames: values.length, crossingFrames, crossingRate: values.length ? crossingFrames / values.length : null }];
    })) as MotionAnalysis['crossingExperiments'][number]['rates'];
    return { feature, k, lower, upper, rates };
  }));
  const dominantKnees = Object.fromEntries((['KNEE_LEFT', 'KNEE_RIGHT'] as const).map((motion) => {
    const moving = experimentFrames.filter((sample) => sample.expectedMotion === motion);
    const displacement = (key: CorridorFeature) => {
      const center = neutralCorridor[key].median;
      return center === null ? null : peak(moving.map((sample) => sample.features[key]).filter(finite).map((value) => value - center));
    };
    const left = displacement('leftKneeCenterOffsetX'), right = displacement('rightKneeCenterOffsetX');
    return [motion, { dominantKnee: left === null || right === null || left === right ? 'NONE' : left > right ? 'LEFT_LANDMARK' : 'RIGHT_LANDMARK',
      leftPeakDisplacement: left, rightPeakDisplacement: right }];
  })) as MotionAnalysis['dominantKnees'];
  return { neutralCorridor, stages, byMotion, crossingExperiments, dominantKnees };
}
