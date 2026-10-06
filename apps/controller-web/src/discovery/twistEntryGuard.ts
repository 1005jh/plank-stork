import { LIMBS, type Limb } from './discoveryFeatures';
import { measuredTwistFrame, type TwistValues } from './twistConfusionFeatures';
import { FIXED_FLEXION_CONFIG, type IntegrityEntryGuard } from './integrityGuard';
import { Y_KICK_ENTER } from '../pose/kick/kneeKickDetectorV3';

export type TwistGuardType = 'HIP_DEPTH' | 'HIP_MOTION' | 'BILATERAL_Y' | 'HIP_DEPTH_AND_BILATERAL_Y' | 'HIP_MOTION_AND_BILATERAL_Y';
export interface TwistGuardConfig { guardType: TwistGuardType; hipThreshold: number | null; symmetryThreshold: number | null }
// Bounded exploratory grid, considered only AFTER feature distributions are produced.
// None of these values changes the registered velocity12 or fixed flexion candidate.
export const TWIST_SWEEP = { hip: [.5, .75, 1, 1.25, 1.5, 2], symmetry: [.35, .5, .65, .8],
  combinedHip: [.75, 1.25, 2], combinedSymmetry: [.5, .8] } as const;
export function twistGuardConfigs(): TwistGuardConfig[] {
  return [
    ...(['HIP_DEPTH', 'HIP_MOTION'] as const).flatMap((guardType) => TWIST_SWEEP.hip.map((hipThreshold) => ({ guardType, hipThreshold, symmetryThreshold: null }))),
    ...TWIST_SWEEP.symmetry.map((symmetryThreshold) => ({ guardType: 'BILATERAL_Y' as const, hipThreshold: null, symmetryThreshold })),
    ...(['HIP_DEPTH_AND_BILATERAL_Y', 'HIP_MOTION_AND_BILATERAL_Y'] as const).flatMap((guardType) => TWIST_SWEEP.combinedHip.flatMap((hipThreshold) =>
      TWIST_SWEEP.combinedSymmetry.map((symmetryThreshold) => ({ guardType, hipThreshold, symmetryThreshold })))),
  ];
}
export const twistGuardId = (c: TwistGuardConfig) => `${c.guardType}/${c.hipThreshold ?? '-'}/${c.symmetryThreshold ?? '-'}`;
export function twistEntryDecision(values: TwistValues, config: TwistGuardConfig): boolean | null {
  const threshold = (value: number | null, limit: number | null) => value === null || limit === null ? null : value >= limit;
  const hip = threshold(config.guardType.startsWith('HIP_DEPTH') ? values.absNormalizedHipDepthDifference : values.hipMotionScore, config.hipThreshold);
  const bilateral = values.leftY === null || values.rightY === null ? null :
    values.leftY < Y_KICK_ENTER || values.rightY < Y_KICK_ENTER ? false : threshold(values.ySymmetryRatio, config.symmetryThreshold);
  if (config.guardType === 'HIP_DEPTH' || config.guardType === 'HIP_MOTION') return hip;
  if (config.guardType === 'BILATERAL_Y') return bilateral;
  return hip === false || bilateral === false ? false : hip === null || bilateral === null ? null : hip && bilateral;
}

/** Side entry only. Current values are evaluated at each eligible attempted entry;
 * a rejected attempt may retry later. No gesture latch, past/future peak, or new recovery rule.
 * A side with ANY continuing channel run cannot be cancelled by this hook. */
export class TwistEntryGuard {
  readonly config: Readonly<TwistGuardConfig>;
  private previouslyBlocked = new Set<Limb>();
  readonly observations: { timestamp: number; side: Limb; stageIndex: number | null; decision: boolean | null;
    activation: boolean; hipDepth: number | null; hipMotion: number | null; leftY: number | null; rightY: number | null; symmetry: number | null }[] = [];
  constructor(config: TwistGuardConfig) {
    if (!twistGuardConfigs().some((c) => twistGuardId(c) === twistGuardId(config))) throw new Error('STEP4L config is outside the bounded exploratory grid');
    this.config = Object.freeze({ ...config });
  }
  evaluate: IntegrityEntryGuard = (frame, context, integrityBlocked) => {
    const current = new Set<Limb>(), values = measuredTwistFrame(frame).twist;
    for (const side of LIMBS) {
      const c = context.sides[side];
      // Context is captured before below-enter runs are cleared by the core. A run
      // whose current value has dropped below enter is already ending; it must not
      // exempt a new entry on the other channel from the current-frame check.
      const continuing = c.runs.Y !== null && frame[side].Y !== null && frame[side].Y >= Y_KICK_ENTER ||
        c.runs.FLEXION !== null && frame[side].FLEXION !== null && frame[side].FLEXION >= FIXED_FLEXION_CONFIG.flexEnter;
      if (integrityBlocked.includes(side) || !c.entryChannels.length || continuing) continue;
      const decision = twistEntryDecision(values, this.config);
      if (decision === true) current.add(side);
      this.observations.push({ timestamp: frame.timestamp, side, stageIndex: frame.stageIndex, decision,
        activation: decision === true && !this.previouslyBlocked.has(side), hipDepth: values.absNormalizedHipDepthDifference,
        hipMotion: values.hipMotionScore, leftY: values.leftY, rightY: values.rightY, symmetry: values.ySymmetryRatio });
    }
    this.previouslyBlocked = current; return [...current];
  };
}
