import type { ReplayPoint } from '../replay/replayTypes';
import { orderedFrames } from '../replay/landmarkReplay';
import { neutralCalibrationWindow } from './multiSignalFeatures';
import { LIMBS, median, type Limb } from './discoveryFeatures';
import { AXIS_EPSILON, BODY_STALE_MS, prepareBodyInputs, type BodyInput } from './bodyLocalFeatures';
import { shortestAngleDeg } from './twistConfusionFeatures';

export const GEOMETRY_STATUS = 'POST_FAILURE_EXPLORATORY' as const;
export const GEOMETRY_JOINTS = { leftHip: [23, .7], rightHip: [24, .7], leftKnee: [25, .5], rightKnee: [26, .5], leftAnkle: [27, .5], rightAnkle: [28, .5], leftShoulder: [11, .5], rightShoulder: [12, .5] } as const;
export const SEGMENTS = ['leftHipKnee', 'rightHipKnee', 'leftKneeAnkle', 'rightKneeAnkle', 'pelvis', 'shoulder', 'torso'] as const;
type Joint = keyof typeof GEOMETRY_JOINTS;
type Segment = typeof SEGMENTS[number];
export type Vector3 = { x: number; y: number; z: number };
const subtract = (a: Vector3 | null, b: Vector3 | null): Vector3 | null => a && b ? { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z } : null;
const center = (a: Vector3 | null, b: Vector3 | null): Vector3 | null => a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 } : null;
export const vectorLength = (v: Vector3 | null) => v ? Math.hypot(v.x, v.y, v.z) : null;
const distance = (a: Vector3 | null, b: Vector3 | null) => vectorLength(subtract(a, b));
export const vectorDot = (a: Vector3 | null, b: Vector3 | null) => a && b ? a.x * b.x + a.y * b.y + a.z * b.z : null;
const unit = (v: Vector3 | null): Vector3 | null => v && vectorLength(v)! >= AXIS_EPSILON ? { x: v.x / vectorLength(v)!, y: v.y / vectorLength(v)!, z: v.z / vectorLength(v)! } : null;
const cross = (a: Vector3, b: Vector3): Vector3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const geometryRatio = (a: number | null, b: number | null): number | null => a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b) && b > AXIS_EPSILON ? a / b : null;
const delta = (a: number | null, b: number | null) => a === null || b === null ? null : a - b;
const deviation = (v: number | null) => v === null ? null : Math.abs(v - 1);
const absolute = (v: number | null) => v === null ? null : Math.abs(v);
function validPoint(p: ReplayPoint | undefined, threshold: number, world = false): Vector3 | null {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) && (!world || Number.isFinite(p.z)) &&
    (world && p.visibility === null || p.visibility !== null && Number.isFinite(p.visibility) && p.visibility >= threshold) ? { x: p.x, y: p.y, z: world ? p.z : 0 } : null;
}
/** Deterministic right-handed body frame: anatomical HL->HR, orthogonal shoulder-center direction, cross(lat,long).
 * No temporal flips or front/back semantics; actual orientation jumps remain observable. */
export function worldBodyAxes(hl: Vector3 | null, hr: Vector3 | null, sl: Vector3 | null, sr: Vector3 | null) {
  const eLat = unit(subtract(hr, hl)), rawLong = subtract(center(sl, sr), center(hl, hr));
  const component = vectorDot(rawLong, eLat);
  const orth = rawLong && eLat && component !== null ? { x: rawLong.x - component * eLat.x, y: rawLong.y - component * eLat.y, z: rawLong.z - component * eLat.z } : null;
  const eLong = unit(orth), eDepth = eLat && eLong ? unit(cross(eLat, eLong)) : null;
  return eLat && eLong && eDepth ? { eLat, eLong, eDepth } : null;
}
function spaceGeometry(points: Record<Joint, Vector3 | null>) {
  const p = points, hc = center(p.leftHip, p.rightHip), sc = center(p.leftShoulder, p.rightShoulder), pelvis = subtract(p.rightHip, p.leftHip), torso = subtract(sc, hc);
  const lateral = unit(pelvis), axes = worldBodyAxes(p.leftHip, p.rightHip, p.leftShoulder, p.rightShoulder);
  const side = (s: Limb) => {
    const h = s === 'LEFT' ? p.leftHip : p.rightHip, k = s === 'LEFT' ? p.leftKnee : p.rightKnee;
    const v = subtract(k, h);
    return { vector: v, relativeToCenter: subtract(k, hc), local: { lat: axes ? vectorDot(v, axes.eLat) : null, long: axes ? vectorDot(v, axes.eLong) : null, depth: axes ? vectorDot(v, axes.eDepth) : null } };
  };
  const axisAngle = (v: Vector3 | null) => v && Math.hypot(v.x, v.y) >= AXIS_EPSILON ? Math.atan2(v.y, v.x) * 180 / Math.PI : null;
  return { points, axes, segments: { leftHipKnee: distance(p.leftHip, p.leftKnee), rightHipKnee: distance(p.rightHip, p.rightKnee),
    leftKneeAnkle: distance(p.leftKnee, p.leftAnkle), rightKneeAnkle: distance(p.rightKnee, p.rightAnkle), pelvis: vectorLength(pelvis), shoulder: distance(p.leftShoulder, p.rightShoulder), torso: vectorLength(torso) },
    LEFT: side('LEFT'), RIGHT: side('RIGHT'), kneePairDistance: distance(p.leftKnee, p.rightKnee), anklePairDistance: distance(p.leftAnkle, p.rightAnkle),
    sideOrdering: vectorDot(subtract(p.rightKnee, p.leftKnee), lateral), pelvisAxis: axisAngle(pelvis), torsoAxis: axisAngle(torso),
    depth: { knee: p.leftKnee && p.rightKnee ? p.leftKnee.z - p.rightKnee.z : null, ankle: p.leftAnkle && p.rightAnkle ? p.leftAnkle.z - p.rightAnkle.z : null,
      hip: p.leftHip && p.rightHip ? p.leftHip.z - p.rightHip.z : null } };
}
export function rawReliabilityGeometry(image: readonly ReplayPoint[], world: readonly ReplayPoint[]) {
  const joints = Object.keys(GEOMETRY_JOINTS) as Joint[];
  const imagePoints = Object.fromEntries(joints.map((j) => { const [i, limit] = GEOMETRY_JOINTS[j]; return [j, validPoint(image[i], limit)]; })) as Record<Joint, Vector3 | null>;
  const worldPoints = Object.fromEntries(joints.map((j) => { const [i, limit] = GEOMETRY_JOINTS[j]; return [j, imagePoints[j] ? validPoint(world[i], limit, true) : null]; })) as Record<Joint, Vector3 | null>;
  const visibility = Object.fromEntries(joints.flatMap((j) => { const [i] = GEOMETRY_JOINTS[j];
    return [[`${j}Visibility`, Number.isFinite(image[i]?.visibility) ? image[i].visibility : null], [`${j}WorldVisibility`, Number.isFinite(world[i]?.visibility) ? world[i].visibility : null]];
  })) as Record<string, number | null>;
  return { image: spaceGeometry(imagePoints), world: spaceGeometry(worldPoints), visibility };
}
export type RawReliabilityGeometry = ReturnType<typeof rawReliabilityGeometry>;
const usableMedian = (values: (number | null)[], positive = false) => {
  const usable = values.filter((v): v is number => v !== null && Number.isFinite(v) && (!positive || v > AXIS_EPSILON));
  return { median: median(usable), usable: usable.length };
};
export function freezeGeometryBaseline(frames: readonly RawReliabilityGeometry[], bodyScale: number) {
  const space = (key: 'image' | 'world') => {
    const side = (s: Limb) => ({ vector: Object.fromEntries((['x', 'y', 'z'] as const).map((a) => [a, usableMedian(frames.map((f) => f[key][s].vector?.[a] ?? null))])) as Record<'x' | 'y' | 'z', ReturnType<typeof usableMedian>>,
      local: Object.fromEntries((['lat', 'long', 'depth'] as const).map((a) => [a, usableMedian(frames.map((f) => f[key][s].local[a]))])) as Record<'lat' | 'long' | 'depth', ReturnType<typeof usableMedian>> });
    return { segments: Object.fromEntries(SEGMENTS.map((k) => [k, usableMedian(frames.map((f) => f[key].segments[k]), true)])) as Record<Segment, ReturnType<typeof usableMedian>>,
      LEFT: side('LEFT'), RIGHT: side('RIGHT'), sideOrdering: usableMedian(frames.map((f) => f[key].sideOrdering)),
      depth: Object.fromEntries((['knee', 'ankle', 'hip'] as const).map((k) => [k, usableMedian(frames.map((f) => f[key].depth[k]))])) as Record<'knee' | 'ankle' | 'hip', ReturnType<typeof usableMedian>> };
  };
  const image = space('image'), world = space('world');
  return { bodyScale: Number.isFinite(bodyScale) && bodyScale > AXIS_EPSILON ? bodyScale : null, image, world,
    worldLegScale: usableMedian([world.segments.leftHipKnee.median, world.segments.rightHipKnee.median], true).median,
    worldLegScaleDefinition: 'median of usable LEFT/RIGHT frozen Neutral hip-knee 3D medians; never a current-frame scale' };
}
export type GeometryBaseline = ReturnType<typeof freezeGeometryBaseline>;
export function continuityDelta(current: number | null, previous: number | null, dtMs: number) {
  return current !== null && previous !== null && dtMs > 0 && dtMs < BODY_STALE_MS ? current - previous : null;
}
export function assignmentContinuity(current: RawReliabilityGeometry['image'], previous: RawReliabilityGeometry['image'] | null, scale: number | null, dtMs: number) {
  const c = [current.LEFT.relativeToCenter, current.RIGHT.relativeToCenter], p = previous && [previous.LEFT.relativeToCenter, previous.RIGHT.relativeToCenter];
  if (!p || !c.every(Boolean) || !p.every(Boolean) || dtMs <= 0 || dtMs >= BODY_STALE_MS) return { same: null, swapped: null, advantage: null };
  const same = geometryRatio(distance(c[0], p[0])! + distance(c[1], p[1])!, scale), swapped = geometryRatio(distance(c[0], p[1])! + distance(c[1], p[0])!, scale);
  return { same, swapped, advantage: delta(same, swapped) };
}
function magnitude(values: (number | null)[]) { return values.every((v) => v !== null) ? Math.hypot(...values as number[]) : null; }
export function measureReliabilityFrame(raw: RawReliabilityGeometry, baseline: GeometryBaseline, previous: { raw: RawReliabilityGeometry; values: Record<string, number | null>; timestamp: number } | null, timestamp: number) {
  const values: Record<string, number | null> = { ...raw.visibility }, dt = previous ? timestamp - previous.timestamp : 0;
  const flags: Record<string, boolean | null> = {};
  for (const space of ['image', 'world'] as const) {
    const scale = space === 'image' ? baseline.bodyScale : baseline.worldLegScale;
    for (const segment of SEGMENTS) {
      const key = `${space}.${segment}`, length = raw[space].segments[segment], ratio = geometryRatio(length, baseline[space].segments[segment].median);
      values[`${key}Length`] = length; values[`${key}Ratio`] = ratio; values[`${key}RatioDeviation`] = deviation(ratio);
      const d = continuityDelta(ratio, previous?.values[`${key}Ratio`] ?? null, dt);
      values[`${key}DeltaRatio`] = d; values[`${key}RatioVelocityPerSec`] = d === null ? null : d * 1000 / dt;
    }
    for (const pair of ['knee', 'ankle'] as const) values[`${space}.${pair}PairDistanceNorm`] = geometryRatio(raw[space][`${pair}PairDistance`], scale);
    values[`${space}.sideOrdering`] = raw[space].sideOrdering;
    values[`${space}.sideOrderingNorm`] = geometryRatio(raw[space].sideOrdering, scale);
    values[`${space}.sideOrderingDeltaNorm`] = geometryRatio(delta(raw[space].sideOrdering, baseline[space].sideOrdering.median), scale);
    const order = raw[space].sideOrdering, refOrder = baseline[space].sideOrdering.median;
    flags[`${space}.orderingSignInverted`] = order === null || refOrder === null || order === 0 || refOrder === 0 ? null : Math.sign(order) !== Math.sign(refOrder);
    const costs = assignmentContinuity(raw[space], previous?.raw[space] ?? null, scale, dt);
    values[`${space}.sameAssignmentCost`] = costs.same; values[`${space}.swappedAssignmentCost`] = costs.swapped; values[`${space}.swapAdvantage`] = costs.advantage;
    for (const side of LIMBS) {
      const v = raw[space][side].vector, b = baseline[space][side];
      for (const a of ['x', 'y', 'z'] as const) {
        values[`${side}.${space}SameHip${a.toUpperCase()}`] = v?.[a] ?? null;
        values[`${side}.${space}SameHipDelta${a.toUpperCase()}`] = delta(v?.[a] ?? null, b.vector[a].median);
        values[`${side}.${space}SameHipDelta${a.toUpperCase()}Norm`] = geometryRatio(values[`${side}.${space}SameHipDelta${a.toUpperCase()}`], scale);
      }
      values[`${side}.${space}MovementMagnitude`] = magnitude(['X', 'Y', 'Z'].map((a) => values[`${side}.${space}SameHipDelta${a}Norm`]));
      if (space === 'world') {
        values[`${side}.worldSameHipDeltaMagnitude`] = values[`${side}.worldMovementMagnitude`];
        for (const a of ['lat', 'long', 'depth'] as const) {
          const title = a[0].toUpperCase() + a.slice(1);
          values[`${side}.world${title}`] = raw.world[side].local[a];
          values[`${side}.deltaWorld${title}`] = delta(raw.world[side].local[a], b.local[a].median);
          values[`${side}.deltaWorld${title}Norm`] = geometryRatio(values[`${side}.deltaWorld${title}`], baseline.worldLegScale);
        }
        values[`${side}.worldLocal3DMagnitude`] = magnitude(['Lat', 'Long', 'Depth'].map((a) => values[`${side}.deltaWorld${a}Norm`]));
      }
    }
  }
  for (const segment of SEGMENTS) {
    const ratio = geometryRatio(values[`image.${segment}Ratio`], values[`world.${segment}Ratio`]);
    values[`projection.${segment}RelativeRatio`] = ratio; values[`projection.${segment}Deviation`] = deviation(ratio);
  }
  for (const axis of ['pelvis', 'torso'] as const) {
    values[`image.${axis}LengthNorm`] = geometryRatio(raw.image.segments[axis], baseline.bodyScale);
    const deg = raw.image[`${axis}Axis`]; values[`image.${axis}AxisDeg`] = deg;
    const d = dt > 0 && dt < BODY_STALE_MS ? shortestAngleDeg(deg, previous?.values[`image.${axis}AxisDeg`] ?? null) : null;
    values[`image.${axis}AxisAngularVelocity`] = d === null ? null : d * 1000 / dt;
    flags[`image.${axis}NumericDegeneracy`] = raw.image.segments[axis] === null ? null : raw.image.segments[axis]! < AXIS_EPSILON;
  }
  for (const part of ['knee', 'ankle', 'hip'] as const) {
    values[`world.${part}DepthDifference`] = raw.world.depth[part];
    values[`world.${part}DepthDelta`] = delta(raw.world.depth[part], baseline.world.depth[part].median);
    values[`world.${part}DepthSeparation`] = absolute(raw.world.depth[part]);
  }
  for (const pair of ['knee', 'ankle'] as const) values[`projection.${pair}PairRatio`] = geometryRatio(values[`image.${pair}PairDistanceNorm`], values[`world.${pair}PairDistanceNorm`]);
  for (const side of LIMBS) {
    values[`${side}.imageVsWorldMovementRatio`] = geometryRatio(values[`${side}.imageMovementMagnitude`], values[`${side}.worldMovementMagnitude`]);
    const a = continuityDelta(values[`${side}.imageMovementMagnitude`], previous?.values[`${side}.imageMovementMagnitude`] ?? null, dt), b = continuityDelta(values[`${side}.worldMovementMagnitude`], previous?.values[`${side}.worldMovementMagnitude`] ?? null, dt);
    flags[`${side}.motionMagnitudeIncreaseAgreement`] = a === null || b === null || a === 0 || b === 0 ? null : Math.sign(a) === Math.sign(b);
  }
  return { timestamp, raw, values, flags };
}
export function prepareGeometryInputs(inputs: readonly BodyInput[]) {
  const bases = prepareBodyInputs(inputs); // All LIVE parity/baseline gates finish before any 4N measurement.
  return bases.map((base) => {
    const input = inputs.find((i) => i.session.captureId === base.input.captureId)!, trial = input.session.liveResult.trials.find((t) => t.id === base.input.trialId)!;
    const { frames: neutral, ...window } = neutralCalibrationWindow(input.session, trial, input.role === 'REFERENCE_OLD_CLEAN' ? 'LATEST_FROZEN_OR_COMPATIBILITY' : 'LATEST_FROZEN');
    const baseline = { ...window, ...freezeGeometryBaseline(neutral.map((f) => rawReliabilityGeometry(f.landmarks, f.worldLandmarks)), base.baseline.bodyScale ?? NaN) };
    const rawByTime = new Map(orderedFrames(input.session.poseFrames).map((f) => [f.tMs, f]));
    let previous: ReturnType<typeof measureReliabilityFrame> | null = null;
    const frames = base.reference.frames.map((f) => {
      const recorded = rawByTime.get(f.timestamp)!, measured = measureReliabilityFrame(rawReliabilityGeometry(recorded.landmarks, recorded.worldLandmarks), baseline, previous, f.timestamp);
      previous = measured;
      const values: Record<string, number | null> = { ...measured.values, 'LEFT.Y': f.LEFT.Y, 'RIGHT.Y': f.RIGHT.Y, 'LEFT.flexion': f.LEFT.FLEXION, 'RIGHT.flexion': f.RIGHT.FLEXION };
      return { timestamp: f.timestamp, stageIndex: f.stageIndex, calibrationOnly: f.calibrationOnly, values, flags: measured.flags };
    });
    return { input: base.input, baseline, liveReplayParity: base.liveReplayParity, stages: base.stages, reference: base.reference, frames };
  });
}
export type GeometryFixture = ReturnType<typeof prepareGeometryInputs>[number];
export type GeometryFrame = GeometryFixture['frames'][number];
