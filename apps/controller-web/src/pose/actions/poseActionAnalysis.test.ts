// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PoseActionAnalysis } from './poseActionAnalysis';
import { features, input, prototypes, RECORD_STARTS } from './testFixtures';
import { POSE_ACTIONS } from './poseActionTypes';

function calibrated() {
  const analysis = new PoseActionAnalysis();
  analysis.start(input(0), 0);
  for (const [index, start] of RECORD_STARTS.entries()) {
    for (let sample = 0; sample < 30; sample++) {
      const now = start + sample * 40;
      analysis.processFrame(input(now, prototypes()[POSE_ACTIONS[index]]!.features), now);
    }
  }
  expect(analysis.getView(input(15000), 15000).calibration.status).toBe('READY');
  return analysis;
}

describe('action analysis lifecycle', () => {
  it('cannot start on unfinished Neutral calibration', () => {
    const analysis = new PoseActionAnalysis();
    const unfinished = input(0, features(), { collectionState: 'FINISHING' });
    expect(analysis.start(unfinished, 0)).toBe(false);
    expect(analysis.getView(unfinished, 0)).toMatchObject({ calibration: { status: 'IDLE' }, classification: { rawAction: 'NONE', stableAction: 'NONE', reason: 'NOT_CALIBRATED' } });
  });

  it('does not collect extra samples or advance stable dwell from UI polling', () => {
    const analysis = calibrated();
    const current = prototypes().TWIST_LEFT!.features;
    analysis.processFrame(input(15100, current), 15100);
    expect(analysis.getView(input(15100, current), 15300).classification.stableAction).toBe('NONE');
    analysis.processFrame(input(15300, current), 15300);
    const view = analysis.getView(input(15300, current), 15300);
    expect(view.classification).toMatchObject({ rawAction: 'TWIST_LEFT', stableAction: 'TWIST_LEFT', confidence: 1 });
    expect(view.calibration.sampleCounts.TWIST_LEFT.deltaHipCenterX).toBe(30);
  });

  it('immediately releases on pose loss and expires a stalled inference stream', () => {
    const analysis = calibrated();
    const current = prototypes().TWIST_LEFT!.features;
    analysis.processFrame(input(15100, current), 15100);
    analysis.processFrame(input(15300, current), 15300);
    const stale = input(15310, features(), { smoothed: { values: features(), validNow: false, lastValidAt: 15300 } });
    analysis.processFrame(stale, 15310);
    expect(analysis.getView(stale, 15310).classification).toMatchObject({ rawAction: 'NONE', stableAction: 'NONE', valid: false, reason: 'POSE_STALE' });
    analysis.processFrame(input(15400, current), 15400);
    analysis.processFrame(input(15600, current), 15600);
    expect(analysis.getView(input(15600, current), 16000).classification.stableAction).toBe('NONE');
    expect(analysis.getView(input(15600, current), 16000).calibration.status).toBe('READY');
  });

  it.each(['HIP', 'FROZEN'] as const)('invalidates all prototypes on a new Neutral reference (%s)', (collectionState) => {
    const analysis = calibrated();
    const nextNeutral = input(16000, features(), { collectionState, hipReadyAt: 15900 });
    const view = analysis.getView(nextNeutral, 16000);
    expect(view.calibration.status).toBe('IDLE');
    expect(Object.values(view.calibration.prototypes)).toEqual(Array(4).fill(null));
    expect(view.classification).toMatchObject({ rawAction: 'NONE', stableAction: 'NONE', valid: false });
    expect(view.calibration.sampleCounts.TWIST_LEFT.deltaHipCenterX).toBe(0);
  });

  it('reset releases calibration, prototypes, and pending classifier state', () => {
    const analysis = calibrated();
    analysis.processFrame(input(15100, prototypes().TWIST_LEFT!.features), 15100);
    analysis.reset();
    const view = analysis.getView(input(15500), 15500);
    expect(view.calibration.status).toBe('IDLE');
    expect(Object.values(view.calibration.prototypes)).toEqual(Array(4).fill(null));
    expect(view.classification).toMatchObject({ rawAction: 'NONE', stableAction: 'NONE', reason: 'ACTION_CALIBRATION_INCOMPLETE' });
    expect(analysis.start(input(15500), 15500)).toBe(true);
    expect(analysis.getView(input(15500), 15500).calibration.stage?.phase).toBe('PREPARE');
  });
});
