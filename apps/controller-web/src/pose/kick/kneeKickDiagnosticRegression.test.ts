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
  const neutral = new PoseFeatureAnalysis(), analysis = new KneeKickAnalysis(); neutral.startCalibration(0);
  for (let index = 1; index <= 20; index++) {
    const frame = motionFrame(index * 50);
    if (offCenter) { frame.landmarks.forEach((point) => { point.x += 0.1 + index / 100 - 0.5; }); frame.landmarks[25].visibility = index % 2 ? 0.6 : 0.8; }
    neutral.processFrame(frame.landmarks, frame.worldLandmarks, frame.timestamp);
    analysis.processFrame(frame, neutral.getView(frame.timestamp));
  }
  return { neutral, analysis };
}
function frameAt(engine: ReturnType<typeof calibrated>, timestamp: number, delta = 0, originShift = 0) {
  const frame = motionFrame(timestamp); frame.landmarks.forEach((point) => { point.x += originShift; }); frame.landmarks[26].x += delta;
  engine.neutral.processFrame(frame.landmarks, frame.worldLandmarks, timestamp); engine.analysis.processFrame(frame, engine.neutral.getView(timestamp));
}
function finish(engine: ReturnType<typeof calibrated>, now: number, originShift = 0) {
  for (let time = now + 50; time <= now + 25000; time += 50) {
    frameAt(engine, time, 0, originShift);
    if (engine.analysis.getView(time).test.status === 'COMPLETED') return;
  }
  throw new Error('Test did not complete after fresh Neutral frames');
}

describe('diagnostics preserve temporal STEP 4E-v2 detector behavior', () => {
  it('preserves event direction/timing/count/state with diagnostics ACTIVE and records candidate confirmation', () => {
    const observed = calibrated(), control = calibrated();
    expect(observed.analysis.startTest(1000)).toBe(true);
    control.analysis.resetTest();
    frameAt(observed, 1025); frameAt(control, 1025);
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
        expect(getView).not.toHaveBeenCalled();
        const current = observed.analysis.getView(timestamp).detector;
        expect(current).toEqual(control.analysis.getView(timestamp).detector);
        if (current.lastEvent && current.lastEvent.id !== seen.at(-1)?.id) seen.push(current.lastEvent);
      }
      expect(seen).toEqual([{ id: 1, direction: 'KNEE_LEFT', timestamp: 1200 }, { id: 2, direction: 'KNEE_RIGHT', timestamp: 1650 }]);
      expect(observed.analysis.getView(2350).detector).toMatchObject({ state: 'CANDIDATE', counts: { KNEE_LEFT: 1, KNEE_RIGHT: 1 } });
      // Retain a reliable observation gap: pending candidates expire without a phantom confirmation.
      for (let time = 3000; time <= 26000; time += 50) {
        frameAt(observed, time); frameAt(control, time);
        expect(observed.analysis.getView(time).detector).toEqual(control.analysis.getView(time).detector);
      }
      const dataset = read(observed.analysis);
      expect(dataset.version).toBe(3);
      expect(dataset.frames.flatMap((frame) => frame.event ? [frame.event] : [])).toEqual(seen);
      expect(dataset.frames.find((frame) => frame.timestamp === 1050)).toMatchObject({ stateBefore: 'ARMED', stateAfter: 'CANDIDATE', candidateActive: true, candidateAgeMs: 0 });
      expect(dataset.frames.find((frame) => frame.timestamp === 1150)).toMatchObject({ poseFresh: false, usableLeft: false, usableRight: false, normalizedLeft: null, event: null, stateBefore: 'CANDIDATE', stateAfter: 'CANDIDATE' });
      expect(dataset.frames.find((frame) => frame.timestamp === 1200)).toMatchObject({ stateBefore: 'CANDIDATE', stateAfter: 'WAIT_RETURN', candidateOutcome: 'CONFIRMED', confirmationLatencyMs: 150 });
      expect(dataset.frames.find((frame) => frame.timestamp === 1450)).toMatchObject({ stateBefore: 'WAIT_RETURN', stateAfter: 'ARMED' });
      expect(dataset.stageSummaries.reduce((sum, stage) => sum + stage.confirmedCandidateCount, 0)).toBe(2);
      expect(dataset.stageTimings.every((stage) => stage.armedWaitMs === 0)).toBe(true);
      expect(dataset.existingGuidedSummary.NEUTRAL.falseKickCount).toBe(2);
    } finally { getView.mockRestore(); }
  });
  it('reads exact candidate/derived values without changing detector state or return dwell', () => {
    const detector = new KneeKickDetector(); detector.setBaseline({ leftMedian: -0.15, rightMedian: 0.15, leftDistanceMedian: 0.3, rightDistanceMedian: 0.3, bodyScale: 0.3 });
    detector.processFrame(extractKneeMotionFeatures(motionFrame(0).landmarks), 0);
    const moved = motionFrame(20); moved.landmarks[26].x -= 0.15;
    detector.processFrame(extractKneeMotionFeatures(moved.landmarks), 20);
    const before = JSON.stringify(detector);
    for (let index = 0; index < 10; index++) { expect(detector.getStateForDiagnostics()).toBe('CANDIDATE'); const values = detector.getValuesForDiagnostics(); values.normalizedLeft = 999; values.candidateAgeMs = 999; }
    expect(JSON.stringify(detector)).toBe(before);
    detector.processFrame(extractKneeMotionFeatures(moved.landmarks), 80);
    expect(detector.getStateForDiagnostics()).toBe('WAIT_RETURN');
    detector.processFrame(extractKneeMotionFeatures(motionFrame(100).landmarks), 100);
    detector.getValuesForDiagnostics(); detector.processFrame(extractKneeMotionFeatures(motionFrame(280).landmarks), 280);
    expect(detector.getStateForDiagnostics()).toBe('ARMED');
  });
  it('starts from a candidate and snapshots neutral off-center data', () => {
    const engine = calibrated(true);
    frameAt(engine, 1050, -0.15, -0.295);
    expect(engine.analysis.getView(1050).detector.state).toBe('CANDIDATE'); expect(engine.analysis.startTest(1050)).toBe(true);
    engine.analysis.resetTest();
    frameAt(engine, 1150, -0.15, -0.295);
    expect(engine.analysis.startTest(1150)).toBe(true); engine.analysis.resetTest();
    for (const time of [1200, 1250, 1300, 1350, 1400]) frameAt(engine, time, 0, -0.295);
    expect(engine.analysis.startTest(1400)).toBe(true); expect(engine.analysis.startTest(1450)).toBe(false);
    finish(engine, 1400, -0.295);
    const dataset = read(engine.analysis);
    expect(dataset.testStart).toEqual({ detectorState: 'ARMED', ready: true, valid: true });
    expect(dataset.baseline.detector!.bodyScale).toBeCloseTo(Math.hypot(0.05, 0.3));
    const diagnostic = dataset.baseline.diagnostics!;
    expect(diagnostic.hipCenterX.sampleCount).toBe(20); expect(diagnostic.hipCenterX.median).toBeCloseTo(0.205);
    expect(diagnostic.hipCenterX.p10).toBeCloseTo(0.12); expect(diagnostic.hipCenterX.p90).toBeCloseTo(0.28);
    expect(diagnostic.leftKneeVisibility.median).toBeCloseTo(0.7);
  });
  it('resetTest clears a pending candidate/latch, preserves baseline and never mixes restarted runs', () => {
    const engine = calibrated(); engine.analysis.startTest(1000); frameAt(engine, 1050, -0.15);
    const before = engine.analysis.getView(1050).detector;
    engine.analysis.resetTest(); expect(engine.analysis.getView(1050).detector).toMatchObject({ baseline: before.baseline, state: 'ARMED', lastEvent: null });
    expect(engine.analysis.getDiagnosticSummary()).toEqual([]); expect(() => engine.analysis.exportDiagnosticsJson()).toThrow();
    expect(engine.analysis.startTest(1050)).toBe(true);
    engine.analysis.resetTest();
    frameAt(engine, 1150, -0.15); engine.analysis.resetTest(); expect(engine.analysis.startTest(1150)).toBe(true); engine.analysis.resetTest();
    for (const time of [1200, 1250, 1300, 1350, 1400]) frameAt(engine, time);
    engine.analysis.startTest(1400); finish(engine, 1400);
    expect(read(engine.analysis).frames.every((frame) => frame.timestamp > 1400)).toBe(true);
    engine.analysis.reset(); expect(engine.analysis.getView(24000).detector.ready).toBe(false);
    expect(engine.analysis.getDiagnosticSummary()).toEqual([]); expect(() => engine.analysis.exportDiagnosticsJson()).toThrow();
  });
});
