import { KICK_HIP_VISIBILITY, KICK_KNEE_VISIBILITY, usableKnees, type KneeKickBaseline } from '../pose/kick/kneeKickDetector';
import { extractKneeMotionFeatures, finite, MAX_VELOCITY_GAP_MS } from '../pose/motion/kneeMotionFeatures';
import type { ReplayPoint, ReplayPoseFrame } from '../replay/replayTypes';

export const DISCOVERY_SETTINGS = {
  hipVisibility: KICK_HIP_VISIBILITY, kneeVisibility: KICK_KNEE_VISIBILITY, ankleVisibility: 0.5,
  maxVelocityGapMs: MAX_VELOCITY_GAP_MS, lowCoverageBelow: 0.8, geometryEpsilon: 1e-8,
  bodyScaleSource: 'recorded trial.baseline.bodyScale (frozen)',
  neutralSource: 'first NEUTRAL stage; component-wise usable-frame medians; no minimum sample imputation',
  worldValidity: 'same-side image hip/knee visibility; optional world visibility uses the same guards',
  angleSpace: 'image XY, degrees; exploratory only',
  velocity: 'signed adjacent value difference / recorded tMs seconds; reset at stage boundary, missing value or dt >= 400ms',
  evidence: 'absolute neutral displacement for signed motion; magnitude for nonnegative motion; raw diagnostics excluded from separation',
  percentiles: 'nearest rank p90/p95; median averages the two middle samples',
  coverage: 'usable side-frames / recorded side-frames within attributed stages; not source video FPS coverage',
  aggregation: 'pool usable side-frame evidence for non-kick; correct limb peak for each kick label; direction checked for EVERY observed kick stage',
} as const;
export type Side = 'LEFT' | 'RIGHT' | 'GLOBAL';
export const LIMBS = ['LEFT', 'RIGHT'] as const;
export type Limb = typeof LIMBS[number];
type Group = 'CONTROL' | 'IMAGE' | 'WORLD' | 'ANGLE' | 'TRANSLATION';
const feature = (group: Group, unit: string, formula: string, evidence = false, velocity = false, global = false) =>
  ({ group, unit, formula, evidence, velocity, sides: global ? ['GLOBAL'] as const : LIMBS });

// Raw diagnostics have no kick evidence: absolute position/length is not motion.
export const DISCOVERY_FEATURES = {
  kneeCenterOffsetX: feature('CONTROL', 'image', 'knee.x - hipCenter.x, existing detector usability'),
  normalizedXDisplacement: feature('CONTROL', 'bodyScale', '(kneeCenterOffsetX - recorded kick baseline median) / bodyScale', true, true),
  dominantNormalizedXDisplacement: feature('CONTROL', 'bodyScale', 'signed largest absolute existing normalized X (tie LEFT)', true, true, true),
  dx: feature('IMAGE', 'image', 'knee.x - hipCenter.x'),
  dy: feature('IMAGE', 'image', 'knee.y - hipCenter.y'),
  deltaDx: feature('IMAGE', 'image', 'dx - neutral.dx', true),
  deltaDy: feature('IMAGE', 'image', 'dy - neutral.dy', true),
  deltaDxNorm: feature('IMAGE', 'bodyScale', 'deltaDx / bodyScale', true),
  deltaDyNorm: feature('IMAGE', 'bodyScale', 'deltaDy / bodyScale', true),
  hipCenterRelative2DDisplacement: feature('IMAGE', 'bodyScale', 'hypot(deltaDx, deltaDy) / bodyScale', true, true),
  sameHipDeltaXNorm: feature('IMAGE', 'bodyScale', '(sameHipDx - neutral.sameHipDx) / bodyScale', true),
  sameHipDeltaYNorm: feature('IMAGE', 'bodyScale', '(sameHipDy - neutral.sameHipDy) / bodyScale', true),
  sameHip2DDisplacementNorm: feature('IMAGE', 'bodyScale', 'hypot(sameHip delta X, sameHip delta Y) / bodyScale', true, true),
  kneeHipDistance: feature('IMAGE', 'image', 'hypot(knee.x - sameHip.x, knee.y - sameHip.y)'),
  neutralKneeHipDistance: feature('IMAGE', 'image', 'neutral median knee-hip distance; shown only on currently usable frames'),
  distanceChange: feature('IMAGE', 'image', 'kneeHipDistance - neutral distance', true),
  absoluteDistanceChange: feature('IMAGE', 'image', 'abs(distanceChange)', true, true),
  distanceChangeNorm: feature('IMAGE', 'bodyScale', 'distanceChange / bodyScale', true),
  absoluteDistanceChangeNorm: feature('IMAGE', 'bodyScale', 'abs(distanceChange) / bodyScale', true, true),
  worldDx: feature('WORLD', 'world', 'knee.worldX - sameHip.worldX'),
  worldDy: feature('WORLD', 'world', 'knee.worldY - sameHip.worldY'),
  worldDz: feature('WORLD', 'world', 'knee.worldZ - sameHip.worldZ'),
  deltaWorldX: feature('WORLD', 'world', 'worldDx - neutral.worldDx', true),
  deltaWorldY: feature('WORLD', 'world', 'worldDy - neutral.worldDy', true),
  deltaWorldZ: feature('WORLD', 'world', 'worldDz - neutral.worldDz', true),
  absDeltaWorldX: feature('WORLD', 'world', 'abs(deltaWorldX)', true),
  absDeltaWorldY: feature('WORLD', 'world', 'abs(deltaWorldY)', true),
  absDeltaWorldZ: feature('WORLD', 'world', 'abs(deltaWorldZ)', true),
  world3DDisplacement: feature('WORLD', 'world', 'hypot(deltaWorldX, deltaWorldY, deltaWorldZ)', true, true),
  deltaWorldXNorm: feature('WORLD', 'neutral world length', 'deltaWorldX / neutral same-side world hip-knee length', true),
  deltaWorldYNorm: feature('WORLD', 'neutral world length', 'deltaWorldY / neutral same-side world hip-knee length', true),
  deltaWorldZNorm: feature('WORLD', 'neutral world length', 'deltaWorldZ / neutral same-side world hip-knee length', true),
  absDeltaWorldXNorm: feature('WORLD', 'neutral world length', 'abs(deltaWorldXNorm)', true),
  absDeltaWorldYNorm: feature('WORLD', 'neutral world length', 'abs(deltaWorldYNorm)', true),
  absDeltaWorldZNorm: feature('WORLD', 'neutral world length', 'abs(deltaWorldZNorm)', true),
  world3DDisplacementNorm: feature('WORLD', 'neutral world length', 'world3DDisplacement / neutral same-side world hip-knee length', true, true),
  kneeFlexionAngle: feature('ANGLE', 'degrees', 'image XY hip-knee-ankle angle; exploratory'),
  kneeFlexionAngleChange: feature('ANGLE', 'degrees', 'angle - neutral median angle; exploratory', true),
  hipCenterXChange: feature('TRANSLATION', 'image', 'hipCenter.x - neutral hipCenter.x', false, false, true),
  hipCenterYChange: feature('TRANSLATION', 'image', 'hipCenter.y - neutral hipCenter.y', false, false, true),
};
export type FeatureId = keyof typeof DISCOVERY_FEATURES;
export const FEATURE_IDS = Object.keys(DISCOVERY_FEATURES) as FeatureId[];
export type FeatureValues = Record<FeatureId, Partial<Record<Side, number | null>>>;

const subtract = (a: number | null, b: number | null) => a !== null && b !== null ? a - b : null;
const divide = (a: number | null, b: number | null) => a !== null && b !== null && b > DISCOVERY_SETTINGS.geometryEpsilon ? a / b : null;
const abs = (a: number | null) => a === null ? null : Math.abs(a);
const norm = (...values: (number | null)[]) => values.every((value) => value !== null) ? Math.hypot(...values as number[]) : null;
function point(points: ReplayPoint[], index: number, visibility: number, optionalVisibility = false) {
  const p = points[index];
  return p && finite(p.x) && finite(p.y) && finite(p.z) &&
    ((optionalVisibility && p.visibility == null) || (finite(p.visibility) && p.visibility >= visibility)) ? p : null;
}
function angle(hip: ReplayPoint | null, knee: ReplayPoint | null, ankle: ReplayPoint | null) {
  if (!hip || !knee || !ankle) return null;
  const ax = hip.x - knee.x, ay = hip.y - knee.y, bx = ankle.x - knee.x, by = ankle.y - knee.y;
  const denominator = Math.hypot(ax, ay) * Math.hypot(bx, by);
  return denominator > DISCOVERY_SETTINGS.geometryEpsilon ? Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / denominator))) * 180 / Math.PI : null;
}
export function rawDiscoveryFrame(frame: ReplayPoseFrame) {
  const hips = [point(frame.landmarks, 23, KICK_HIP_VISIBILITY), point(frame.landmarks, 24, KICK_HIP_VISIBILITY)];
  const center = hips[0] && hips[1] ? { x: (hips[0].x + hips[1].x) / 2, y: (hips[0].y + hips[1].y) / 2 } : null;
  const limb = (index: number) => {
    const hip = hips[index], knee = point(frame.landmarks, 25 + index, KICK_KNEE_VISIBILITY);
    const sameDx = knee && hip ? knee.x - hip.x : null, sameDy = knee && hip ? knee.y - hip.y : null;
    const wh = hip && point(frame.worldLandmarks, 23 + index, KICK_HIP_VISIBILITY, true);
    const wk = knee && point(frame.worldLandmarks, 25 + index, KICK_KNEE_VISIBILITY, true);
    const worldDx = wh && wk ? wk.x - wh.x : null, worldDy = wh && wk ? wk.y - wh.y : null, worldDz = wh && wk ? wk.z - wh.z : null;
    return { dx: knee && center ? knee.x - center.x : null, dy: knee && center ? knee.y - center.y : null,
      sameDx, sameDy, distance: norm(sameDx, sameDy), worldDx, worldDy, worldDz, worldLength: norm(worldDx, worldDy, worldDz),
      angle: angle(hip, knee, point(frame.landmarks, 27 + index, DISCOVERY_SETTINGS.ankleVisibility)) };
  };
  return { LEFT: limb(0), RIGHT: limb(1), centerX: center?.x ?? null, centerY: center?.y ?? null };
}
type Raw = ReturnType<typeof rawDiscoveryFrame>;
type RawKey = keyof Raw['LEFT'];
export interface NeutralReference {
  LEFT: Record<RawKey, number | null>; RIGHT: Record<RawKey, number | null>;
  centerX: number | null; centerY: number | null;
  usableCounts: { LEFT: Record<RawKey, number>; RIGHT: Record<RawKey, number>; centerX: number; centerY: number };
  frameCount: number;
}
export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export function buildNeutralReference(frames: readonly ReplayPoseFrame[]): NeutralReference {
  // Only a few scalar candidates are materialized, never copied landmarks.
  const raw = frames.map(rawDiscoveryFrame);
  const keys: RawKey[] = ['dx', 'dy', 'sameDx', 'sameDy', 'distance', 'worldDx', 'worldDy', 'worldDz', 'worldLength', 'angle'];
  const values = (side: Limb, key: RawKey) => raw.map((frame) => frame[side][key]).filter(finite);
  const reference = (side: Limb) => Object.fromEntries(keys.map((key) => [key, median(values(side, key))])) as Record<RawKey, number | null>;
  const counts = (side: Limb) => Object.fromEntries(keys.map((key) => [key, values(side, key).length])) as Record<RawKey, number>;
  return { LEFT: reference('LEFT'), RIGHT: reference('RIGHT'), centerX: median(raw.map((v) => v.centerX).filter(finite)),
    centerY: median(raw.map((v) => v.centerY).filter(finite)), frameCount: frames.length,
    usableCounts: { LEFT: counts('LEFT'), RIGHT: counts('RIGHT'), centerX: raw.filter((v) => v.centerX !== null).length, centerY: raw.filter((v) => v.centerY !== null).length } };
}

export function discoveryFeatures(frame: ReplayPoseFrame, neutral: NeutralReference, baseline: KneeKickBaseline): FeatureValues {
  const raw = rawDiscoveryFrame(frame), values = Object.fromEntries(FEATURE_IDS.map((id) => [id, {}])) as FeatureValues;
  // Read the existing extraction/validity functions without creating or advancing a detector.
  const control = extractKneeMotionFeatures(frame.landmarks), usable = usableKnees(control);
  for (const side of LIMBS) {
    const r = raw[side], n = neutral[side], scale = baseline.bodyScale;
    const dx = subtract(r.dx, n.dx), dy = subtract(r.dy, n.dy);
    const sx = subtract(r.sameDx, n.sameDx), sy = subtract(r.sameDy, n.sameDy), distance = subtract(r.distance, n.distance);
    const wx = subtract(r.worldDx, n.worldDx), wy = subtract(r.worldDy, n.worldDy), wz = subtract(r.worldDz, n.worldDz);
    const offset = side === 'LEFT' ? control.leftKneeCenterOffsetX : control.rightKneeCenterOffsetX;
    const controlUsable = side === 'LEFT' ? usable.left : usable.right;
    const limbValues = {
      kneeCenterOffsetX: controlUsable ? offset : null,
      normalizedXDisplacement: controlUsable ? divide(subtract(offset, side === 'LEFT' ? baseline.leftMedian : baseline.rightMedian), scale) : null,
      dx: r.dx, dy: r.dy, deltaDx: dx, deltaDy: dy, deltaDxNorm: divide(dx, scale), deltaDyNorm: divide(dy, scale),
      hipCenterRelative2DDisplacement: divide(norm(dx, dy), scale), sameHipDeltaXNorm: divide(sx, scale), sameHipDeltaYNorm: divide(sy, scale),
      sameHip2DDisplacementNorm: divide(norm(sx, sy), scale), kneeHipDistance: r.distance, neutralKneeHipDistance: r.distance === null ? null : n.distance,
      distanceChange: distance, absoluteDistanceChange: abs(distance), distanceChangeNorm: divide(distance, scale), absoluteDistanceChangeNorm: divide(abs(distance), scale),
      worldDx: r.worldDx, worldDy: r.worldDy, worldDz: r.worldDz, deltaWorldX: wx, deltaWorldY: wy, deltaWorldZ: wz,
      absDeltaWorldX: abs(wx), absDeltaWorldY: abs(wy), absDeltaWorldZ: abs(wz), world3DDisplacement: norm(wx, wy, wz),
      deltaWorldXNorm: divide(wx, n.worldLength), deltaWorldYNorm: divide(wy, n.worldLength), deltaWorldZNorm: divide(wz, n.worldLength),
      absDeltaWorldXNorm: divide(abs(wx), n.worldLength), absDeltaWorldYNorm: divide(abs(wy), n.worldLength), absDeltaWorldZNorm: divide(abs(wz), n.worldLength),
      world3DDisplacementNorm: divide(norm(wx, wy, wz), n.worldLength), kneeFlexionAngle: r.angle, kneeFlexionAngleChange: subtract(r.angle, n.angle),
    };
    for (const [id, value] of Object.entries(limbValues)) values[id as FeatureId][side] = value;
  }
  const left = values.normalizedXDisplacement.LEFT ?? null, right = values.normalizedXDisplacement.RIGHT ?? null;
  values.dominantNormalizedXDisplacement.GLOBAL = left === null ? right : right === null || Math.abs(left) >= Math.abs(right) ? left : right;
  values.hipCenterXChange.GLOBAL = subtract(raw.centerX, neutral.centerX);
  values.hipCenterYChange.GLOBAL = subtract(raw.centerY, neutral.centerY);
  return values;
}

export function recordedVelocity(value: number | null, tMs: number, previous: { value: number | null; tMs: number } | null) {
  const dt = previous ? tMs - previous.tMs : 0;
  return value !== null && previous?.value != null && dt > 0 && dt < DISCOVERY_SETTINGS.maxVelocityGapMs
    ? (value - previous.value) * 1000 / dt : null;
}
