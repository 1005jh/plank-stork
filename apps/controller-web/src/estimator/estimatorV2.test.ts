// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readyCapture } from '../replay/v2TestFixtures';
import { readReplaySession } from '../replay/readReplaySession';
import type { ReplaySession } from '../replay/replayTypes';
import { analyzeEstimator, rebuildEstimatorBaseline, estimatorNeutralWindow } from './estimatorAnalysis';
import type { EstimatorRun } from './estimatorInference';
import { neutralCalibrationWindow, flexionBaseline } from '../discovery/multiSignalFeatures';
import { segmentBaseline } from '../discovery/integrityFeatures';
import { fullV3Trial } from '../replay/testFixtures';
let session: ReplaySession, run: EstimatorRun;
beforeAll(async () => {
  const { capture, kick, read, frame } = readyCapture(); kick.startTest(3101); capture.observe({ kind: 'START', timestamp: 3101 }, read);
  for (let t = 3150; t <= 25150; t += 50) frame(t);
  await capture.stop(25200); session = readReplaySession(capture.getFiles().json);
  run = { frames: session.poseFrames.map((f) => ({ ...structuredClone(f), posePresent: true, inferenceMs: 10 })),
    variant: 'FULL_VIDEO_CONTROL', config: {} as never, mediaIdentity: {} as never, sequence: {} as never,
    frameSequenceParity: true, clock: 'decoded media PTS * 1000 = existing VIDEO replay capture tMs mapping' };
});
describe('V2 estimator-only frozen reference', () => {
  it('uses exactly the captured 3s for every variant, reconstructing its own numeric baseline', () => {
    const windows = [];
    for (const [i, variant] of ['FULL_VIDEO_CONTROL', 'FULL_IMAGE', 'HEAVY_VIDEO'].entries()) {
      const variantRun = structuredClone(run); variantRun.variant = variant as EstimatorRun['variant'];
      variantRun.frames.forEach((f) => f.landmarks.forEach((p) => { p.x *= i + 1; p.y *= i + 1; }));
      const b = rebuildEstimatorBaseline(session, session.liveResult.trials[0], variantRun, 'REFERENCE_LIVE_1');
      expect(b).toMatchObject({ neutralFrameCount: 60, leftUsableSamples: 60, rightUsableSamples: 60, baselineStatus: 'READY' });
      expect(b.y!.bodyScale).toBeCloseTo(session.liveResult.trials[0].baselineV3!.bodyScale * (i + 1)); windows.push(b.window);
    }
    expect(windows[0]).toMatchObject({ source: 'ESTIMATOR_NEUTRAL_REFERENCE', startMs: 100, endMs: 3100 });
    expect(windows[1]).toEqual(windows[0]); expect(windows[2]).toEqual(windows[0]);
  });
  it('never borrows another baseline when a variant has fewer than 20 usable samples', () => {
    const missing = structuredClone(run); missing.frames.forEach((f, i) => { if (i >= 19 && f.tMs <= 3100) { f.landmarks = []; f.worldLandmarks = []; } });
    const b = rebuildEstimatorBaseline(session, session.liveResult.trials[0], missing, 'REFERENCE_LIVE_1');
    expect(b).toMatchObject({ neutralFrameCount: 60, leftUsableSamples: 19, rightUsableSamples: 19, bodyScale: null, y: null, baselineStatus: 'INSUFFICIENT_VARIANT_NEUTRAL' });
    const result = analyzeEstimator({ session, role: 'REFERENCE_LIVE_1', filename: 'v2.json' }, missing, []);
    expect(result.trials[0]).toMatchObject({ baselineStatus: 'INSUFFICIENT_VARIANT_NEUTRAL', detectorReplay: null });
  });
  it('passes the same reference to fixed flexion/segment reconstruction and leaves production window unchanged', () => {
    const trial = session.liveResult.trials[0], reference = estimatorNeutralWindow(session, trial, 'REFERENCE_LIVE_1');
    expect(flexionBaseline(session, trial, 'LATEST_FROZEN', reference).frameCount).toBe(60);
    expect(segmentBaseline(session, trial, 'LATEST_FROZEN', reference).frameCount).toBe(60);
    const production = neutralCalibrationWindow(session, trial, 'LATEST_FROZEN');
    expect(production.endMs - production.startMs).toBe(1000); expect(production.frames).toHaveLength(20);
    const result = analyzeEstimator({ session, role: 'REFERENCE_LIVE_1', filename: 'v2.json' }, run, []);
    expect(result.trials[0].detectorReplay).not.toBeNull();
    expect(result.trials[0].baseline.window).toMatchObject({ startMs: 100, endMs: 3100 });
  });
  it('rejects a missing reference and malformed/mutated reference metadata', () => {
    const missing = structuredClone(session); delete missing.liveResult.trials[0].estimatorNeutralReference;
    expect(() => rebuildEstimatorBaseline(missing, missing.liveResult.trials[0], run, 'REFERENCE_OLD_CLEAN')).toThrow('INVALID_MISSING_ESTIMATOR_REFERENCE');
    for (const edit of [
      (s: ReplaySession) => { s.liveResult.trials[0].estimatorNeutralReference!.endMs++; },
      (s: ReplaySession) => { s.liveResult.trials[0].estimatorNeutralReference!.analysisReadyFrameCount = 59; },
      (s: ReplaySession) => { s.liveResult.trials[0].estimatorNeutralReference!.perJointUsableFrames.LEFT_ANKLE = 59; },
    ]) { const invalid = structuredClone(session); edit(invalid); expect(() => readReplaySession(JSON.stringify(invalid))).toThrow('Replay JSON'); }
  });
  it('retains the exact V1 window and report shape without fabricating a reference', async () => {
    const old = (await fullV3Trial()).session!, original = JSON.stringify(old);
    const b = rebuildEstimatorBaseline(old, old.liveResult.trials[0], { frames: old.poseFrames.map((f) => ({ ...f, posePresent: true, inferenceMs: 10 })) }, 'REFERENCE_LIVE_1');
    expect(b.window.endMs - b.window.startMs).toBe(1000); expect(b).not.toHaveProperty('neutralFrameCount');
    expect(Object.keys(b)).toEqual(['window', 'y', 'geometry']); expect(JSON.stringify(old)).toBe(original);
  });
});
