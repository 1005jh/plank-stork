// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { KneeKickEvent } from '@plank-stork/protocol';
import { PoseFeatureAnalysis } from '../features/poseFeatureAnalysis';
import { motionFrame } from '../motion/testFixtures';
import { extractKneeMotionFeatures } from '../motion/kneeMotionFeatures';
import { KneeKickAnalysis } from './kneeKickAnalysis';
import { KneeKickDetector } from './kneeKickDetector';
import type { KickDiagnosticDataset } from './kneeKickDiagnostics';

const read = (analysis: KneeKickAnalysis) => JSON.parse(analysis.exportDiagnosticsJson()) as KickDiagnosticDataset;
function calibrated(offCenter = false) {
  const neutral = new PoseFeatureAnalysis(), analysis = new KneeKickAnalysis();
  neutral.startCalibration(0);
  for (let index = 1; index <= 20; index++) {
    const frame = motionFrame(index * 50);
    if (offCenter) {
      frame.landmarks.forEach((point) => { point.x += 0.1 + index / 100 - 0.5; });
      frame.landmarks[25].visibility = index % 2 ? 0.6 : 0.8;
    }
    neutral.processFrame(frame.landmarks, frame.worldLandmarks, frame.timestamp);
    analysis.processFrame(frame, neutral.getView(frame.timestamp));
  }
  return { neutral, analysis };
}

describe('diagnostics preserve STEP 4E detector behavior', () => {
  it('preserves exact legacy event direction, timing, count and final state with diagnostics ACTIVE', () => {
    const observed = calibrated(), control = calibrated();
    expect(observed.analysis.startTest(1000)).toBe(true);
    const trace = [
      [1050, -0.15, 'ok'], [1100, -0.15, 'ok'], [1150, 0, 'missing'], [1200, -0.15, 'ok'],
      [1250, 0, 'ok'], [1300, 0, 'ok'], [1350, 0, 'ok'], [1400, 0, 'ok'], [1450, 0, 'ok'],
      [1500, 0.15, 'ok'], [1550, 0, 'ok'], [1600, 0, 'hip-hidden'], [1650, 0, 'ok'],
      [2100, 0, 'ok'], [2150, 0, 'ok'], [2200, 0, 'ok'], [2250, 0, 'ok'], [2300, 0, 'ok'], [2350, -0.15, 'ok'],
    ] as const;
    const seen: KneeKickEvent[] = [];
    const getView = vi.spyOn(KneeKickDetector.prototype, 'getView');
    try {
      for (const [timestamp, delta, quality] of trace) {
        const frame = motionFrame(timestamp); frame.landmarks[26].x += delta;
        if (quality === 'missing') { frame.landmarks = []; frame.worldLandmarks = []; }
        if (quality === 'hip-hidden') frame.landmarks[23].visibility = 0.1;
        getView.mockClear();
        for (const engine of [observed, control]) {
          engine.neutral.processFrame(frame.landmarks, frame.worldLandmarks, timestamp);
          engine.analysis.processFrame(frame, engine.neutral.getView(timestamp));
        }
        // No extra view reads inside per-frame instrumentation (getView can mutate return dwell).
        expect(getView).not.toHaveBeenCalled();
        const current = observed.analysis.getView(timestamp).detector;
        expect(current).toEqual(control.analysis.getView(timestamp).detector);
        if (current.lastEvent && current.lastEvent.id !== seen.at(-1)?.id) seen.push(current.lastEvent);
      }
      expect(seen).toEqual([
        { id: 1, direction: 'KNEE_LEFT', timestamp: 1050 },
        { id: 2, direction: 'KNEE_RIGHT', timestamp: 1500 },
        { id: 3, direction: 'KNEE_LEFT', timestamp: 2350 },
      ]);
      expect(observed.analysis.getView(23000).detector).toMatchObject({ state: 'WAIT_RETURN', counts: { KNEE_LEFT: 2, KNEE_RIGHT: 1 } });
      expect(control.analysis.getView(23000).detector).toEqual(observed.analysis.getView(23000).detector);
      const dataset = read(observed.analysis);
      expect(dataset.frames.flatMap((frame) => frame.event ? [frame.event] : [])).toEqual(seen);
      expect(dataset.frames[0]).toMatchObject({ stateBefore: 'ARMED', stateAfter: 'WAIT_RETURN', usableLeft: true, usableRight: true });
      expect(dataset.frames.find((frame) => frame.timestamp === 1150)).toMatchObject({ poseFresh: false, usableLeft: false, usableRight: false,
        normalizedLeft: null, normalizedRight: null, dominantNormalizedDisplacement: null, event: null, stateBefore: 'WAIT_RETURN', stateAfter: 'WAIT_RETURN' });
      expect(dataset.frames.find((frame) => frame.timestamp === 1450)).toMatchObject({ stateBefore: 'WAIT_RETURN', stateAfter: 'ARMED' });
      expect(dataset.existingGuidedSummary.NEUTRAL.falseKickCount).toBe(3);
    } finally { getView.mockRestore(); }
  });

  it('reads exact derived values without changing any detector state or pending dwell', () => {
    const detector = new KneeKickDetector();
    detector.setBaseline({ leftMedian: -0.15, rightMedian: 0.15, leftDistanceMedian: 0.3, rightDistanceMedian: 0.3, bodyScale: 0.3 });
    const moved = motionFrame(0); moved.landmarks[26].x -= 0.15;
    detector.processFrame(extractKneeMotionFeatures(moved.landmarks), 0, true);
    detector.processFrame(extractKneeMotionFeatures(motionFrame(50).landmarks), 50, true);
    const before = JSON.stringify(detector);
    for (let index = 0; index < 10; index++) {
      expect(detector.getStateForDiagnostics()).toBe('WAIT_RETURN');
      const values = detector.getValuesForDiagnostics(); values.normalizedLeft = 999;
    }
    expect(JSON.stringify(detector)).toBe(before);
    detector.processFrame(extractKneeMotionFeatures(motionFrame(230).landmarks), 230, true);
    expect(detector.getStateForDiagnostics()).toBe('ARMED');
    expect(detector.getValuesForDiagnostics().normalizedLeft).toBeCloseTo(0);
  });

  it('keeps WAIT_RETURN test starts allowed and snapshots actual start state and neutral off-center data', () => {
    const { analysis, neutral } = calibrated(true);
    const moved = motionFrame(1050); moved.landmarks.forEach((point) => { point.x -= 0.295; }); moved.landmarks[26].x -= 0.15;
    neutral.processFrame(moved.landmarks, moved.worldLandmarks, moved.timestamp);
    analysis.processFrame(moved, neutral.getView(1050));
    expect(analysis.getView(1050).detector.state).toBe('WAIT_RETURN');
    expect(analysis.startTest(1050)).toBe(true);
    expect(analysis.startTest(1100)).toBe(false);
    analysis.getView(23050);
    const dataset = read(analysis);
    expect(dataset.testStart).toEqual({ detectorState: 'WAIT_RETURN', ready: true, valid: true });
    expect(dataset.baseline.detector!.bodyScale).toBeCloseTo(Math.hypot(0.05, 0.3));
    const diagnostic = dataset.baseline.diagnostics!;
    expect(diagnostic.hipCenterX.sampleCount).toBe(20);
    expect(diagnostic.hipCenterX.median).toBeCloseTo(0.205);
    expect(diagnostic.hipCenterX.p10).toBeCloseTo(0.12); expect(diagnostic.hipCenterX.p90).toBeCloseTo(0.28);
    expect(diagnostic.leftKneeVisibility.median).toBeCloseTo(0.7);
    expect(dataset.frames).toEqual([]);
    expect(dataset.stageSummaries.every((stage) => stage.stateAtStageStart === null)).toBe(true);
  });

  it('resets only test diagnostics on resetTest, clears all on analysis reset, and never mixes new runs', () => {
    const { analysis, neutral } = calibrated();
    analysis.startTest(1000);
    const moved = motionFrame(1050); moved.landmarks[26].x -= 0.15;
    analysis.processFrame(moved, neutral.getView(1050));
    const before = analysis.getView(1050).detector;
    analysis.resetTest();
    expect(analysis.getView(1050).detector).toEqual(before);
    expect(analysis.getDiagnosticSummary()).toEqual([]); expect(() => analysis.exportDiagnosticsJson()).toThrow();
    analysis.startTest(1050);
    analysis.getView(23050); expect(read(analysis).frames).toEqual([]);
    analysis.reset();
    expect(analysis.getView(23050).detector.ready).toBe(false);
    expect(analysis.getDiagnosticSummary()).toEqual([]); expect(() => analysis.exportDiagnosticsJson()).toThrow();
  });
});
