import {
  ACTION_ENTER_MS, ACTION_FEATURE_KEYS, ACTION_FEATURE_SCALES, ACTION_HIP_FEATURES,
  ACTION_MAX_DISTANCE, ACTION_MAX_FRAME_GAP_MS, ACTION_MIN_CONFIDENCE, ACTION_MIN_MARGIN,
  ACTION_RELEASE_MS, NEUTRAL_ENTER_SCORE, NEUTRAL_EXIT_SCORE,
} from './poseActionConstants';
import {
  POSE_ACTIONS, type ActionClassification, type ActionFeatures, type ActionInput,
  type ActionPrototypes, type PoseActionState,
} from './poseActionTypes';

export const isFeatureValue = (value: number | null): value is number => typeof value === 'number' && Number.isFinite(value);
export const hasActionHipFeatures = (features: ActionFeatures): boolean => ACTION_HIP_FEATURES.every((key) => isFeatureValue(features[key]));
export const neutralIsFrozen = (input: ActionInput): boolean => input.collectionState === 'FROZEN' && input.hipReadyAt !== null;
export const actionPoseIsFresh = (input: ActionInput, now: number): boolean => input.smoothed.validNow &&
  input.smoothed.lastValidAt !== null && now >= input.smoothed.lastValidAt &&
  now - input.smoothed.lastValidAt < ACTION_MAX_FRAME_GAP_MS && hasActionHipFeatures(input.smoothed.values);

/** RMS of scaled differences over common values; all three HIP dimensions are mandatory. */
export function actionPrototypeDistance(current: ActionFeatures, prototype: ActionFeatures): number | null {
  if (!hasActionHipFeatures(current) || !hasActionHipFeatures(prototype)) return null;
  const differences = ACTION_FEATURE_KEYS.flatMap((key) => {
    const a = current[key];
    const b = prototype[key];
    return isFeatureValue(a) && isFeatureValue(b) ? [(a - b) / ACTION_FEATURE_SCALES[key]] : [];
  });
  const distance = Math.hypot(...differences) / Math.sqrt(differences.length);
  return Number.isFinite(distance) ? distance : null;
}

export function neutralMovementScore(features: ActionFeatures): number | null {
  if (!hasActionHipFeatures(features)) return null;
  return Math.hypot(...ACTION_HIP_FEATURES.map((key) => features[key]! / ACTION_FEATURE_SCALES[key])) / Math.sqrt(ACTION_HIP_FEATURES.length);
}

export function rankActionPrototypes(current: ActionFeatures, prototypes: ActionPrototypes) {
  return POSE_ACTIONS.flatMap((action) => {
    const prototype = prototypes[action];
    const distance = prototype ? actionPrototypeDistance(current, prototype.features) : null;
    return distance === null ? [] : [{ action, distance }];
  }).sort((a, b) => a.distance - b.distance);
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function actionConfidence(best: number | null, second: number | null): number {
  if (best === null || second === null || !Number.isFinite(best) || !Number.isFinite(second)) return 0;
  return Math.min(clamp01(1 - best / ACTION_MAX_DISTANCE), clamp01((second - best) / ACTION_MIN_MARGIN));
}

/** Pure candidate decision; the previous stable action selects the Neutral hysteresis boundary. */
export function classifyPoseAction(input: ActionInput, prototypes: ActionPrototypes, now: number, stableAction: PoseActionState = 'NONE'): ActionClassification {
  const result: ActionClassification = {
    rawAction: 'NONE', stableAction: 'NONE', confidence: 0, valid: false,
    neutralMovementScore: null, bestDistance: null, secondBestDistance: null,
    actionDistances: Object.fromEntries(POSE_ACTIONS.map((action) => [action, null])) as ActionClassification['actionDistances'],
    reason: 'NOT_CALIBRATED',
  };
  if (!neutralIsFrozen(input)) return result;
  if (!actionPoseIsFresh(input, now)) return { ...result, reason: 'POSE_STALE' };
  const current = input.smoothed.values;
  const ranked = rankActionPrototypes(current, prototypes);
  result.neutralMovementScore = neutralMovementScore(current);
  for (const candidate of ranked) result.actionDistances[candidate.action] = candidate.distance;
  result.bestDistance = ranked[0]?.distance ?? null;
  result.secondBestDistance = ranked[1]?.distance ?? null;
  if (ranked.length !== POSE_ACTIONS.length) return { ...result, reason: 'ACTION_CALIBRATION_INCOMPLETE' };
  result.valid = true;
  const neutralBoundary = stableAction === 'NONE' ? NEUTRAL_EXIT_SCORE : NEUTRAL_ENTER_SCORE;
  if (result.neutralMovementScore! <= neutralBoundary) return { ...result, reason: 'OK' };
  result.confidence = actionConfidence(result.bestDistance, result.secondBestDistance);
  if (result.bestDistance! > ACTION_MAX_DISTANCE) return { ...result, reason: 'LOW_CONFIDENCE' };
  if (result.secondBestDistance! - result.bestDistance! < ACTION_MIN_MARGIN) return { ...result, reason: 'AMBIGUOUS' };
  if (result.confidence < ACTION_MIN_CONFIDENCE) return { ...result, reason: 'LOW_CONFIDENCE' };
  return { ...result, rawAction: ranked[0].action, reason: 'OK' };
}

/** Only new inference samples advance dwell time. Invalid poses clear both stable and pending state. */
export class ActionStabilizer {
  private stable: PoseActionState = 'NONE';
  private pending: PoseActionState | null = null;
  private pendingSince: number | null = null;
  private lastFrameAt: number | null = null;

  get stableAction(): PoseActionState { return this.stable; }

  update(candidate: Pick<ActionClassification, 'rawAction' | 'valid'>, now: number): PoseActionState {
    if (!candidate.valid) { this.reset(); return this.stable; }
    if (this.lastFrameAt !== null && now - this.lastFrameAt >= ACTION_MAX_FRAME_GAP_MS) this.reset();
    this.lastFrameAt = now;
    if (candidate.rawAction === this.stable) {
      this.pending = null;
      this.pendingSince = null;
    } else {
      if (this.pending !== candidate.rawAction) {
        this.pending = candidate.rawAction;
        this.pendingSince = now;
      }
      const delay = candidate.rawAction === 'NONE' ? ACTION_RELEASE_MS : ACTION_ENTER_MS;
      if (now - this.pendingSince! >= delay) {
        this.stable = candidate.rawAction;
        this.pending = null;
        this.pendingSince = null;
      }
    }
    return this.stable;
  }

  reset(): void {
    this.stable = 'NONE'; this.pending = null; this.pendingSince = null; this.lastFrameAt = null;
  }
}
