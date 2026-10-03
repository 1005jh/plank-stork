// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { extractKneeMotionFeatures } from '../motion/kneeMotionFeatures';
import { motionFrame } from '../motion/testFixtures';
import { KneeKickDetectorV3, usableKneesV3, type KneeKickBaselineV3 } from './kneeKickDetectorV3';

const baseline: KneeKickBaselineV3 = { version: 3, leftXMedian: 0, rightXMedian: 0, leftYMedian: 0, rightYMedian: 0,
  leftDistanceMedian: 1, rightDistanceMedian: 1, bodyScale: 1 };
function features(left: number | null = 0, right: number | null = 0) {
  return { ...extractKneeMotionFeatures(motionFrame(0).landmarks), hipCenterY: 0, leftKneeY: left, rightKneeY: right,
    leftKneeCenterOffsetY: left, rightKneeCenterOffsetY: right };
}
function ready() { const detector = new KneeKickDetectorV3(); detector.setBaseline(baseline); return detector; }
function send(detector: KneeKickDetectorV3, time: number, left: number | null = 0, right: number | null = 0) { return detector.processFrame(features(left, right), time); }

describe('Y V3 production candidate', () => {
  it('A/B: below ENTER or 33ms above produces no event, including equality below the duration boundary', () => {
    const d = ready(); send(d, 0, 0.399); send(d, 100, 0.399);
    expect(send(d, 150, 0.5)).toBeNull(); expect(send(d, 183, 0.5)).toBeNull(); send(d, 184, 0.39);
    expect(d.getView(184).counts).toEqual({ KNEE_LEFT: 0, KNEE_RIGHT: 0 });
  });
  it('C: 67ms observed Y evidence emits once; 0.4 and 50ms boundaries are inclusive', () => {
    const d = ready(); send(d, 0, 0.4); expect(send(d, 49, 0.4)).toBeNull();
    expect(send(d, 50, 0.4)).toMatchObject({ direction: 'KNEE_LEFT', confirmationLatencyMs: 50, eventSource: 'NORMAL_TRACKING' });
    expect(send(d, 67, 0.4)).toBeNull(); expect(d.getStateForDiagnostics()).toBe('WAIT_RETURN');
    const other = ready(); send(other, 0, -0.5); expect(send(other, 67, -0.5)?.direction).toBe('KNEE_LEFT');
  });
  it.each(['LEFT', 'RIGHT'] as const)('D/E: %s alone can trigger; sign and the missing opposite limb never determine direction', (side) => {
    for (const sign of [-1, 1]) {
      const d = ready(), left = side === 'LEFT' ? sign * 0.5 : null, right = side === 'RIGHT' ? sign * 0.5 : null;
      send(d, 0, left, right);
      expect(send(d, 67, left, right)).toMatchObject({ direction: `KNEE_${side}`, crossGapConfirmation: false });
    }
  });
  it('F: only the triggered side must return, even if the opposite knee is missing', () => {
    const d = ready(); send(d, 0, 0.5, null); send(d, 67, 0.5, null);
    send(d, 100, 0.2, null); send(d, 199, 0.2, null); expect(d.getStateForDiagnostics()).toBe('WAIT_RETURN');
    send(d, 200, 0.2, null); expect(d.getStateForDiagnostics()).toBe('ARMED');
  });
  it('G: a long hold and 700ms return tail cannot generate duplicates', () => {
    const d = ready(); const emitted = [];
    for (let t = 0; t <= 2500; t += 25) { const e = send(d, t, t < 1700 ? 0.8 : t < 2400 ? 0.3 : 0); if (e) emitted.push(e); }
    expect(emitted).toHaveLength(1); expect(d.getStateForDiagnostics()).toBe('ARMED');
  });
  it('H/L: a brief loss discards the old 30ms run without imposing a full gate', () => {
    const d = ready(); send(d, 0, 0.6); send(d, 30, 0.6); send(d, 31, null);
    send(d, 40, 0.6); expect(send(d, 70, 0.6)).toBeNull();
    expect(d.getValuesForDiagnostics()).toMatchObject({ leftTrackingState: 'READY', leftEnterRunMs: 30, poseLossRunResets: 1 });
    expect(send(d, 90, 0.6)).toMatchObject({ candidateStartedAt: 40, confirmationLatencyMs: 50, crossGapConfirmation: false });
  });
  it('I/J/K: 66ms loss then sustained 1.2 stays disarmed; clear100 and a new kick recover', () => {
    const d = ready(); send(d, 0); send(d, 10, null); send(d, 43, null); send(d, 76, 1.2);
    for (let t = 100; t <= 1000; t += 25) expect(send(d, t, 1.2)).toBeNull();
    expect(d.getValuesForDiagnostics()).toMatchObject({ leftTrackingState: 'REACQUIRED_NOT_READY', leftLossDurationMs: 66, leftEnterRunMs: 0 });
    send(d, 1025); send(d, 1124); expect(d.getValuesForDiagnostics().leftTrackingState).toBe('REACQUIRED_NOT_READY');
    send(d, 1125); expect(d.getValuesForDiagnostics().leftTrackingState).toBe('READY');
    send(d, 1150, 0.5); expect(send(d, 1217, 0.5)).toMatchObject({ direction: 'KNEE_LEFT', eventSource: 'POST_REACQUISITION', confirmationLatencyMs: 67 });
  });
  it.each([32, 33])('L: loss duration %sms applies the inclusive 33ms policy', (duration) => {
    const d = ready(); send(d, 0); send(d, 10, null); send(d, 10 + duration, 0.8);
    expect(d.getValuesForDiagnostics().leftTrackingState).toBe(duration === 32 ? 'READY' : 'REACQUIRED_NOT_READY');
  });
  it('M: hip loss gates both sides; they recover independently', () => {
    const d = ready(); send(d, 0);
    d.processFrame({ ...features(), leftHipVisibility: 0.69 }, 10);
    d.processFrame({ ...features(), hipCenterY: null }, 43);
    send(d, 76, 0.8, 0); send(d, 176, 0.8, 0);
    expect(d.getValuesForDiagnostics()).toMatchObject({ hipLossEpisodes: 1, leftTrackingState: 'REACQUIRED_NOT_READY', rightTrackingState: 'READY' });
    send(d, 200, 0.8, -0.8); expect(send(d, 267, 0.8, -0.8)?.direction).toBe('KNEE_RIGHT');
  });
  it('N: simultaneous equal integration is AMBIGUOUS, requires BOTH clear, and never picks arbitrary LEFT', () => {
    const d = ready(); send(d, 0, 0.6, -0.6); expect(send(d, 50, 0.6, -0.6)).toBeNull();
    expect(d.getValuesForDiagnostics()).toMatchObject({ state: 'WAIT_CLEAR', ambiguityCount: 1 });
    send(d, 75, 0, null); send(d, 175, 0, null); expect(d.getStateForDiagnostics()).toBe('WAIT_CLEAR');
    send(d, 200); send(d, 300); expect(d.getStateForDiagnostics()).toBe('ARMED');
  });
  it('simultaneous dwell uses integrated evidence, while an earlier completed dwell wins immediately', () => {
    const d = ready(); send(d, 0, 0.5, 0.8); expect(send(d, 50, 0.5, 0.8)?.direction).toBe('KNEE_RIGHT');
    const a = ready(); send(a, 0, 0.5, 0); send(a, 25, 0.5, 2); expect(send(a, 50, 0.5, 2)?.direction).toBe('KNEE_LEFT');
  });
  it('O: irregular timestamps use elapsed milliseconds, not frame count; duplicates/retrograde frames do nothing', () => {
    const d = ready(); send(d, 0, 0.7); send(d, 3, 0.7); send(d, 49, 0.7);
    const snapshot = d.getValuesForDiagnostics(); send(d, 49, null); send(d, 10, null); expect(d.getValuesForDiagnostics()).toEqual(snapshot);
    expect(send(d, 82, 0.7)?.confirmationLatencyMs).toBe(82);
  });
  it('dt >=400ms cancels entry and clear continuity; UI clock reads cannot bridge the gap', () => {
    const d = ready(); send(d, 0, 0.8); d.getView(900);
    expect(send(d, 400, 0.8)).toBeNull(); expect(d.getValuesForDiagnostics()).toMatchObject({ gapRunResets: 1, leftTrackingState: 'REACQUIRED_NOT_READY' });
    send(d, 450); send(d, 850); expect(d.getValuesForDiagnostics().leftTrackingState).toBe('REACQUIRED_NOT_READY');
    send(d, 950); expect(d.getValuesForDiagnostics().leftTrackingState).toBe('READY');
  });
  it('missing triggered-side or equality at clear threshold resets return dwell, not the event latch', () => {
    const d = ready(); send(d, 0, 0.8); send(d, 50, 0.8); send(d, 75, 0.2);
    send(d, 150, null); send(d, 180, 0.2); send(d, 279, 0.25); send(d, 300, 0.2); send(d, 399, 0.2);
    expect(d.getStateForDiagnostics()).toBe('WAIT_RETURN'); send(d, 400, 0.2); expect(d.getStateForDiagnostics()).toBe('ARMED');
  });
  it('reads return protocol-compatible ready/validNow/state/lastEvent and mask stale values without mutating core', () => {
    const d = ready(); send(d, 0, 0.8); send(d, 67, 0.8); const before = d.getValuesForDiagnostics();
    expect(d.getView(467)).toMatchObject({ ready: true, validNow: false, state: 'WAIT_RETURN', currentEvent: 'NONE',
      diagnostics: { normalizedYLeft: null, leftTrackingState: 'LOST' }, lastEvent: { direction: 'KNEE_LEFT' } });
    expect(d.getValuesForDiagnostics()).toEqual(before);
  });
  it('baseline reset/recalibration clears runs, gates, events and counts; rejects invalid/missing baselines', () => {
    const d = ready(); send(d, 0, 0.8); send(d, 50, 0.8); d.restartTrial();
    expect(d.getView(50)).toMatchObject({ ready: true, state: 'ARMED', lastEvent: null, counts: { KNEE_LEFT: 0, KNEE_RIGHT: 0 } });
    d.setBaseline({ ...baseline, bodyScale: 0.001 }); expect(d.getView(50).ready).toBe(false);
    d.setBaseline({ ...baseline, leftYMedian: NaN }); expect(d.getView(50).state).toBe('NOT_READY');
    d.setBaseline(baseline); d.reset(); expect(d.getView(50).baseline).toBeNull();
  });
  it('Y usability preserves hip .7 / knee .5 guards and ignores an unusable opponent', () => {
    expect(usableKneesV3({ ...features(0, null), leftHipVisibility: 0.7, rightHipVisibility: 0.7, leftKneeVisibility: 0.5 })).toEqual({ hips: true, left: true, right: false });
    expect(usableKneesV3({ ...features(), leftKneeVisibility: 0.49 })).toMatchObject({ left: false, right: true });
    expect(usableKneesV3({ ...features(), leftKneeY: NaN })).toMatchObject({ left: false, right: true });
    expect(usableKneesV3({ ...features(), hipCenterY: null })).toEqual({ hips: false, left: false, right: false });
  });
});
