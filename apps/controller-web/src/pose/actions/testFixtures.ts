import { POSE_ACTIONS, type ActionFeatures, type ActionInput, type ActionPrototypes } from './poseActionTypes';

export const features = (overrides: Partial<ActionFeatures> = {}): ActionFeatures => ({
  deltaHipCenterX: 0, deltaHipCenterY: 0, deltaHipDepthDifference: 0,
  deltaLeftKneeRelativeX: null, deltaRightKneeRelativeX: null,
  deltaLeftKneeRelativeY: null, deltaRightKneeRelativeY: null, ...overrides,
});

export function prototypes(): ActionPrototypes {
  const values = [
    [-0.1, 0.05, 0.08], [0.1, 0.05, -0.08], [0.1, 0.15, 0.16], [-0.1, 0.15, -0.16],
  ];
  return Object.fromEntries(POSE_ACTIONS.map((action, index) => [action, { action, features: features({
    deltaHipCenterX: values[index][0], deltaHipCenterY: values[index][1], deltaHipDepthDifference: values[index][2],
  }) }])) as ActionPrototypes;
}

export const input = (now: number, values = features(), overrides: Partial<ActionInput> = {}): ActionInput => ({
  collectionState: 'FROZEN', hipReadyAt: 0,
  smoothed: { values, validNow: true, lastValidAt: now }, ...overrides,
});

export const RECORD_STARTS = [3000, 6500, 10000, 13500];
