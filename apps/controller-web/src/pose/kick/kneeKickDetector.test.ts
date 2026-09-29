// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { extractKneeMotionFeatures } from '../motion/kneeMotionFeatures';
import { motionFrame } from '../motion/testFixtures';
import { KneeKickDetector, KICK_ENTER_DISPLACEMENT, KICK_EXIT_DISPLACEMENT, RETURN_DWELL_MS, type KneeKickBaseline } from './kneeKickDetector';

const baseline: KneeKickBaseline = { leftMedian: 0, rightMedian: 0, leftDistanceMedian: 1, rightDistanceMedian: 1, bodyScale: 1 };
function features(left = 0, right = 0) {
  return { ...extractKneeMotionFeatures(motionFrame(0).landmarks), leftKneeCenterOffsetX: left, rightKneeCenterOffsetX: right,
    leftKneeX: 0.5 + left, rightKneeX: 0.5 + right };
}
function ready() { const detector = new KneeKickDetector(); detector.setBaseline(baseline); return detector; }
function confirm(detector: KneeKickDetector, sign = -1, start = 0) {
  detector.processFrame(features(), start);
  expect(detector.processFrame(features(sign * 0.32), start + 40)).toBeNull();
  expect(detector.processFrame(features(sign * 0.64), start + 70)).toBeNull();
  return detector.processFrame(features(sign * 0.64), start + 100);
}

describe('experimental temporal knee kick detector v2', () => {
  it('recovers a rejected sway below ENTER immediately, but never spams above ENTER or on missing frames', () => {
    const detector = ready(); detector.processFrame(features(), 0);
    for (let time = 100; time <= 700; time += 100) detector.processFrame(features(0.29), time);
    expect(detector.getView(700)).toMatchObject({ state: 'WAIT_CLEAR', lastEvent: null });
    for (let time = 750; time <= 1000; time += 50) detector.processFrame(features(0.30), time);
    detector.processFrame(features(0.28), 1050);
    detector.processFrame(extractKneeMotionFeatures([]), 1100);
    expect(detector.getView(1100).state).toBe('WAIT_CLEAR');
    expect(detector.getValuesForDiagnostics()).toMatchObject({ candidateId: 1, candidateOutcome: 'TIMED_OUT' });
    expect(detector.processFrame(features(0.27), 1150)).toBeNull();
    expect(detector.getView(1150)).toMatchObject({ state: 'ARMED', lastEvent: null });
    expect(detector.processFrame(features(0.30), 1200)).toBeNull();
    expect(detector.getValuesForDiagnostics()).toMatchObject({ state: 'CANDIDATE', candidateId: 2 });
  });
  it('retains EXIT and the full 180ms return dwell after an actual confirmed event', () => {
    const detector = ready(); confirm(detector);
    for (const now of [150, 300, 450]) detector.processFrame(features(0.27), now);
    expect(detector.getView(450)).toMatchObject({ state: 'WAIT_RETURN', counts: { KNEE_LEFT: 1, KNEE_RIGHT: 0 } });
    detector.processFrame(features(0.14, 0.14), 500);
    detector.processFrame(features(0.14, 0.14), 679);
    expect(detector.getView(679).state).toBe('WAIT_RETURN');
    detector.processFrame(features(0.14, 0.14), 680);
    expect(detector.getView(680).state).toBe('ARMED');
  });
  it.each(['CANDIDATE', 'WAIT_CLEAR', 'WAIT_RETURN'] as const)('cleans all transient evidence from %s while preserving the exact Neutral baseline', (state) => {
    const detector = ready();
    if (state === 'WAIT_RETURN') confirm(detector);
    else { detector.processFrame(features(), 0); detector.processFrame(features(-0.5), 20); }
    const now = state === 'WAIT_CLEAR' ? 420 : 100;
    expect(detector.getView(now).state).toBe(state);
    detector.restartTrial();
    expect(detector.getView(now)).toMatchObject({ baseline, state: 'ARMED', validNow: false, usableLeftNow: false, usableRightNow: false,
      normalizedLeft: null, normalizedRight: null, lastEvent: null, counts: { KNEE_LEFT: 0, KNEE_RIGHT: 0 } });
    expect(detector.getValuesForDiagnostics()).toMatchObject({ candidateId: null, candidateFrameCount: 0, candidateOutcome: null });
    detector.processFrame(features(-0.7), now + 50);
    expect(detector.getView(now + 50).normalizedLeftVelocity).toBeNull();
    expect(detector.getValuesForDiagnostics()).toMatchObject({ candidateId: 1, candidatePeakAbsVelocity: 0 });
  });
  it('is NOT_READY before a valid baseline and rejects small/nonfinite body scales', () => {
    const detector = new KneeKickDetector();
    expect(detector.processFrame(features(-1), 0)).toBeNull();
    expect(detector.getView(0)).toMatchObject({ ready: false, state: 'NOT_READY', currentEvent: 'NONE' });
    for (const bodyScale of [0, -1, 0.009, NaN, Infinity]) {
      detector.setBaseline({ ...baseline, bodyScale }); expect(detector.getView(0).ready).toBe(false);
    }
  });
  it.each([-KICK_ENTER_DISPLACEMENT, KICK_ENTER_DISPLACEMENT])('starts a candidate at signed ENTER %s without an immediate event', (value) => {
    const detector = ready();
    expect(detector.processFrame(features(0, value), 10)).toBeNull();
    expect(detector.getView(10)).toMatchObject({ state: 'CANDIDATE', lastEvent: null, counts: { KNEE_LEFT: 0, KNEE_RIGHT: 0 } });
  });
  it('uses normalized signed deltas independently of landmark name and waits at least 60ms', () => {
    const detector = new KneeKickDetector(); detector.setBaseline({ ...baseline, leftMedian: -0.15, rightMedian: 0.15, bodyScale: 0.3 });
    detector.processFrame(features(-0.15, 0.15), 0);
    expect(detector.processFrame(features(-0.09, -0.03), 20)).toBeNull();
    expect(detector.getView(20).normalizedLeft).toBeCloseTo(0.2);
    expect(detector.getView(20).dominantNormalizedDisplacement).toBeCloseTo(-0.6);
    expect(detector.processFrame(features(-0.09, -0.03), 79)).toBeNull();
    expect(detector.processFrame(features(-0.09, -0.03), 80)?.direction).toBe('KNEE_LEFT');
  });
  it('CASE A: fast LEFT flip uses trajectory peaks rather than the first RIGHT crossing', () => {
    const detector = ready(); detector.processFrame(features(), 0);
    expect(detector.processFrame(features(-0.277, 0.304), 40)).toBeNull();
    expect(detector.processFrame(features(-0.360, 0.282), 70)).toBeNull();
    expect(detector.processFrame(features(-0.440, 0.280), 100)).toEqual({ id: 1, direction: 'KNEE_LEFT', timestamp: 100 });
    expect(detector.getValuesForDiagnostics()).toMatchObject({ candidatePositivePeak: 0.304, candidateNegativePeak: -0.44, confirmationLatencyMs: 60 });
  });
  it('CASE B: delayed LEFT flip confirms the later negative peak within 600ms', () => {
    const detector = ready(); detector.processFrame(features(), 0);
    expect(detector.processFrame(features(0.056, 0.294), 60)).toBeNull();
    for (const time of [160, 260, 360]) expect(detector.processFrame(features(0.056, 0.294), time)).toBeNull();
    expect(detector.processFrame(features(-0.329, 0.282), 460)).toBeNull();
    expect(detector.processFrame(features(-0.658, 0.28), 510)).toEqual({ id: 1, direction: 'KNEE_LEFT', timestamp: 510 });
    expect(detector.getValuesForDiagnostics().confirmationLatencyMs).toBe(450);
  });
  it('CASE C: low-velocity borderline Twist with only one usable knee times out without an event', () => {
    const detector = ready(); detector.processFrame(features(), 0);
    for (let time = 100; time <= 700; time += 100) {
      expect(detector.processFrame({ ...features(0, 0.285 + Math.min(0.057, (time - 100) * 0.0001)), leftKneeVisibility: 0.1 }, time)).toBeNull();
    }
    expect(detector.getView(700)).toMatchObject({ state: 'WAIT_CLEAR', lastEvent: null });
    expect(detector.getValuesForDiagnostics()).toMatchObject({ candidateOutcome: 'TIMED_OUT', candidateSawLeft: false, candidateSawRight: true });
  });
  it('CASE D: Neutral sway lacks confirmation displacement/velocity and does not repeatedly start candidates', () => {
    const detector = ready(); detector.processFrame(features(), 0);
    for (let time = 100; time <= 1200; time += 100) expect(detector.processFrame(features(0, time % 200 ? 0.29 : 0.33), time)).toBeNull();
    expect(detector.getValuesForDiagnostics()).toMatchObject({ candidateId: 1, candidateOutcome: 'TIMED_OUT' });
    expect(detector.getView(1200).counts).toEqual({ KNEE_LEFT: 0, KNEE_RIGHT: 0 });
  });
  it('CASE E: genuine RIGHT confirms once then remains latched through hold and visibility interruption', () => {
    const detector = ready(); expect(confirm(detector, 1)).toEqual({ id: 1, direction: 'KNEE_RIGHT', timestamp: 100 });
    for (let now = 150; now <= 500; now += 50) expect(detector.processFrame(features(0.7), now)).toBeNull();
    expect(detector.processFrame(extractKneeMotionFeatures([]), 550)).toBeNull();
    expect(detector.getView(550)).toMatchObject({ state: 'WAIT_RETURN', validNow: false, normalizedLeft: null });
    expect(detector.processFrame(features(-0.7), 600)).toBeNull();
    expect(detector.getView(600).counts).toEqual({ KNEE_LEFT: 0, KNEE_RIGHT: 1 });
  });
  it('requires BOTH sides strictly inside EXIT for the full dwell, then permits the opposite event', () => {
    const detector = ready(); confirm(detector);
    detector.processFrame(features(0, KICK_EXIT_DISPLACEMENT), 150);
    detector.processFrame(features(0, KICK_EXIT_DISPLACEMENT), 300);
    expect(detector.getView(300).state).toBe('WAIT_RETURN');
    detector.processFrame(features(), 350);
    detector.processFrame(features(), 350 + RETURN_DWELL_MS - 1);
    expect(detector.getView(529).state).toBe('WAIT_RETURN');
    detector.processFrame(features(), 350 + RETURN_DWELL_MS);
    expect(detector.getView(530).state).toBe('ARMED');
    expect(confirm(detector, 1, 550)).toMatchObject({ id: 2, direction: 'KNEE_RIGHT' });
  });
  it('resets return dwell on missing data and large frame gaps without resetting the latch', () => {
    const detector = ready(); confirm(detector);
    detector.processFrame(features(), 150);
    detector.processFrame({ ...features(), leftKneeVisibility: 0.1 }, 300);
    detector.processFrame(features(), 330);
    expect(detector.getView(330).state).toBe('WAIT_RETURN');
    detector.processFrame(features(), 730); expect(detector.getView(730).state).toBe('WAIT_RETURN');
    detector.processFrame(features(), 910); expect(detector.getView(910).state).toBe('ARMED');
  });
  it('never starts on stale pose, missing hips or two unusable knees', () => {
    const detector = ready();
    expect(detector.processFrame(extractKneeMotionFeatures([]), 0)).toBeNull();
    expect(detector.processFrame({ ...features(-1), leftHipVisibility: 0.69 }, 50)).toBeNull();
    expect(detector.processFrame({ ...features(-1, 1), leftKneeVisibility: 0.49, rightKneeVisibility: null }, 100)).toBeNull();
    expect(detector.getView(100)).toMatchObject({ state: 'ARMED', validNow: false, currentEvent: 'NONE' });
  });
  it.each(['left', 'right'] as const)('can start with only %s visible but cannot confirm without the other knee', (side) => {
    const detector = ready(); detector.processFrame(features(), 0);
    for (const time of [40, 70, 100, 200, 300, 400, 500, 640]) {
      const values = features(-0.6, 0.7); values[side === 'left' ? 'rightKneeVisibility' : 'leftKneeVisibility'] = null;
      expect(detector.processFrame(values, time)).toBeNull();
    }
    expect(detector.getView(640).state).toBe('WAIT_CLEAR');
  });
  it('can collect the two usable knees on different candidate frames', () => {
    const detector = ready(); detector.processFrame(features(), 0);
    expect(detector.processFrame({ ...features(-0.4), rightKneeVisibility: null }, 40)).toBeNull();
    expect(detector.processFrame({ ...features(-0.5), rightKneeVisibility: null }, 70)).toBeNull();
    expect(detector.processFrame({ ...features(0, 0.1), leftKneeVisibility: null }, 100)?.direction).toBe('KNEE_LEFT');
  });
  it('rejects high velocity without enough displacement and large displacement without velocity', () => {
    for (const [crossing, peak] of [[0.3, 0.33], [0.29, 0.65]]) {
      const detector = ready(); detector.processFrame(features(), 0);
      const start = peak > 0.34 ? 200 : 20;
      detector.processFrame(features(crossing), start);
      for (let offset = 100; offset <= 600; offset += 100) expect(detector.processFrame(features(crossing + (peak - crossing) * offset / 600), start + offset)).toBeNull();
      expect(detector.getView(start + 600).state).toBe('WAIT_CLEAR');
    }
  });
  it('requires direction margin and never confirms at or after the 600ms timeout boundary', () => {
    const detector = ready(); detector.processFrame(features(), 0);
    detector.processFrame(features(-0.5, 0.5), 20);
    for (const time of [80, 200, 300, 400, 500]) expect(detector.processFrame(features(-0.5, 0.5), time)).toBeNull();
    expect(detector.processFrame(features(-1, 0.1), 620)).toBeNull();
    expect(detector.getValuesForDiagnostics().candidateOutcome).toBe('TIMED_OUT');
  });
  it('accepts inclusive displacement/velocity/margin thresholds once the minimum time is reached', () => {
    const detector = ready(); detector.processFrame(features(0.04, -0.26), 0);
    expect(detector.processFrame(features(0.34, -0.26), 60)).toBeNull();
    expect(detector.processFrame(features(0.34, -0.26), 119)).toBeNull();
    expect(detector.processFrame(features(0.34, -0.26), 120)?.direction).toBe('KNEE_RIGHT');
    expect(detector.getValuesForDiagnostics().candidatePeakAbsVelocity).toBeCloseTo(5);
    expect(detector.getValuesForDiagnostics().candidateDirectionMargin).toBeCloseTo(0.08);
  });
  it('cancels a stale candidate before consuming a resumed fresh frame without relying on UI ticks', () => {
    const detector = ready(); detector.processFrame(features(), 0);
    detector.processFrame(features(-0.5), 20);
    expect(detector.processFrame(features(-1), 420)).toBeNull();
    expect(detector.getValuesForDiagnostics()).toMatchObject({ state: 'WAIT_CLEAR', candidateOutcome: 'STALE', candidateEndedAt: 420 });
  });
  it.each(['no-frames', 'invalid-frames'] as const)('cancels long stale candidate (%s), with no confirmation on return', (mode) => {
    const detector = ready(); detector.processFrame(features(), 0);
    detector.processFrame(features(-0.5), 20);
    if (mode === 'invalid-frames') for (let time = 100; time <= 400; time += 100) detector.processFrame(extractKneeMotionFeatures([]), time);
    expect(detector.getView(420).state).toBe('WAIT_CLEAR');
    expect(detector.getValuesForDiagnostics().candidateOutcome).toBe('STALE');
    expect(detector.processFrame(features(-1), 450)).toBeNull();
  });
  it('never confirms on a short invalid frame even with accumulated evidence', () => {
    const detector = ready(); detector.processFrame(features(), 0);
    detector.processFrame(features(-0.6), 20);
    expect(detector.processFrame(extractKneeMotionFeatures([]), 80)).toBeNull();
    expect(detector.getView(80).state).toBe('CANDIDATE');
    expect(detector.processFrame(features(-0.6), 100)?.direction).toBe('KNEE_LEFT');
  });
  it('expires event display while retaining historical counts and masks stale debug values', () => {
    const detector = ready(); confirm(detector);
    for (let now = 150; now <= 900; now += 50) detector.processFrame(features(-0.6), now);
    expect(detector.getView(900)).toMatchObject({ currentEvent: 'NONE', lastEvent: { id: 1 }, state: 'WAIT_RETURN' });
    expect(detector.getView(1300)).toMatchObject({ validNow: false, normalizedLeft: null, normalizedLeftVelocity: null });
  });
  it('computes body-normalized relative velocity and excludes a previously invisible knee', () => {
    const detector = new KneeKickDetector(); detector.setBaseline({ ...baseline, bodyScale: 0.5 });
    detector.processFrame({ ...features(), leftKneeVisibility: 0.1 }, 0);
    detector.processFrame({ ...features(0.1), hipCenterX: 0.52, leftKneeX: 0.62, rightKneeX: 0.52 }, 100);
    expect(detector.getView(100).normalizedLeftVelocity).toBeNull();
    expect(detector.getView(100).normalizedRightVelocity).toBeCloseTo(0);
    detector.processFrame({ ...features(0.2), hipCenterX: 0.54, leftKneeX: 0.74, rightKneeX: 0.54 }, 200);
    expect(detector.getView(200).normalizedLeftVelocity).toBeCloseTo(2);
  });
  it('ignores duplicate/backward frames and resets candidate, counts, baseline and pending state', () => {
    const detector = ready(); detector.processFrame(features(-0.4), 100);
    expect(detector.processFrame(features(0.4), 100)).toBeNull(); expect(detector.processFrame(features(0.4), 50)).toBeNull();
    expect(detector.getValuesForDiagnostics().candidateFrameCount).toBe(1);
    detector.reset();
    expect(detector.getView(200)).toMatchObject({ state: 'NOT_READY', lastEvent: null, counts: { KNEE_LEFT: 0, KNEE_RIGHT: 0 }, normalizedLeftVelocity: null });
    expect(detector.getValuesForDiagnostics()).toMatchObject({ candidateId: null, candidateActive: false, candidateFrameCount: 0 });
  });
});
