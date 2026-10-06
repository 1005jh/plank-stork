import type { ReplayPoint, ReplaySession } from '../replay/replayTypes';
import { orderedFrames } from '../replay/landmarkReplay';
import { neutralCalibrationWindow } from './multiSignalFeatures';
import { LIMBS, median, type Limb } from './discoveryFeatures';
import { circularMeanDeg, shortestAngleDeg, prepareTwistInputs, type TwistRole } from './twistConfusionFeatures';

export const BODY_ROLES = ['UNASSIGNED', 'REFERENCE_OLD_CLEAN', 'STRESS', 'REFERENCE_LIVE_1', 'REFERENCE_LIVE_2', 'REFERENCE_LIVE_3'] as const;
export type BodyRole = typeof BODY_ROLES[number];
export interface BodyInput { filename: string; role: BodyRole; session: ReplaySession }
export const BODY_STATUS = 'POST_FAILURE_EXPLORATORY' as const;
export const BODY_STALE_MS = 400;
// Numerical degeneracy only, not a learned motion threshold.
const AXIS_EPSILON = 1e-8;
type XY = { x: number; y: number };
const sub = (a: XY, b: XY): XY => ({ x: a.x - b.x, y: a.y - b.y });
const center = (a: XY, b: XY): XY => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const norm = (v: XY | null) => v === null ? null : Math.hypot(v.x, v.y);
const unit = (v: XY | null): XY | null => v && norm(v)! >= AXIS_EPSILON ? { x: v.x / norm(v)!, y: v.y / norm(v)! } : null;
const rot = (v: XY | null): XY | null => v && { x: -v.y, y: v.x };
const dot = (a: XY | null, b: XY | null) => a && b ? a.x * b.x + a.y * b.y : null;
const angle = (v: XY | null) => unit(v) ? Math.atan2(v!.y, v!.x) * 180 / Math.PI : null;
const relativeAngle = (v: XY | null, axis: XY | null) => shortestAngleDeg(angle(v), angle(axis));
export const safeRatio = (a: number | null, b: number | null) => a === null || b === null || b === 0 ? null : a / b;
const diff = (a: number | null, b: number | null) => a === null || b === null ? null : a - b;
const abs = (a: number | null) => a === null ? null : Math.abs(a);
function point(points: readonly ReplayPoint[], index: number, visibility: number) {
  const p = points[index];
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.visibility !== null && p.visibility >= visibility ? p : null;
}
export function bodyGeometry(points: readonly ReplayPoint[]) {
  const hl = point(points, 23, .7), hr = point(points, 24, .7), sl = point(points, 11, .5), sr = point(points, 12, .5);
  const pelvis = hl && hr ? sub(hr, hl) : null, eLat = unit(pelvis), eNorm = rot(eLat);
  const torso = hl && hr && sl && sr ? sub(center(sl, sr), center(hl, hr)) : null, eLong = unit(torso);
  let eSide = eLat && rot(eLong);
  if (eSide && dot(eSide, eLat)! < 0) eSide = { x: -eSide.x, y: -eSide.y };
  const side = (s: Limb) => {
    const h = s === 'LEFT' ? hl : hr, k = point(points, s === 'LEFT' ? 25 : 26, .5), v = h && k ? sub(k, h) : null;
    return { sameHipX: v?.x ?? null, sameHipY: v?.y ?? null, sameHipDistance: norm(v),
      pelvisLat: dot(v, eLat), pelvisNorm: dot(v, eNorm), torsoLong: eLat ? dot(v, eLong) : null, torsoSide: dot(v, eSide),
      sameHipVectorAngle: angle(v), pelvisRelativeAngle: relativeAngle(v, eLat), torsoRelativeAngle: eLat ? relativeAngle(v, eLong) : null };
  };
  return { LEFT: side('LEFT'), RIGHT: side('RIGHT'), torsoLength: norm(torso), shoulderWidth: sl && sr ? norm(sub(sr, sl)) : null,
    shoulderAxis: sl && sr ? angle(sub(sr, sl)) : null, pelvisAxis: angle(pelvis) };
}
type Geometry = ReturnType<typeof bodyGeometry>;
type RawSide = Geometry['LEFT'];
const RAW_KEYS = ['sameHipX', 'sameHipY', 'sameHipDistance', 'pelvisLat', 'pelvisNorm', 'torsoLong', 'torsoSide', 'sameHipVectorAngle', 'pelvisRelativeAngle', 'torsoRelativeAngle'] as const;
const DIAGNOSTIC_KEYS = ['torsoLength', 'shoulderWidth', 'shoulderAxis', 'pelvisAxis'] as const;
export function freezeBodyBaseline(frames: readonly Geometry[], bodyScale: number) {
  const reference = (key: string, values: (number | null)[]) => {
    const usable = values.filter((n): n is number => n !== null);
    return { value: key.includes('Angle') || key.includes('Axis') ? circularMeanDeg(usable) : median(usable), usable: usable.length };
  };
  const side = (s: Limb) => Object.fromEntries(RAW_KEYS.map((key) => [key, reference(key, frames.map((f) => f[s][key]))])) as Record<keyof RawSide, { value: number | null; usable: number }>;
  return { bodyScale: Number.isFinite(bodyScale) && bodyScale > 0 ? bodyScale : null, LEFT: side('LEFT'), RIGHT: side('RIGHT'),
    geometry: Object.fromEntries(DIAGNOSTIC_KEYS.map((key) => [key, reference(key, frames.map((f) => f[key]))])) as Record<typeof DIAGNOSTIC_KEYS[number], { value: number | null; usable: number }> };
}
export function decompose(left: number | null, right: number | null) {
  const common = left === null || right === null ? null : (left + right) / 2;
  const differential = left === null || right === null ? null : (left - right) / 2;
  return { common, differential, leftResidual: differential, rightResidual: differential === null ? null : -differential,
    absCommon: abs(common), absDiff: abs(differential), commonToDiffRatio: safeRatio(abs(common), abs(differential)), diffToCommonRatio: safeRatio(abs(differential), abs(common)) };
}
export function calibrateBodyGeometry(raw: Geometry, baseline: ReturnType<typeof freezeBodyBaseline>, oldY: Record<Limb, number | null>) {
  const side = (s: Limb) => {
    const r = raw[s], ref = baseline[s], delta = (key: keyof RawSide) => diff(r[key], ref[key].value);
    const normalized = (key: keyof RawSide) => safeRatio(delta(key), baseline.bodyScale);
    const px = normalized('pelvisLat'), py = normalized('pelvisNorm'), tx = normalized('torsoLong'), ty = normalized('torsoSide');
    return { ...r, sameHipDeltaX: delta('sameHipX'), sameHipDeltaY: delta('sameHipY'),
      sameHipDeltaXNorm: normalized('sameHipX'), sameHipDeltaYNorm: normalized('sameHipY'), sameHipDistanceDeltaNorm: normalized('sameHipDistance'),
      pelvisLatDeltaNorm: px, pelvisNormDeltaNorm: py, pelvis2D: px === null || py === null ? null : Math.hypot(px, py),
      torsoLongDeltaNorm: tx, torsoSideDeltaNorm: ty, torso2D: tx === null || ty === null ? null : Math.hypot(tx, ty),
      sameHipAngleDeltaDeg: shortestAngleDeg(r.sameHipVectorAngle, ref.sameHipVectorAngle.value),
      pelvisRelativeAngleDeltaDeg: shortestAngleDeg(r.pelvisRelativeAngle, ref.pelvisRelativeAngle.value),
      torsoRelativeAngleDeltaDeg: shortestAngleDeg(r.torsoRelativeAngle, ref.torsoRelativeAngle.value), oldY: oldY[s] };
  };
  const LEFT = side('LEFT'), RIGHT = side('RIGHT');
  return { LEFT, RIGHT, geometry: { torsoLength: raw.torsoLength, torsoLengthRatio: safeRatio(raw.torsoLength, baseline.geometry.torsoLength.value),
    shoulderWidth: raw.shoulderWidth, shoulderWidthRatio: safeRatio(raw.shoulderWidth, baseline.geometry.shoulderWidth.value),
    shoulderAxisDeltaDeg: shortestAngleDeg(raw.shoulderAxis, baseline.geometry.shoulderAxis.value), pelvisAxisDeltaDeg: shortestAngleDeg(raw.pelvisAxis, baseline.geometry.pelvisAxis.value) },
    bilateral: { oldY: decompose(oldY.LEFT, oldY.RIGHT), sameHip: decompose(LEFT.sameHipDeltaYNorm, RIGHT.sameHipDeltaYNorm),
      pelvis: decompose(LEFT.pelvisNormDeltaNorm, RIGHT.pelvisNormDeltaNorm), torso: decompose(LEFT.torsoLongDeltaNorm, RIGHT.torsoLongDeltaNorm) } };
}
export type BodyValues = ReturnType<typeof calibrateBodyGeometry>;
export const FEATURE_FAMILIES = ['SAME_HIP_Y', 'PELVIS_LOCAL_NORMAL', 'TORSO_LOCAL_LONG', 'PELVIS_LOCAL_2D', 'SAME_HIP_DISTANCE', 'PELVIS_DIFFERENTIAL', 'TORSO_DIFFERENTIAL', 'SAME_HIP_RESIDUAL'] as const;
export type FeatureFamily = typeof FEATURE_FAMILIES[number];
/** Signed displacement retained for temporal summaries; detection uses its magnitude. */
export function familySignal(v: BodyValues, side: Limb, family: FeatureFamily): number | null {
  switch (family) {
    case 'SAME_HIP_Y': return v[side].sameHipDeltaYNorm;
    case 'PELVIS_LOCAL_NORMAL': return v[side].pelvisNormDeltaNorm;
    case 'TORSO_LOCAL_LONG': return v[side].torsoLongDeltaNorm;
    case 'PELVIS_LOCAL_2D': return v[side].pelvis2D;
    case 'SAME_HIP_DISTANCE': return v[side].sameHipDistanceDeltaNorm;
    default: { const b = v.bilateral[family === 'PELVIS_DIFFERENTIAL' ? 'pelvis' : family === 'TORSO_DIFFERENTIAL' ? 'torso' : 'sameHip'];
      return side === 'LEFT' ? b.leftResidual : b.rightResidual; }
  }
}
export function flattenBodyValues(v: BodyValues) {
  const entries: [string, number | null][] = [];
  for (const s of LIMBS) {
    entries.push(...Object.entries(v[s]).map(([k, n]): [string, number | null] => [`${s}.${k}`, n]));
    for (const family of FEATURE_FAMILIES) entries.push([`${s}.evidence.${family}`, abs(familySignal(v, s, family))]);
    for (const key of ['pelvisLatDeltaNorm', 'torsoSideDeltaNorm'] as const) entries.push([`${s}.abs.${key}`, abs(v[s][key])]);
  }
  entries.push(...Object.entries(v.geometry).map(([k, n]): [string, number | null] => [`geometry.${k}`, n]));
  for (const [k, b] of Object.entries(v.bilateral)) entries.push(...Object.entries(b).map(([name, n]): [string, number | null] => [`bilateral.${k}.${name}`, n]));
  return Object.fromEntries(entries);
}
export function prepareBodyInputs(inputs: readonly BodyInput[]) {
  // No compatibility baseline for STRESS or any live role, even if its recording is legacy.
  for (const input of inputs) for (const trial of input.session.liveResult.trials)
    neutralCalibrationWindow(input.session, trial, input.role === 'REFERENCE_OLD_CLEAN' ? 'LATEST_FROZEN_OR_COMPATIBILITY' : 'LATEST_FROZEN');
  const mapped = inputs.map((i) => ({ ...i, role: (i.role === 'REFERENCE_LIVE_2' ? 'REFERENCE_LIVE_2_INDEPENDENT' : i.role === 'REFERENCE_LIVE_3' ? 'REFERENCE_LIVE_3_HOLDOUT_FAILURE' : i.role) as TwistRole }));
  // Existing preparation checks all LIVE event/time/summary/baseline/final-state parity before extraction.
  return prepareTwistInputs(mapped).map((reference) => {
    const input = inputs.find((i) => i.session.captureId === reference.input.captureId)!;
    const trial = input.session.liveResult.trials.find((t) => t.id === reference.input.trialId)!;
    const { frames, ...window } = neutralCalibrationWindow(input.session, trial, input.role === 'REFERENCE_OLD_CLEAN' ? 'LATEST_FROZEN_OR_COMPATIBILITY' : 'LATEST_FROZEN');
    const baseline = freezeBodyBaseline(frames.map((f) => bodyGeometry(f.landmarks)), reference.yBaseline.baseline.bodyScale);
    const raw = new Map(orderedFrames(input.session.poseFrames).map((f) => [f.tMs, f]));
    return { input: { ...reference.input, role: input.role }, reference, stages: reference.stages, baseline: { ...window, ...baseline },
      liveReplayParity: reference.liveReplayParity, frames: reference.frames.map((f) => ({ timestamp: f.timestamp, stageIndex: f.stageIndex, calibrationOnly: f.calibrationOnly,
        values: calibrateBodyGeometry(bodyGeometry(raw.get(f.timestamp)!.landmarks), baseline, { LEFT: f.measurements.LEFT.deltaDyNorm, RIGHT: f.measurements.RIGHT.deltaDyNorm }),
        visibility: { LEFT: f.measurements.LEFT.visibility, RIGHT: f.measurements.RIGHT.visibility } })) };
  });
}
export type BodyFixture = ReturnType<typeof prepareBodyInputs>[number];
export type BodyFrame = BodyFixture['frames'][number];
