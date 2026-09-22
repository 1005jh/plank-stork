import { ACTION_FEATURE_KEYS, ACTION_MIN_SAMPLES, ACTION_PREPARE_MS, ACTION_RECORD_MS, ACTION_MOVE_MS, ACTION_RETURN_MS } from './poseActionConstants';
import { actionPoseIsFresh, hasActionHipFeatures, isFeatureValue, neutralIsFrozen } from './poseActionClassifier';
import { POSE_ACTIONS, type ActionCalibrationView, type ActionFeatures, type ActionInput, type ActionPrototypes, type ActionSampleCounts, type ActionStage, type PoseAction } from './poseActionTypes';

export const ACTION_CALIBRATION_SEQUENCE: readonly ActionStage[] = [
  { phase: 'PREPARE', action: null, nextAction: 'TWIST_LEFT', durationMs: ACTION_PREPARE_MS },
  ...POSE_ACTIONS.flatMap((action, index): ActionStage[] => [
    ...(index ? [{ phase: 'RETURN_NEUTRAL' as const, action: null, nextAction: null, durationMs: ACTION_RETURN_MS }] : []),
    { phase: 'MOVE', action: null, nextAction: action, durationMs: ACTION_MOVE_MS },
    { phase: 'RECORDING', action, nextAction: null, durationMs: ACTION_RECORD_MS },
  ]),
];

const emptyPrototypes = (): ActionPrototypes => Object.fromEntries(POSE_ACTIONS.map((action) => [action, null])) as ActionPrototypes;
const emptySamples = () => Object.fromEntries(POSE_ACTIONS.map((action) => [action,
  Object.fromEntries(ACTION_FEATURE_KEYS.map((key) => [key, [] as number[]])) as Record<keyof ActionFeatures, number[]>,
])) as Record<PoseAction, Record<keyof ActionFeatures, number[]>>;

function median(values: number[]): number | null {
  if (values.length < ACTION_MIN_SAMPLES) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Independent 15 s guide; receives per-inference feature snapshots, never the 250 ms React view. */
export class ActionCalibration {
  private status: ActionCalibrationView['status'] = 'IDLE';
  private startedAt = 0;
  private stageIndex = 0;
  private stageStartedAt = 0;
  private lastSampleAt: number | null = null;
  private samples = emptySamples();
  private prototypes = emptyPrototypes();

  start(input: ActionInput, now: number): boolean {
    if (!neutralIsFrozen(input) || this.status === 'RUNNING') return false;
    this.reset();
    this.status = 'RUNNING';
    this.startedAt = now;
    this.stageStartedAt = now;
    return true;
  }

  advance(now: number): void {
    while (this.status === 'RUNNING') {
      const stage = ACTION_CALIBRATION_SEQUENCE[this.stageIndex];
      if (now < this.stageStartedAt + stage.durationMs) break;
      if (stage.action) {
        const features = Object.fromEntries(ACTION_FEATURE_KEYS.map((key) => [key, median(this.samples[stage.action!][key])])) as ActionFeatures;
        this.prototypes[stage.action] = hasActionHipFeatures(features) ? { action: stage.action, features } : null;
      }
      this.stageStartedAt += stage.durationMs;
      this.stageIndex++;
      if (this.stageIndex === ACTION_CALIBRATION_SEQUENCE.length) {
        this.status = POSE_ACTIONS.every((action) => this.prototypes[action]) ? 'READY' : 'PARTIAL';
      }
    }
  }

  recordFrame(input: ActionInput, now: number): void {
    this.advance(now);
    if (this.status !== 'RUNNING' || now < this.startedAt || (this.lastSampleAt !== null && now <= this.lastSampleAt)) return;
    this.lastSampleAt = now;
    const stage = ACTION_CALIBRATION_SEQUENCE[this.stageIndex];
    if (stage.phase !== 'RECORDING' || !stage.action || !neutralIsFrozen(input) || !actionPoseIsFresh(input, now)) return;
    for (const key of ACTION_FEATURE_KEYS) {
      const value = input.smoothed.values[key];
      if (isFeatureValue(value)) this.samples[stage.action][key].push(value);
    }
  }

  getPrototypes(): ActionPrototypes {
    return Object.fromEntries(POSE_ACTIONS.map((action) => {
      const prototype = this.prototypes[action];
      return [action, prototype ? { action, features: { ...prototype.features } } : null];
    })) as ActionPrototypes;
  }

  getView(now: number): ActionCalibrationView {
    this.advance(now);
    const stage = this.status === 'RUNNING' ? ACTION_CALIBRATION_SEQUENCE[this.stageIndex] : null;
    return {
      status: this.status, stage,
      remainingMs: stage ? Math.max(0, this.stageStartedAt + stage.durationMs - now) : 0,
      prototypes: this.getPrototypes(),
      sampleCounts: Object.fromEntries(POSE_ACTIONS.map((action) => [action,
        Object.fromEntries(ACTION_FEATURE_KEYS.map((key) => [key, this.samples[action][key].length])),
      ])) as Record<PoseAction, ActionSampleCounts>,
    };
  }

  reset(): void {
    this.status = 'IDLE'; this.startedAt = 0; this.stageIndex = 0; this.stageStartedAt = 0;
    this.lastSampleAt = null; this.samples = emptySamples(); this.prototypes = emptyPrototypes();
  }
}
