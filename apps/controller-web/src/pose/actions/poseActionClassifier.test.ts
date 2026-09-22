// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ACTION_FEATURE_KEYS, ACTION_FEATURE_SCALES, ACTION_MAX_DISTANCE, ACTION_MIN_MARGIN } from './poseActionConstants';
import { ActionStabilizer, actionConfidence, actionPrototypeDistance, classifyPoseAction, neutralMovementScore, rankActionPrototypes } from './poseActionClassifier';
import { features, input, prototypes } from './testFixtures';
import type { PoseActionState } from './poseActionTypes';

describe('normalized action distance', () => {
  it('returns zero for an identical prototype', () => {
    const pose = prototypes().TWIST_LEFT!.features;
    expect(actionPrototypeDistance(pose, pose)).toBe(0);
  });
  it('applies each feature scale before RMS, across all seven dimensions', () => {
    const zero = features();
    const one = features();
    for (const key of ACTION_FEATURE_KEYS) { zero[key] = 0; one[key] = ACTION_FEATURE_SCALES[key]; }
    expect(actionPrototypeDistance(one, zero)).toBeCloseTo(1);
    expect(neutralMovementScore(one)).toBeCloseTo(1);
  });
  it('skips optional knee values unless both sides have one', () => {
    expect(actionPrototypeDistance(features({ deltaLeftKneeRelativeX: 999 }), features())).toBe(0);
    expect(actionPrototypeDistance(features(), features({ deltaRightKneeRelativeY: 999 }))).toBe(0);
  });
  it.each(['deltaHipCenterX', 'deltaHipCenterY', 'deltaHipDepthDifference'] as const)('excludes a candidate missing required %s', (key) => {
    expect(actionPrototypeDistance(features({ [key]: null }), features())).toBeNull();
    expect(actionPrototypeDistance(features(), features({ [key]: NaN }))).toBeNull();
    const samples = prototypes();
    samples.TWIST_LEFT!.features[key] = null;
    expect(rankActionPrototypes(features(), samples).map((candidate) => candidate.action)).not.toContain('TWIST_LEFT');
  });
  it('ranks the best and second-best distances in ascending order', () => {
    const samples = prototypes();
    const ranked = rankActionPrototypes(samples.TWIST_LEFT!.features, samples);
    expect(ranked[0]).toEqual({ action: 'TWIST_LEFT', distance: 0 });
    expect(ranked[1].action).toBe('KNEE_RIGHT');
    expect(ranked[1].distance).toBeCloseTo(Math.sqrt(13 / 3));
  });
});

describe('candidate rules, confidence and Neutral hysteresis', () => {
  it('returns a confident exact action match', () => {
    const samples = prototypes();
    expect(classifyPoseAction(input(0, samples.TWIST_LEFT!.features), samples, 0)).toMatchObject({
      rawAction: 'TWIST_LEFT', valid: true, reason: 'OK', confidence: 1, bestDistance: 0,
    });
  });
  it('prioritizes NONE near Neutral even when a prototype is identical', () => {
    const samples = prototypes();
    const tiny = features({ deltaHipCenterX: 0.001 });
    samples.TWIST_LEFT!.features = tiny;
    expect(classifyPoseAction(input(0, tiny), samples, 0)).toMatchObject({ rawAction: 'NONE', valid: true, reason: 'OK', confidence: 0 });
  });
  it('returns NONE when far from every prototype', () => {
    expect(classifyPoseAction(input(0, features({ deltaHipCenterX: 99 })), prototypes(), 0))
      .toMatchObject({ rawAction: 'NONE', reason: 'LOW_CONFIDENCE', confidence: 0 });
  });
  it('rejects indistinguishable best and second candidates as ambiguous', () => {
    const samples = prototypes();
    samples.KNEE_RIGHT!.features = { ...samples.TWIST_LEFT!.features };
    expect(classifyPoseAction(input(0, samples.TWIST_LEFT!.features), samples, 0))
      .toMatchObject({ rawAction: 'NONE', reason: 'AMBIGUOUS', confidence: 0, bestDistance: 0, secondBestDistance: 0 });
  });
  it('uses separate Neutral exit and enter boundaries based on the stable action', () => {
    const current = features({ deltaHipCenterX: 0.02, deltaHipCenterY: 0.02, deltaHipDepthDifference: 0.032 });
    const samples = prototypes();
    samples.TWIST_LEFT!.features = current;
    expect(neutralMovementScore(current)).toBeCloseTo(0.4);
    expect(classifyPoseAction(input(0, current), samples, 0, 'NONE').rawAction).toBe('NONE');
    expect(classifyPoseAction(input(0, current), samples, 0, 'TWIST_LEFT').rawAction).toBe('TWIST_LEFT');
  });
  it('rejects incomplete calibration and stale or missing required pose data', () => {
    const samples = prototypes();
    expect(classifyPoseAction(input(0, features(), { collectionState: 'FINISHING' }), samples, 0).reason).toBe('NOT_CALIBRATED');
    expect(classifyPoseAction(input(0, features(), { smoothed: { values: features(), validNow: false, lastValidAt: 0 } }), samples, 0).reason).toBe('POSE_STALE');
    expect(classifyPoseAction(input(0), samples, 400).reason).toBe('POSE_STALE');
    expect(classifyPoseAction(input(0, features({ deltaHipCenterX: null })), samples, 0).reason).toBe('POSE_STALE');
    samples.KNEE_LEFT = null;
    expect(classifyPoseAction(input(0), samples, 0)).toMatchObject({ rawAction: 'NONE', valid: false, reason: 'ACTION_CALIBRATION_INCOMPLETE' });
  });
  it('keeps confidence bounded and lowers it for distant or overlapping candidates', () => {
    expect(actionConfidence(0, 2)).toBe(1);
    expect(actionConfidence(ACTION_MAX_DISTANCE * 0.95, 3)).toBeCloseTo(0.05);
    expect(actionConfidence(0, ACTION_MIN_MARGIN * 0.1)).toBeCloseTo(0.1);
    expect(actionConfidence(99, 100)).toBe(0);
    expect(actionConfidence(null, null)).toBe(0);
  });
  it('rejects a separated candidate with low distance confidence even inside the maximum radius', () => {
    const samples = prototypes();
    const current = features({ deltaHipCenterX: -0.1 - 0.05 * 1.3 * Math.sqrt(3), deltaHipCenterY: 0.05, deltaHipDepthDifference: 0.08 });
    const result = classifyPoseAction(input(0, current), samples, 0);
    expect(result.bestDistance).toBeCloseTo(1.3);
    expect(result).toMatchObject({ rawAction: 'NONE', reason: 'LOW_CONFIDENCE' });
    expect(result.confidence).toBeLessThan(0.25);
  });
});

describe('action dwell stabilization', () => {
  const candidate = (rawAction: PoseActionState, valid = true) => ({ rawAction, valid });
  it('ignores a single-frame spike and enters after 200 ms of consecutive candidates', () => {
    const state = new ActionStabilizer();
    expect(state.update(candidate('TWIST_LEFT'), 0)).toBe('NONE');
    expect(state.update(candidate('NONE'), 30)).toBe('NONE');
    expect(state.update(candidate('TWIST_LEFT'), 100)).toBe('NONE');
    expect(state.update(candidate('TWIST_LEFT'), 299)).toBe('NONE');
    expect(state.update(candidate('TWIST_LEFT'), 300)).toBe('TWIST_LEFT');
  });
  it('releases to NONE after 150 ms and requires a new 200 ms dwell when switching actions', () => {
    const state = new ActionStabilizer();
    state.update(candidate('TWIST_LEFT'), 0);
    state.update(candidate('TWIST_LEFT'), 200);
    expect(state.update(candidate('TWIST_RIGHT'), 210)).toBe('TWIST_LEFT');
    expect(state.update(candidate('TWIST_RIGHT'), 409)).toBe('TWIST_LEFT');
    expect(state.update(candidate('TWIST_RIGHT'), 410)).toBe('TWIST_RIGHT');
    expect(state.update(candidate('NONE'), 420)).toBe('TWIST_RIGHT');
    expect(state.update(candidate('NONE'), 569)).toBe('TWIST_RIGHT');
    expect(state.update(candidate('NONE'), 570)).toBe('NONE');
  });
  it('clears stable and pending actions immediately on pose loss', () => {
    const state = new ActionStabilizer();
    state.update(candidate('TWIST_LEFT'), 0);
    state.update(candidate('TWIST_LEFT'), 200);
    state.update(candidate('TWIST_RIGHT'), 210);
    expect(state.update(candidate('NONE', false), 220)).toBe('NONE');
    expect(state.update(candidate('TWIST_RIGHT'), 400)).toBe('NONE');
    expect(state.update(candidate('TWIST_RIGHT'), 599)).toBe('NONE');
    expect(state.update(candidate('TWIST_RIGHT'), 600)).toBe('TWIST_RIGHT');
  });
  it('does not preserve pending dwell through reset or a gap in inference delivery', () => {
    const state = new ActionStabilizer();
    state.update(candidate('KNEE_LEFT'), 0);
    state.reset();
    expect(state.update(candidate('KNEE_LEFT'), 200)).toBe('NONE');
    expect(state.update(candidate('KNEE_LEFT'), 1000)).toBe('NONE');
    expect(state.update(candidate('KNEE_LEFT'), 1200)).toBe('KNEE_LEFT');
  });
});
