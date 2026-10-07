import type { GeometryFrame } from './geometryReliabilityFeatures';
import { LIMBS, type Limb } from './discoveryFeatures';
import { FIXED_FLEXION_CONFIG, type IntegrityEntryGuard } from './integrityGuard';
import { Y_KICK_ENTER } from '../pose/kick/kneeKickDetectorV3';

export const RELIABILITY_CUTS = { segment: [.15, .25, .35, .50], projection: [.20, .35, .50, .75], swap: [0, .10, .20, .30], axisVelocity: [90, 180, 360, 720], worldMotion: [.15, .25, .35, .50, .75, 1] } as const;
export type ReliabilityFamily = 'IMAGE_SEGMENT_INSTABILITY' | 'WORLD_SEGMENT_INSTABILITY' | 'IMAGE_WORLD_PROJECTION_DISAGREEMENT' | 'IDENTITY_CONTINUITY' | 'AXIS_DEGENERACY';
export interface ReliabilityMarker { family: ReliabilityFamily; threshold: number }
export interface QualityGateConfig { id: string; markers: ReliabilityMarker[] }
export function reliabilityMarkers(): ReliabilityMarker[] {
  return [
    ...(['IMAGE_SEGMENT_INSTABILITY', 'WORLD_SEGMENT_INSTABILITY'] as const).flatMap((family) => RELIABILITY_CUTS.segment.map((threshold) => ({ family, threshold }))),
    ...RELIABILITY_CUTS.projection.map((threshold) => ({ family: 'IMAGE_WORLD_PROJECTION_DISAGREEMENT' as const, threshold })),
    ...RELIABILITY_CUTS.swap.map((threshold) => ({ family: 'IDENTITY_CONTINUITY' as const, threshold })),
    ...RELIABILITY_CUTS.axisVelocity.map((threshold) => ({ family: 'AXIS_DEGENERACY' as const, threshold })),
  ];
}
export const markerId = (m: ReliabilityMarker) => `${m.family}/${m.threshold}`;
export function qualityGateConfigs(): QualityGateConfig[] {
  const singles = reliabilityMarkers().filter((m) => m.family !== 'IMAGE_SEGMENT_INSTABILITY').map((m) => ({ id: markerId(m), markers: [m] }));
  // Two declared OR families, four aligned profiles each; no Cartesian product or outcome-selected thresholds.
  const combined = RELIABILITY_CUTS.segment.flatMap((threshold, i) => (['IMAGE_WORLD_PROJECTION_DISAGREEMENT', 'IDENTITY_CONTINUITY'] as const).map((family) => {
    const markers: ReliabilityMarker[] = [{ family: 'WORLD_SEGMENT_INSTABILITY', threshold }, { family, threshold: family === 'IDENTITY_CONTINUITY' ? RELIABILITY_CUTS.swap[i] : RELIABILITY_CUTS.projection[i] }];
    return { id: markers.map(markerId).join(' OR '), markers };
  }));
  return [...singles, ...combined];
}
export function nullableOr(values: readonly (boolean | null)[]) {
  return values.some((v) => v === true) ? true : values.every((v) => v === false) ? false : null;
}
export function markerDecision(frame: GeometryFrame, side: Limb, marker: ReliabilityMarker) {
  const limb = side === 'LEFT' ? 'left' : 'right', v = frame.values;
  let keys: string[];
  switch (marker.family) {
    case 'IMAGE_SEGMENT_INSTABILITY': keys = [`image.${limb}HipKneeRatioDeviation`, `image.${limb}KneeAnkleRatioDeviation`]; break;
    case 'WORLD_SEGMENT_INSTABILITY': keys = [`world.${limb}HipKneeRatioDeviation`, `world.${limb}KneeAnkleRatioDeviation`]; break;
    case 'IMAGE_WORLD_PROJECTION_DISAGREEMENT': keys = [`projection.${limb}HipKneeDeviation`, `projection.${limb}KneeAnkleDeviation`]; break;
    case 'IDENTITY_CONTINUITY': keys = ['image.swapAdvantage', 'world.swapAdvantage']; break;
    case 'AXIS_DEGENERACY': keys = ['image.pelvisAxisAngularVelocity', 'image.torsoAxisAngularVelocity']; break;
  }
  const observations = keys.map((key) => ({ feature: key, value: v[key] ?? null }));
  const flags = observations.map(({ value }) => value === null ? null : marker.family === 'IDENTITY_CONTINUITY' ? value > marker.threshold :
    (marker.family === 'AXIS_DEGENERACY' ? Math.abs(value) : value) >= marker.threshold);
  if (marker.family === 'AXIS_DEGENERACY') flags.push(frame.flags['image.pelvisNumericDegeneracy'], frame.flags['image.torsoNumericDegeneracy']);
  return { ...marker, decision: nullableOr(flags), observations };
}
export function descriptiveCategories(frame: GeometryFrame, side: Limb, profile: number) {
  if (!Number.isInteger(profile) || profile < 0 || profile > 3) throw new Error('Unknown reliability profile');
  const limb = side === 'LEFT' ? 'left' : 'right';
  const markers = [
    { family: 'WORLD_SEGMENT_INSTABILITY' as const, threshold: RELIABILITY_CUTS.segment[profile] },
    { family: 'IMAGE_WORLD_PROJECTION_DISAGREEMENT' as const, threshold: RELIABILITY_CUTS.projection[profile] },
    { family: 'IDENTITY_CONTINUITY' as const, threshold: RELIABILITY_CUTS.swap[profile] },
    { family: 'AXIS_DEGENERACY' as const, threshold: RELIABILITY_CUTS.axisVelocity[profile] },
  ].map((m) => markerDecision(frame, side, m));
  const labels: string[] = [];
  if (markers[0].decision) labels.push('WORLD_GEOMETRY_INSTABILITY_SUSPECT');
  if (markers[1].decision || markers[3].decision) labels.push('IMAGE_PROJECTION_SUSPECT');
  if (markers[2].decision) labels.push('IDENTITY_CONTINUITY_SUSPECT');
  if (frame.values[`image.${limb}HipKneeLength`] === null || frame.values[`world.${limb}HipKneeLength`] === null || markers.some((m) => m.decision === null)) labels.push('LOW_OBSERVABILITY');
  if (markers.every((m) => m.decision === false)) labels.push('NO_CLEAR_GEOMETRY_FAILURE');
  return { labels, markers };
}
/** Only current eligible entry; no mid-run cancellation, latching, rebaseline or altered integrity recovery. */
export class GeometryEntryGuard {
  readonly observations: { timestamp: number; side: Limb; stageIndex: number | null; decision: boolean | null; activation: boolean; markers: ReturnType<typeof markerDecision>[] }[] = [];
  private blockedBefore = new Set<Limb>();
  constructor(private frames: ReadonlyMap<number, GeometryFrame>, readonly config: QualityGateConfig) {}
  evaluate: IntegrityEntryGuard = (frame, context, integrityBlocked) => {
    const geometry = this.frames.get(frame.timestamp);
    if (!geometry) throw new Error('Missing STEP4N geometry for an observed frame');
    const blocked = new Set<Limb>();
    for (const side of LIMBS) {
      const c = context.sides[side];
      const continuing = c.runs.Y !== null && frame[side].Y !== null && frame[side].Y >= Y_KICK_ENTER ||
        c.runs.FLEXION !== null && frame[side].FLEXION !== null && frame[side].FLEXION >= FIXED_FLEXION_CONFIG.flexEnter;
      if (integrityBlocked.includes(side) || !c.entryChannels.length || continuing) continue;
      const markers = this.config.markers.map((m) => markerDecision(geometry, side, m)), decision = nullableOr(markers.map((m) => m.decision));
      if (decision === true) blocked.add(side);
      this.observations.push({ timestamp: frame.timestamp, stageIndex: frame.stageIndex, side, decision, activation: decision === true && !this.blockedBefore.has(side), markers });
    }
    this.blockedBefore = blocked; return [...blocked];
  };
}
