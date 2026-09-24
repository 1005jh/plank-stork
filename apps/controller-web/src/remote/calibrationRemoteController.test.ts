// @vitest-environment node
import { ActionValidation } from '../pose/validation/actionValidation';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { CalibrationRemoteController } from './calibrationRemoteController';
import { PoseFeatureAnalysis } from '../pose/features/poseFeatureAnalysis';
import { PoseActionAnalysis } from '../pose/actions/poseActionAnalysis';
import { input, prototypes, RECORD_STARTS } from '../pose/actions/testFixtures';
import { POSE_ACTIONS } from '../pose/actions/poseActionTypes';

describe('controller calibration remote adapter with real engines', () => {
  let now: number;
  let neutral: PoseFeatureAnalysis;
  let actions: PoseActionAnalysis;
  let remote: CalibrationRemoteController;
  let camera: { cameraRunning: boolean; poseDetected: boolean };
  let startNeutral: Mock<() => void>;
  let startAction: Mock<() => void>;
  const request = (requestId: string) => ({ requestId, timestamp: now });
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));

  function freezeNeutral() {
    remote.handle('neutral:start', request('neutral'));
    for (now = 50; now <= 1000; now += 50) neutral.processFrame(points, points, now);
    now = 1000;
    expect(remote.snapshot().neutral.frozen).toBe(true);
  }
  function finishActions() {
    remote.handle('action:start', request('action'));
    for (const [index, start] of RECORD_STARTS.entries()) {
      for (let sample = 0; sample < 30; sample++) {
        now = 1000 + start + sample * 40;
        actions.processFrame(input(now, prototypes()[POSE_ACTIONS[index]]!.features, { hipReadyAt: 1000 }), now);
      }
    }
    now = 16000;
    expect(remote.snapshot().actionCalibration.readiness).toEqual({ TWIST_LEFT: true, TWIST_RIGHT: true, KNEE_LEFT: true, KNEE_RIGHT: true });
  }

  beforeEach(() => {
    now = 0;
    neutral = new PoseFeatureAnalysis(); actions = new PoseActionAnalysis();
    camera = { cameraRunning: true, poseDetected: true };
    startNeutral = vi.fn(() => { actions.reset(); neutral.startCalibration(now); });
    startAction = vi.fn(() => { actions.start(neutral.getView(now), now); });
    remote = new CalibrationRemoteController(() => ({
      getCamera: () => camera, getNeutral: () => neutral.getView(now),
      getActions: () => actions.getView(neutral.getView(now), now),
      startNeutral, startAction, resetAction: () => actions.reset(),
      getValidation: () => new ActionValidation().getView(now), startValidation: () => false, resetValidation() {},
    }));
  });

  it('starts existing Neutral calibration and ignores duplicate IDs and active-state repeats', () => {
    remote.handle('neutral:start', request('a'));
    now = 50; neutral.processFrame(points, points, now);
    remote.handle('neutral:start', request('a'));
    remote.handle('neutral:start', request('b'));
    expect(startNeutral).toHaveBeenCalledTimes(1);
    expect(remote.snapshot().neutral).toMatchObject({ status: 'CALIBRATING', collectionState: 'HIP', hipSamples: 1 });
  });

  it.each([
    [false, false, 'CAMERA_NOT_READY'], [true, false, 'POSE_NOT_DETECTED'],
  ] as const)('blocks Neutral when camera=%s and pose=%s', (cameraRunning, poseDetected, error) => {
    camera = { cameraRunning, poseDetected };
    remote.handle('neutral:start', request('a'));
    expect(startNeutral).not.toHaveBeenCalled();
    expect(remote.snapshot()).toMatchObject({ lastCommandError: error, neutral: { collectionState: 'IDLE' } });
  });

  it('blocks Action before FROZEN, then starts once and preserves stage timing on repeated requests', () => {
    remote.handle('action:start', request('too-early'));
    expect(startAction).not.toHaveBeenCalled();
    expect(remote.snapshot().lastCommandError).toBe('NEUTRAL_NOT_FROZEN');
    freezeNeutral();
    remote.handle('action:start', request('start'));
    now += 500;
    remote.handle('action:start', request('start'));
    remote.handle('action:start', request('new-id'));
    expect(startAction).toHaveBeenCalledTimes(1);
    expect(remote.snapshot().actionCalibration).toMatchObject({ status: 'ACTIVE', phase: 'PREPARE', remainingMs: 1500 });
  });

  it('publishes the exact controller sequence and countdown, including the first MOVE', () => {
    freezeNeutral();
    remote.handle('action:start', request('a'));
    now = 3000;
    expect(remote.snapshot().actionCalibration).toMatchObject({ phase: 'MOVE', action: 'TWIST_LEFT', remainingMs: 1000 });
    now = 3380;
    expect(remote.snapshot().actionCalibration.remainingMs).toBe(620);
    now = 4000;
    expect(remote.snapshot().actionCalibration).toMatchObject({ phase: 'RECORD', action: 'TWIST_LEFT', remainingMs: 1500 });
    now = 5500;
    expect(remote.snapshot().actionCalibration).toMatchObject({ phase: 'RETURN_NEUTRAL', action: null, remainingMs: 1000 });
  });

  it('maps independent knee readiness, FINISHING and final partial freeze', () => {
    remote.handle('neutral:start', request('a'));
    const partial = points.map((point, index) => ({ ...point, visibility: index === 25 ? 0.1 : 0.9 }));
    for (now = 50; now <= 1000; now += 50) neutral.processFrame(partial, partial, now);
    now = 1400;
    expect(remote.snapshot().neutral).toMatchObject({ status: 'CALIBRATED', collectionState: 'FINISHING', hipReady: true, leftKneeReady: false, rightKneeReady: true, kneeGraceRemainingMs: 600, frozen: false });
    now = 2000;
    expect(remote.snapshot().neutral).toMatchObject({ collectionState: 'FROZEN', leftKneeSamples: 0, frozen: true });
  });

  it('resets prototypes/pending/stable when Neutral is recalibrated, and cannot replay an old request ID', () => {
    freezeNeutral(); finishActions();
    remote.handle('neutral:start', request('new-neutral'));
    expect(remote.snapshot()).toMatchObject({ neutral: { collectionState: 'HIP' }, actionCalibration: { status: 'IDLE' }, classification: { stableAction: 'NONE', reason: 'NOT_CALIBRATED' } });
    now += 50; neutral.processFrame(points, points, now);
    remote.handle('neutral:start', request('neutral'));
    expect(startNeutral).toHaveBeenCalledTimes(2);
    expect(remote.snapshot().neutral.hipSamples).toBe(1);
  });

  it('Action reset keeps frozen Neutral and clears all prototype readiness', () => {
    freezeNeutral(); finishActions();
    remote.handle('action:reset', request('reset'));
    expect(remote.snapshot().neutral.frozen).toBe(true);
    expect(remote.snapshot().actionCalibration).toMatchObject({ status: 'IDLE', phase: 'IDLE' });
    expect(Object.values(remote.snapshot().actionCalibration.readiness)).toEqual([false, false, false, false]);
  });

  it('never exposes a stale stable action and only sends compact debug snapshots', () => {
    freezeNeutral(); finishActions();
    const values = prototypes().TWIST_LEFT!.features;
    for (now = 16100; now <= 16300; now += 200) actions.processFrame(input(now, values, { hipReadyAt: 1000 }), now);
    now = 16700;
    const snapshot = remote.snapshot();
    expect(snapshot.classification).toMatchObject({ stableAction: 'NONE', rawAction: 'NONE', reason: 'POSE_STALE' });
    expect(JSON.stringify(snapshot)).not.toMatch(/landmarks|deltaHip|previewMirrored/);
    expect(snapshot.actionCalibration.readiness.TWIST_LEFT).toBe(true);
  });
});
