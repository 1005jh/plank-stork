// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KneeKickAnalysis } from './kneeKickAnalysis';
import { KneeKickDetector } from './kneeKickDetector';
import { KneeKickDetectorV3 } from './kneeKickDetectorV3';
import * as motion from '../motion/kneeMotionFeatures';
import { motionFrame } from '../motion/testFixtures';
import { PoseFeatureAnalysis } from '../features/poseFeatureAnalysis';
import type { KickDiagnosticDataset } from './kneeKickDiagnostics';

function setup() {
  const kick = new KneeKickAnalysis(), neutral = new PoseFeatureAnalysis();
  function frame(t: number, yLeft = 0, yRight = 0, xLeft = 0, missing = false) {
    const f = motionFrame(t), scale = Math.hypot(.05, .3);
    f.landmarks[25].y += yLeft * scale; f.landmarks[26].y += yRight * scale;
    f.landmarks[25].x += xLeft * scale;
    if (missing) { f.landmarks = []; f.worldLandmarks = []; }
    neutral.processFrame(f.landmarks, f.worldLandmarks, t); kick.processFrame(f, neutral.getView(t));
    return f;
  }
  neutral.startCalibration(0);
  for (let t = 50; t <= 1000; t += 50) frame(t);
  return { kick, neutral, frame };
}
afterEach(() => vi.restoreAllMocks());
describe('STEP 4I live V3 primary / independent X shadow', () => {
  it('extracts once and gives identical feature object and timestamp to both independent cores', () => {
    const { kick, frame } = setup();
    const extract = vi.spyOn(motion, 'extractKneeMotionFeatures');
    const v3 = vi.spyOn(KneeKickDetectorV3.prototype, 'processFrame'), x = vi.spyOn(KneeKickDetector.prototype, 'processFrame');
    frame(1050, .6);
    expect(extract).toHaveBeenCalledOnce(); expect(v3).toHaveBeenCalledOnce(); expect(x).toHaveBeenCalledOnce();
    expect(v3.mock.calls[0][0]).toBe(x.mock.calls[0][0]); expect(v3.mock.calls[0][1]).toBe(1050);
    expect(x.mock.calls[0][1]).toBe(1050);
    expect(kick.getView(1050)).toMatchObject({ detectorMode: 'Y_V3', detector: { state: 'CANDIDATE' }, legacyShadow: { state: 'ARMED' } });
  });
  it('records V3-only events/counts in primary Guided and exports both without landmarks', () => {
    const { kick, frame } = setup(); kick.startTest(1100);
    frame(13100, .6); frame(13160, .6);
    const view = kick.getView(13160);
    expect(view).toMatchObject({ detector: { counts: { KNEE_LEFT: 1, KNEE_RIGHT: 0 } }, test: { eventCount: 1 },
      legacyShadow: { counts: { KNEE_LEFT: 0, KNEE_RIGHT: 0 }, eventAgreement: false, directionAgreement: null } });
    expect(kick.getTestStages()[5].events[0].direction).toBe('KNEE_LEFT');
    const dataset = JSON.parse(kick.exportDiagnosticsJson()) as KickDiagnosticDataset;
    expect(dataset).toMatchObject({ detectorMode: 'Y_V3', detectorConfigV3: { version: 3 }, baselineV3: { version: 3 } });
    expect(dataset.frames.at(-1)).toMatchObject({ event: { direction: 'KNEE_LEFT' }, v3: { state: 'WAIT_RETURN', event: { direction: 'KNEE_LEFT' } }, legacyShadow: { event: null } });
    expect(JSON.stringify(dataset)).not.toMatch(/landmarks|worldLandmarks/);
  });
  it('never promotes an X-only event or disagreement into primary Guided', () => {
    const { kick, frame } = setup(); kick.startTest(1100);
    frame(13100); frame(13140, 0, 0, -.32); frame(13180, 0, 0, -.64); frame(13220, 0, 0, -.64);
    expect(kick.getView(13220)).toMatchObject({ detector: { state: 'ARMED', counts: { KNEE_LEFT: 0, KNEE_RIGHT: 0 }, lastEvent: null },
      test: { eventCount: 0 }, legacyShadow: { counts: { KNEE_LEFT: 1, KNEE_RIGHT: 0 }, eventAgreement: false } });
    expect(kick.getTestStages().flatMap((s) => s.events)).toEqual([]);
    kick.getView(23100);
    expect(kick.getReplaySnapshot().guided.summary!.KNEE_LEFT.detected).toBe(false);
    expect(kick.getReplaySnapshot().legacyShadow.guided.summary!.KNEE_LEFT.detected).toBe(true);
  });
  it('freezes both from the same bounded window and never rebaselines during movement', () => {
    const { kick, frame } = setup(), before = kick.getReplaySnapshot();
    expect(before.baselineV3).toMatchObject({ version: 3, leftYMedian: expect.closeTo(.3), rightYMedian: expect.closeTo(.3) });
    for (let t = 1050; t <= 4000; t += 50) frame(t, 1, 1, -.8);
    expect(kick.getReplaySnapshot().baselineV3).toEqual(before.baselineV3);
    expect(kick.getReplaySnapshot().legacyShadow.detector.baseline).toEqual(before.legacyShadow.detector.baseline);
  });
  it('resets and recollects both on recalibration', () => {
    const { kick, neutral, frame } = setup(); frame(1050, .6); frame(1110, .6);
    neutral.startCalibration(1200); frame(1250);
    expect(kick.getView(1250)).toMatchObject({ baselineSealed: false, detector: { ready: false, lastEvent: null }, legacyShadow: { ready: false, lastEvent: null } });
    for (let t = 1300; t <= 2200; t += 50) frame(t);
    expect(kick.getView(2200)).toMatchObject({ baselineSealed: true, detector: { ready: true, counts: { KNEE_LEFT: 0 } }, legacyShadow: { ready: true, counts: { KNEE_LEFT: 0 } } });
  });
  it('preserves each frozen baseline while clearing both on trial reset and new trial', () => {
    const { kick, frame } = setup(), before = kick.getReplaySnapshot();
    kick.startTest(1100); frame(1200, .6); frame(1260, .6);
    kick.resetTest(1300); expect(kick.startTest(1400)).toBe(true);
    const snapshot = kick.getReplaySnapshot();
    expect(snapshot.baselineV3).toEqual(before.baselineV3);
    expect(snapshot.legacyShadow.detector.baseline).toEqual(before.legacyShadow.detector.baseline);
    expect(snapshot.detector).toMatchObject({ state: 'ARMED', eventsLast: null, counts: { KNEE_LEFT: 0, KNEE_RIGHT: 0 } });
    expect(snapshot.legacyShadow.detector).toMatchObject({ state: 'ARMED', eventsLast: null, counts: { KNEE_LEFT: 0, KNEE_RIGHT: 0 } });
  });
  it.each(['CAMERA_STOP', 'UNMOUNT'])('clears both baselines and pending states on %s', (reason) => {
    const { kick, frame } = setup(); kick.startTest(1100); frame(1150, .6); kick.reset(1160, reason);
    const view = kick.getView(1160);
    expect(view).toMatchObject({ baselineV3: null, detector: { ready: false, state: 'NOT_READY', lastEvent: null }, legacyShadow: { ready: false, state: 'NOT_READY', lastEvent: null }, test: { status: 'IDLE' } });
  });
  it('finishes at 22s while a lost/reacquired side is gated, without changing the other detector', () => {
    const { kick, frame } = setup(); kick.startTest(1100);
    frame(1150); frame(1200, 0, 0, 0, true); frame(1250, .8, .8);
    expect(kick.getView(1250).v3.leftTrackingState).toBe('REACQUIRED_NOT_READY');
    expect(kick.getView(23100).test).toMatchObject({ status: 'COMPLETED', eventCount: 0, waitingForArmed: false });
    expect(kick.getReplaySnapshot().guided.timings.every((s) => s.armedWaitMs === 0)).toBe(true);
  });
});
