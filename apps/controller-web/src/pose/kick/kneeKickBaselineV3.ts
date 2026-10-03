import { CALIBRATION_MIN_SAMPLES } from '../features/poseFeatureAnalysis';
import { robustStats } from '../motion/kneeMotionAnalyzer';
import { finite, type KneeMotionFeatures } from '../motion/kneeMotionFeatures';
import { usableKneesV3, validKneeKickBaselineV3, type KneeKickBaselineV3 } from './kneeKickDetectorV3';
import type { KneeKickBaseline } from './kneeKickDetector';

/** Component-wise medians of usable Neutral knee - hip-center offsets (STEP 4G definition).
 * Production calls this only inside its existing bounded Neutral window. No movement fallback.
 * Old captures may supply frozen X/distance/scale for a clearly labeled Y reconstruction.
 */
export function buildKneeKickBaselineV3(samples: readonly KneeMotionFeatures[], legacy?: KneeKickBaseline): KneeKickBaselineV3 | null {
  const left = samples.filter((f) => usableKneesV3(f).left), right = samples.filter((f) => usableKneesV3(f).right);
  if (left.length < CALIBRATION_MIN_SAMPLES || right.length < CALIBRATION_MIN_SAMPLES) return null;
  const median = (frames: readonly KneeMotionFeatures[], key: keyof KneeMotionFeatures) => robustStats(frames.map((f) => f[key]).filter(finite)).median;
  const leftDistance = legacy?.leftDistanceMedian ?? median(left, 'leftKneeHipDistance');
  const rightDistance = legacy?.rightDistanceMedian ?? median(right, 'rightKneeHipDistance');
  const baseline = { version: 3, leftXMedian: legacy?.leftMedian ?? median(left, 'leftKneeCenterOffsetX'), rightXMedian: legacy?.rightMedian ?? median(right, 'rightKneeCenterOffsetX'),
    leftYMedian: median(left, 'leftKneeCenterOffsetY'), rightYMedian: median(right, 'rightKneeCenterOffsetY'),
    leftDistanceMedian: leftDistance, rightDistanceMedian: rightDistance,
    bodyScale: legacy?.bodyScale ?? (leftDistance !== null && rightDistance !== null ? (leftDistance + rightDistance) / 2 : null) };
  return validKneeKickBaselineV3(baseline) ? baseline : null;
}
