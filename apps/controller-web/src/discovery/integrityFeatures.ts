import { LIMBS, median, type Limb } from './discoveryFeatures';
import { kneeAngle, neutralCalibrationWindow } from './multiSignalFeatures';
import { prepareMultiInputs, assertYReferenceParity, type PreparedMultiFixture } from './analyzeMultiSignal';
import { replayKneeKickV3 } from '../replay/kneeKickV3Replay';
import { orderedFrames, type CalibrationSelection } from '../replay/landmarkReplay';
import { KICK_STALE_MS } from '../pose/kick/kneeKickDetectorV3';
import type { ReplayPoint, ReplaySession, ReplayTrial } from '../replay/replayTypes';

export const INTEGRITY_ROLES = ['UNASSIGNED', 'REFERENCE_OLD_CLEAN', 'STRESS', 'REFERENCE_LIVE_1', 'REFERENCE_LIVE_2_INDEPENDENT', 'REFERENCE_LIVE_3_HOLDOUT'] as const;
export type IntegrityRole = typeof INTEGRITY_ROLES[number];
export interface IntegrityInput { filename: string; role: IntegrityRole; session: ReplaySession }
export const INTEGRITY_FEATURE_SETTINGS = {
  coordinates: 'normalized image XY; lengths are image units, not pixels or world units',
  imageGeometryVisibility: .5, velocityUnits: 'signed Y bodyScale/sec; knee relative 2D bodyScale/sec; signed angle deg/sec',
  velocity: 'adjacent recorded tMs; no missing/nonpositive dt/dt>=400ms bridging; labels do not reset velocity',
  neutral: 'same exact latest bounded Neutral window as STEP 4J; legacy first Neutral excluded; frozen per-segment usable medians',
  world: 'diagnostic only; same-side image visibility>=.5 plus finite world XYZ; optional world visibility, if present, >=.5',
  distribution: 'nearest-rank p05/p95, median averages middle two; report signed and absolute Y/angle velocities separately',
} as const;

function point(points: readonly ReplayPoint[], index: number, world = false) {
  const p = points[index];
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) && (!world || Number.isFinite(p.z)) &&
    (world && p.visibility === null || p.visibility !== null && Number.isFinite(p.visibility) && p.visibility >= .5) ? p : null;
}
const length = (a: ReplayPoint | null, b: ReplayPoint | null, world = false) => a && b ? Math.hypot(a.x - b.x, a.y - b.y, world ? a.z - b.z : 0) : null;
function worldAngle(h: ReplayPoint | null, k: ReplayPoint | null, a: ReplayPoint | null) {
  if (!h || !k || !a) return null;
  const hk = [h.x - k.x, h.y - k.y, h.z - k.z], ak = [a.x - k.x, a.y - k.y, a.z - k.z];
  const denom = Math.hypot(...hk) * Math.hypot(...ak);
  return denom > 1e-8 ? Math.acos(Math.max(-1, Math.min(1, hk.reduce((s, v, i) => s + v * ak[i], 0) / denom))) * 180 / Math.PI : null;
}
export function integrityGeometry(points: readonly ReplayPoint[], world: readonly ReplayPoint[], side: Limb) {
  const offset = side === 'LEFT' ? 0 : 1, h = point(points, 23 + offset), k = point(points, 25 + offset), a = point(points, 27 + offset);
  const wh = h && point(world, 23 + offset, true), wk = k && point(world, 25 + offset, true), wa = a && point(world, 27 + offset, true);
  const visibility = (i: number) => Number.isFinite(points[i]?.visibility) ? points[i].visibility : null;
  return { hipKneeLength: length(h, k), kneeAnkleLength: length(k, a), kneeAngle: kneeAngle(points, side),
    worldHipKneeLength: length(wh, wk, true), worldKneeAnkleLength: length(wk, wa, true), worldKneeAngle: worldAngle(wh, wk, wa),
    visibility: { hip: visibility(23 + offset), otherHip: visibility(24 - offset), knee: visibility(25 + offset), ankle: visibility(27 + offset) } };
}
export function segmentBaseline(session: ReplaySession, trial: ReplayTrial, selection: CalibrationSelection = 'LATEST_START') {
  const { frames, ...window } = neutralCalibrationWindow(session, trial, selection);
  const side = (limb: Limb) => {
    const raw = frames.map((f) => integrityGeometry(f.landmarks, f.worldLandmarks, limb));
    const summary = (key: 'hipKneeLength' | 'kneeAnkleLength') => {
      const values = raw.map((f) => f[key]).filter((v): v is number => v !== null);
      const value = median(values); return { median: value !== null && value > 1e-8 ? value : null, usableFrames: values.length };
    };
    return { hipKnee: summary('hipKneeLength'), kneeAnkle: summary('kneeAnkleLength') };
  };
  return { ...window, LEFT: side('LEFT'), RIGHT: side('RIGHT') };
}
export function integrityVelocity(current: number | null, previous: number | null, dt: number) {
  return current !== null && previous !== null && dt > 0 && dt < KICK_STALE_MS ? (current - previous) * 1000 / dt : null;
}
type BaseFrame = PreparedMultiFixture['frames'][number];
type Geometry = ReturnType<typeof integrityGeometry>;
export interface IntegrityMeasurement extends Geometry {
  deltaDyNorm: number | null; deltaDyNormVelocity: number | null;
  kneeRelativeX: number | null; kneeRelativeY: number | null;
  kneeRelativeXNorm: number | null; kneeRelativeYNorm: number | null; kneeCenterRelative2DVelocity: number | null;
  hipKneeRatio: number | null; kneeAnkleRatio: number | null; kneeAngleVelocity: number | null;
  trackingState: string; candidateRunMs: number;
}
export type IntegrityFrame = BaseFrame & { measurements: Record<Limb, IntegrityMeasurement> };
function calibrationSelection(input: IntegrityInput, latestFrozen: boolean): CalibrationSelection {
  return input.role === 'REFERENCE_LIVE_3_HOLDOUT' ? 'LATEST_FROZEN' : latestFrozen ? 'LATEST_FROZEN_OR_COMPATIBILITY' : 'LATEST_START';
}
function prepareOne(input: IntegrityInput, multi: PreparedMultiFixture, latestFrozen = false) {
  const trial = input.session.liveResult.trials.find((t) => t.id === multi.input.trialId)!;
  const selection = calibrationSelection(input, latestFrozen);
  const baseline = segmentBaseline(input.session, trial, selection), production = replayKneeKickV3(input.session, trial.id, selection);
  const rawByTime = new Map(orderedFrames(input.session.poseFrames).map((f) => [f.tMs, f]));
  const diagByTime = new Map(production.diagnostics.map((d) => [d.timestamp, d]));
  let previous: IntegrityFrame | null = null;
  const frames = multi.frames.map((f): IntegrityFrame => {
    const raw = rawByTime.get(f.timestamp)!, diag = diagByTime.get(f.timestamp)!;
    const measure = (side: Limb): IntegrityMeasurement => {
      const left = side === 'LEFT', knee = raw.landmarks[left ? 25 : 26];
      const y = left ? diag.normalizedYLeft : diag.normalizedYRight;
      const x = left ? diag.normalizedXLeft : diag.normalizedXRight;
      const relativeX = x !== null ? knee.x - (raw.landmarks[23].x + raw.landmarks[24].x) / 2 : null;
      const relativeY = y !== null ? knee.y - (raw.landmarks[23].y + raw.landmarks[24].y) / 2 : null;
      const scale = multi.yBaseline.baseline.bodyScale;
      const xNorm = relativeX === null ? null : relativeX / scale, yNorm = relativeY === null ? null : relativeY / scale;
      const before = previous?.measurements[side], dt = previous ? f.timestamp - previous.timestamp : 0;
      const vx = integrityVelocity(xNorm, before?.kneeRelativeXNorm ?? null, dt), vy = integrityVelocity(yNorm, before?.kneeRelativeYNorm ?? null, dt);
      const geometry = integrityGeometry(raw.landmarks, raw.worldLandmarks, side);
      const ratio = (value: number | null, median: number | null) => value !== null && median !== null ? value / median : null;
      return { ...geometry, deltaDyNorm: y, deltaDyNormVelocity: integrityVelocity(y, before?.deltaDyNorm ?? null, dt),
        kneeRelativeX: relativeX, kneeRelativeY: relativeY, kneeRelativeXNorm: xNorm, kneeRelativeYNorm: yNorm,
        kneeCenterRelative2DVelocity: vx !== null && vy !== null ? Math.hypot(vx, vy) : null,
        hipKneeRatio: ratio(geometry.hipKneeLength, baseline[side].hipKnee.median), kneeAnkleRatio: ratio(geometry.kneeAnkleLength, baseline[side].kneeAnkle.median),
        kneeAngleVelocity: integrityVelocity(geometry.kneeAngle, before?.kneeAngle ?? null, dt),
        trackingState: left ? diag.leftTrackingState : diag.rightTrackingState, candidateRunMs: left ? diag.leftEnterRunMs : diag.rightEnterRunMs };
    };
    const current = { ...f, measurements: { LEFT: measure('LEFT'), RIGHT: measure('RIGHT') } }; previous = current; return current;
  });
  return { ...multi, input: { ...multi.input, role: input.role }, frames, segmentBaseline: baseline, production };
}
export type IntegrityFixture = ReturnType<typeof prepareOne>;
export function prepareIntegrityInputs(inputs: readonly IntegrityInput[], latestFrozen = false): IntegrityFixture[] {
  const multi = prepareMultiInputs(inputs.map((i) => ({ ...i, calibrationSelection: calibrationSelection(i, latestFrozen), role: i.role.startsWith('REFERENCE_LIVE') ? 'REFERENCE_LIVE' : i.role as 'UNASSIGNED' | 'REFERENCE_OLD_CLEAN' | 'STRESS' })));
  assertYReferenceParity(multi);
  return multi.map((m) => prepareOne(inputs.find((i) => i.session.captureId === m.input.captureId)!, m, latestFrozen));
}
export function distribution(values: readonly (number | null)[]) {
  const sorted = values.filter((n): n is number => n !== null && Number.isFinite(n)).sort((a, b) => a - b);
  const percentile = (q: number) => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] : null;
  return { frames: values.length, usable: sorted.length, coverage: values.length ? sorted.length / values.length : null,
    min: sorted[0] ?? null, p05: percentile(.05), median: median(sorted), p95: percentile(.95), max: sorted.at(-1) ?? null };
}
export function integrityDistributions(fixture: IntegrityFixture) {
  const groups = [{ name: 'ALL_EVALUATED', index: null }, ...fixture.stages.map((s) => ({ name: `${s.stageIndex}/${s.expected}`, index: s.stageIndex }))];
  return groups.flatMap((g) => LIMBS.map((side) => {
    const rows = fixture.frames.filter((f) => !f.calibrationOnly && f.stageIndex !== null && (g.index === null || f.stageIndex === g.index)).map((f) => f.measurements[side]);
    const stat = (key: keyof Omit<IntegrityMeasurement, 'visibility' | 'trackingState'>, abs = false) => distribution(rows.map((r) => r[key] === null ? null : abs ? Math.abs(r[key]!) : r[key]));
    return { group: g.name, side, y: stat('deltaDyNorm'), yVelocity: stat('deltaDyNormVelocity'), absYVelocity: stat('deltaDyNormVelocity', true),
      knee2DVelocity: stat('kneeCenterRelative2DVelocity'), hipKneeLength: stat('hipKneeLength'), kneeAnkleLength: stat('kneeAnkleLength'),
      hipKneeRatio: stat('hipKneeRatio'), kneeAnkleRatio: stat('kneeAnkleRatio'), angle: stat('kneeAngle'), angleVelocity: stat('kneeAngleVelocity'), absAngleVelocity: stat('kneeAngleVelocity', true),
      worldHipKneeLength: stat('worldHipKneeLength'), worldKneeAnkleLength: stat('worldKneeAnkleLength'), worldKneeAngle: stat('worldKneeAngle') };
  }));
}
