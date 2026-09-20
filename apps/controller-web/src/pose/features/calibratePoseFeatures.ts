import { CALIBRATION_FEATURES, type CalibratedPoseFeatures, type NeutralCalibration, type PoseFeatures } from './poseFeatureTypes';

/** Current minus Neutral, keeping unavailable values unavailable (including a missing baseline). */
export function calibratePoseFeatures(current: PoseFeatures, neutral: NeutralCalibration | null): CalibratedPoseFeatures {
  return Object.fromEntries(CALIBRATION_FEATURES.map(({ raw, delta }) => {
    const reference = neutral?.[raw] ?? null;
    const value = current[raw];
    return [delta, value === null || reference === null ? null : value - reference];
  })) as CalibratedPoseFeatures;
}
