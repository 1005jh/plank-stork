// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ActionCalibration, ACTION_CALIBRATION_SEQUENCE } from './actionCalibration';
import { ACTION_MIN_SAMPLES } from './poseActionConstants';
import { POSE_ACTIONS } from './poseActionTypes';
import { features, input, prototypes, RECORD_STARTS } from './testFixtures';

describe('action calibration guide', () => {
  it('orders every MOVE before its RECORD and returns to Neutral between all four actions', () => {
    expect(ACTION_CALIBRATION_SEQUENCE.map(({ phase, action, nextAction, durationMs }) => [phase, action ?? nextAction, durationMs])).toEqual([
      ['PREPARE', 'TWIST_LEFT', 2000],
      ['MOVE', 'TWIST_LEFT', 1000], ['RECORDING', 'TWIST_LEFT', 1500],
      ['RETURN_NEUTRAL', null, 1000], ['MOVE', 'TWIST_RIGHT', 1000], ['RECORDING', 'TWIST_RIGHT', 1500],
      ['RETURN_NEUTRAL', null, 1000], ['MOVE', 'KNEE_LEFT', 1000], ['RECORDING', 'KNEE_LEFT', 1500],
      ['RETURN_NEUTRAL', null, 1000], ['MOVE', 'KNEE_RIGHT', 1000], ['RECORDING', 'KNEE_RIGHT', 1500],
    ]);
  });
  it.each(['IDLE', 'HIP', 'FINISHING'] as const)('cannot start before Neutral is FROZEN (%s)', (collectionState) => {
    const calibration = new ActionCalibration();
    expect(calibration.start(input(0, features(), { collectionState }), 0)).toBe(false);
    expect(calibration.getView(0).status).toBe('IDLE');
  });

  it('uses its own 15 second sequence and excludes idle, prepare, move, return and finished frames', () => {
    const calibration = new ActionCalibration();
    expect(ACTION_CALIBRATION_SEQUENCE.reduce((sum, stage) => sum + stage.durationMs, 0)).toBe(15000);
    calibration.recordFrame(input(0), 0);
    calibration.start(input(0), 0);
    for (const time of [0, 1999, 2000, 2999, 4500, 5499, 5500, 6499, 8000, 8999, 9000, 9999, 11500, 12499, 12500, 13499, 15000, 15100]) calibration.recordFrame(input(time), time);
    const view = calibration.getView(15100);
    expect(view).toMatchObject({ status: 'PARTIAL', stage: null, remainingMs: 0 });
    for (const action of POSE_ACTIONS) expect(Object.values(view.sampleCounts[action])).toEqual(Array(7).fill(0));
  });

  it('records each inference only once and produces all four HIP-only prototypes with no UI polling', () => {
    const calibration = new ActionCalibration();
    const expected = prototypes();
    calibration.start(input(0), 0);
    for (const [index, start] of RECORD_STARTS.entries()) {
      const action = POSE_ACTIONS[index];
      for (let sample = 0; sample < 45; sample++) {
        const now = start + sample * 30;
        calibration.recordFrame(input(now, expected[action]!.features), now);
        calibration.recordFrame(input(now, expected[action]!.features), now);
      }
    }
    const view = calibration.getView(15000);
    expect(view.status).toBe('READY');
    expect(view.prototypes).toEqual(expected);
    for (const action of POSE_ACTIONS) expect(view.sampleCounts[action]).toMatchObject({ deltaHipCenterX: 45, deltaHipDepthDifference: 45, deltaLeftKneeRelativeX: 0 });
  });

  it('rejects invalid/stale/non-frozen frames and leaves insufficient HIP samples partial', () => {
    const calibration = new ActionCalibration();
    calibration.start(input(0), 0);
    for (let index = 0; index < ACTION_MIN_SAMPLES - 1; index++) calibration.recordFrame(input(3000 + index * 20), 3000 + index * 20);
    calibration.recordFrame(input(3300, features(), { smoothed: { values: features(), validNow: false, lastValidAt: 3300 } }), 3300);
    calibration.recordFrame(input(3400, features({ deltaHipCenterX: null })), 3400);
    calibration.recordFrame(input(3500, features(), { collectionState: 'FINISHING' }), 3500);
    calibration.recordFrame(input(3600), 4000); // Says validNow, but the timestamp is stale.
    expect(calibration.getView(4500).prototypes.TWIST_LEFT).toBeNull();
    expect(calibration.getView(4500).sampleCounts.TWIST_LEFT.deltaHipCenterX).toBe(14);
  });

  it('takes a multi-sample median snapshot and requires enough samples for each optional knee feature', () => {
    const calibration = new ActionCalibration();
    calibration.start(input(0), 0);
    const source = features({ deltaHipCenterX: 0.1, deltaLeftKneeRelativeX: 0.2, deltaRightKneeRelativeX: 0.3 });
    for (let index = 0; index < 15; index++) {
      source.deltaHipCenterX = index === 7 ? 99 : 0.1;
      source.deltaRightKneeRelativeX = index === 0 ? 0.3 : null;
      calibration.recordFrame(input(3000 + index * 50, source), 3000 + index * 50);
    }
    source.deltaHipCenterX = 1000;
    const view = calibration.getView(4500);
    expect(view.prototypes.TWIST_LEFT?.features).toMatchObject({ deltaHipCenterX: 0.1, deltaLeftKneeRelativeX: 0.2, deltaRightKneeRelativeX: null });
    view.prototypes.TWIST_LEFT!.features.deltaHipCenterX = 999;
    expect(calibration.getPrototypes().TWIST_LEFT!.features.deltaHipCenterX).toBe(0.1);
  });

  it('advances stage boundaries even without frames and resets all samples/prototypes for a new run', () => {
    const calibration = new ActionCalibration();
    calibration.start(input(100), 100);
    expect(calibration.getView(2099)).toMatchObject({ stage: { phase: 'PREPARE' }, remainingMs: 1 });
    expect(calibration.getView(2100)).toMatchObject({ stage: { phase: 'MOVE', nextAction: 'TWIST_LEFT' }, remainingMs: 1000 });
    expect(calibration.getView(3100)).toMatchObject({ stage: { phase: 'RECORDING', action: 'TWIST_LEFT' }, remainingMs: 1500 });
    for (let index = 0; index < 15; index++) calibration.recordFrame(input(3100 + index * 30), 3100 + index * 30);
    expect(calibration.getView(4600).prototypes.TWIST_LEFT).not.toBeNull();
    expect(calibration.start(input(5000), 5000)).toBe(false);
    calibration.reset();
    expect(calibration.getView(5000)).toMatchObject({ status: 'IDLE', stage: null, prototypes: { TWIST_LEFT: null } });
    expect(calibration.getView(5000).sampleCounts.TWIST_LEFT.deltaHipCenterX).toBe(0);
    expect(calibration.start(input(5000), 5000)).toBe(true);
    expect(calibration.getView(5000).stage?.phase).toBe('PREPARE');
  });
});
