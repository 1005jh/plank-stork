import { extractPoseFeatures } from '../pose/features/extractPoseFeatures';
import { calibratePoseFeatures } from '../pose/features/calibratePoseFeatures';
import { validFeatures, HIP_CALIBRATION_VISIBILITY } from '../pose/features/poseFeatureAnalysis';
import { CALIBRATION_FEATURES, type NeutralCalibration } from '../pose/features/poseFeatureTypes';
import { ACTION_FEATURE_SCALES, ACTION_HIP_FEATURES } from '../pose/actions/poseActionConstants';
import { neutralCalibrationWindow } from './multiSignalFeatures';
import { prepareIntegrityInputs, INTEGRITY_ROLES, type IntegrityFrame, type IntegrityRole } from './integrityFeatures';
import { orderedFrames, replayCalibration } from '../replay/landmarkReplay';
import type { ReplaySession, ReplayPoint } from '../replay/replayTypes';
import { median, type Limb } from './discoveryFeatures';

export const TWIST_ROLES = [...INTEGRITY_ROLES, 'REFERENCE_LIVE_3_HOLDOUT_FAILURE'] as const;
export type TwistRole = typeof TWIST_ROLES[number];
export interface TwistInput { filename: string; role: TwistRole; session: ReplaySession }
export const TWIST_ANALYSIS_STATUS = 'POST_FAILURE_EXPLORATORY' as const;
export const TWIST_FEATURE_SETTINGS = {
  actionScales: ACTION_FEATURE_SCALES,
  features: 'extractPoseFeatures + calibratePoseFeatures, existing validFeatures visibility eligibility; unsmoothed current inference frame only',
  depth: 'LEFT world hip Z minus RIGHT world hip Z, minus frozen Neutral; existing definition, NOT image Z or inferred Twist direction',
  hipMotionScore: 'RMS of the three normalized hip deltas, same formula as neutralMovementScore, not a classifier result',
  hipWidth: 'existing extractPoseFeatures: abs(leftHip.x-rightHip.x), not Euclidean pelvis length',
  pelvisAxis: 'atan2(right.y-left.y,right.x-left.x) degrees; frozen circular mean reference; shortest delta in [-180,180)',
  availability: 'same-side knee uses existing HIP .7 / KNEE .5 eligibility; hip proxies require both hips; degenerate width/axis unavailable',
  ratios: 'relational values require both limbs; denominator zero => null (including both-zero symmetry); no epsilon or Infinity substitution',
  sameSignY: 'null if missing or either signed Y equals zero, otherwise compare signs',
  baseline: 'latest successful/frozen calibration; legacy no-setup uses FIRST_NEUTRAL_COMPATIBILITY, excluded from evaluation; no dynamic baseline',
  direction: 'signed values preserved for diagnostics; no hip-depth sign to Twist direction mapping',
} as const;

export function circularMeanDeg(values: readonly number[]) {
  if (!values.length) return null;
  const x = values.reduce((n, v) => n + Math.cos(v * Math.PI / 180), 0) / values.length;
  const y = values.reduce((n, v) => n + Math.sin(v * Math.PI / 180), 0) / values.length;
  return Math.hypot(x, y) < 1e-8 ? null : Math.atan2(y, x) * 180 / Math.PI;
}
export function shortestAngleDeg(current: number | null, reference: number | null) {
  return current === null || reference === null ? null : ((current - reference + 180) % 360 + 360) % 360 - 180;
}
export function pelvisAxisDeg(points: readonly ReplayPoint[]) {
  const a = points[23], b = points[24];
  if (![a, b].every((p) => p && p.visibility !== null && p.visibility >= HIP_CALIBRATION_VISIBILITY && Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  return Math.hypot(b.x - a.x, b.y - a.y) < 1e-8 ? null : Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
}
const ratio = (a: number | null, b: number | null) => a === null || b === null || b === 0 ? null : a / b;
export function bilateralValues(left: number | null, right: number | null) {
  const available = left !== null && right !== null;
  const max = available ? Math.max(left, right) : null, min = available ? Math.min(left, right) : null;
  return { max, min, dominanceAbs: available ? Math.abs(left - right) : null, symmetryRatio: ratio(min, max) };
}

function prepareOne(input: TwistInput, base: ReturnType<typeof prepareIntegrityInputs>[number]) {
  const session = input.session, trial = session.liveResult.trials.find((t) => t.id === base.input.trialId)!;
  const selection = 'LATEST_FROZEN_OR_COMPATIBILITY';
  const { frames: neutralFrames, ...window } = neutralCalibrationWindow(session, trial, selection);
  const rawNeutral = neutralFrames.map((f) => validFeatures(extractPoseFeatures(f.landmarks, f.worldLandmarks)));
  const reconstructed = window.source === 'FIRST_NEUTRAL_COMPATIBILITY' ? null : replayCalibration(session, trial.id, selection);
  const neutral: NeutralCalibration | null = reconstructed ? reconstructed.baseline : Object.fromEntries(CALIBRATION_FEATURES.map(({ raw }) =>
    [raw, median(rawNeutral.flatMap((f) => f[raw] === null ? [] : [f[raw]]))])) as NeutralCalibration;
  const hipsReady = (f: typeof rawNeutral[number]) => f.hipCenterX !== null && f.hipCenterY !== null;
  const width = median(rawNeutral.flatMap((f) => hipsReady(f) && f.hipWidth !== null && f.hipWidth > 0 ? [f.hipWidth] : []));
  const angles = neutralFrames.map((f) => pelvisAxisDeg(f.landmarks)).filter((n): n is number => n !== null);
  const neutralAxis = circularMeanDeg(angles);
  const rawByTime = new Map(orderedFrames(session.poseFrames).map((f) => [f.tMs, f]));
  const frames = base.frames.map((f) => {
    const recorded = rawByTime.get(f.timestamp)!;
    const raw = validFeatures(extractPoseFeatures(recorded.landmarks, recorded.worldLandmarks));
    const calibrated = calibratePoseFeatures(raw, neutral);
    const norm = (key: typeof ACTION_HIP_FEATURES[number]) => calibrated[key] === null ? null : calibrated[key] / ACTION_FEATURE_SCALES[key];
    const normalized = ACTION_HIP_FEATURES.map(norm);
    const depth = norm('deltaHipDepthDifference');
    const hipMotionScore = normalized.every((n) => n !== null) ? Math.hypot(...normalized as number[]) / Math.sqrt(normalized.length) : null;
    const leftSignedY = f.measurements.LEFT.deltaDyNorm, rightSignedY = f.measurements.RIGHT.deltaDyNorm;
    const y = bilateralValues(f.LEFT.Y, f.RIGHT.Y), flex = bilateralValues(f.LEFT.FLEXION, f.RIGHT.FLEXION);
    const axis = pelvisAxisDeg(recorded.landmarks), hipWidth = hipsReady(raw) ? raw.hipWidth : null;
    return { ...f, twist: { ...calibrated,
      normalizedHipCenterX: norm('deltaHipCenterX'), normalizedHipCenterY: norm('deltaHipCenterY'), normalizedHipDepthDifference: depth,
      absNormalizedHipDepthDifference: depth === null ? null : Math.abs(depth), hipMotionScore,
      hipWidth, hipWidthRatio: ratio(hipWidth, width), pelvisAxisDeg: axis, pelvisAxisDeltaDeg: shortestAngleDeg(axis, neutralAxis),
      leftSignedY, rightSignedY, leftY: f.LEFT.Y, rightY: f.RIGHT.Y,
      yMax: y.max, yMin: y.min, yDominanceAbs: y.dominanceAbs, ySymmetryRatio: y.symmetryRatio,
      sameSignY: leftSignedY === null || rightSignedY === null || leftSignedY === 0 || rightSignedY === 0 ? null : Math.sign(leftSignedY) === Math.sign(rightSignedY),
      leftFlexion: f.LEFT.FLEXION, rightFlexion: f.RIGHT.FLEXION,
      flexMax: flex.max, flexMin: flex.min, flexDominanceAbs: flex.dominanceAbs, flexSymmetryRatio: flex.symmetryRatio,
    } };
  });
  const sourceRole = input.role;
  // Once used for discovery, both aliases are explicitly marked failed/exploratory.
  const role = sourceRole === 'REFERENCE_LIVE_3_HOLDOUT' ? 'REFERENCE_LIVE_3_HOLDOUT_FAILURE' : sourceRole;
  return { ...base, input: { ...base.input, role, sourceRole }, frames, analysisStatus: TWIST_ANALYSIS_STATUS,
    twistBaseline: { ...window, neutral, reconstruction: reconstructed, hipWidthMedian: width, pelvisCircularReferenceDeg: neutralAxis, axisUsableFrames: angles.length } };
}
export type TwistFixture = ReturnType<typeof prepareOne>;
export type TwistFrame = TwistFixture['frames'][number];
export type TwistValues = TwistFrame['twist'];
export type TwistNumericFeature = Exclude<keyof TwistValues, 'sameSignY'>;

export function prepareTwistInputs(inputs: readonly TwistInput[]): TwistFixture[] {
  // Preserve original capture contents and the strict LIVE parity gate. The role is
  // changed only in this report, never in the previous independent acceptance.
  const integrity = prepareIntegrityInputs(inputs.map((i) => ({ ...i,
    role: (i.role === 'REFERENCE_LIVE_3_HOLDOUT_FAILURE' ? 'REFERENCE_LIVE_3_HOLDOUT' : i.role) as IntegrityRole })), true);
  return integrity.map((f) => prepareOne(inputs.find((i) => i.session.captureId === f.input.captureId)!, f));
}
export function candidateRelative(values: TwistValues, side: Limb) {
  const left = side === 'LEFT', candidateY = left ? values.leftY : values.rightY, opponentY = left ? values.rightY : values.leftY;
  const candidateFlexion = left ? values.leftFlexion : values.rightFlexion, opponentFlexion = left ? values.rightFlexion : values.leftFlexion;
  const difference = (a: number | null, b: number | null) => a === null || b === null ? null : a - b;
  return { candidateY, opponentY, candidateMinusOpponentY: difference(candidateY, opponentY), candidateToOpponentYRatio: ratio(candidateY, opponentY),
    candidateFlexion, opponentFlexion, candidateMinusOpponentFlexion: difference(candidateFlexion, opponentFlexion), candidateToOpponentFlexionRatio: ratio(candidateFlexion, opponentFlexion) };
}

/** The analysis wrapper must never reinterpret an unrelated frame as a measured one. */
export function measuredTwistFrame(frame: IntegrityFrame): TwistFrame {
  if (!('twist' in frame)) throw new Error('Missing STEP4L measured features');
  return frame as TwistFrame;
}
