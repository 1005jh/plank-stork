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

describe('experimental displacement-only knee kick detector', () => {
  it('is NOT_READY before a valid baseline and rejects small/nonfinite body scales', () => {
    const detector = new KneeKickDetector();
    expect(detector.processFrame(features(-1), 0, true)).toBeNull();
    expect(detector.getView(0)).toMatchObject({ ready: false, state: 'NOT_READY', currentEvent: 'NONE' });
    for (const bodyScale of [0, -1, 0.009, NaN, Infinity]) {
      detector.setBaseline({ ...baseline, bodyScale });
      expect(detector.getView(0).ready).toBe(false);
    }
  });

  it.each([[-KICK_ENTER_DISPLACEMENT, 'KNEE_LEFT'], [KICK_ENTER_DISPLACEMENT, 'KNEE_RIGHT']] as const)('triggers exactly at signed ENTER %s', (value, direction) => {
    const detector = ready();
    expect(detector.processFrame(features(0, value), 10, true)).toEqual({ id: 1, direction, timestamp: 10 });
    expect(detector.getView(10)).toMatchObject({ state: 'WAIT_RETURN', lastEvent: { direction }, counts: { [direction]: 1 } });
  });

  it('uses the larger signed normalized delta, independently of landmark name', () => {
    const detector = new KneeKickDetector(); detector.setBaseline({ ...baseline, leftMedian: -0.15, rightMedian: 0.15, bodyScale: 0.3 });
    expect(detector.processFrame(features(-0.09, 0.03), 10, true)?.direction).toBe('KNEE_LEFT');
    expect(detector.getView(10).normalizedLeft).toBeCloseTo(0.2);
    expect(detector.getView(10).dominantNormalizedDisplacement).toBeCloseTo(-0.4);
  });

  it('holds outside without duplicates, even after a visibility interruption and opposite crossing', () => {
    const detector = ready(); detector.processFrame(features(-0.4), 0, true);
    for (let now = 50; now <= 500; now += 50) expect(detector.processFrame(features(-0.5), now, true)).toBeNull();
    expect(detector.processFrame(extractKneeMotionFeatures([]), 550, false)).toBeNull();
    expect(detector.getView(550)).toMatchObject({ state: 'WAIT_RETURN', validNow: false, normalizedLeft: null });
    expect(detector.processFrame(features(0, 0.5), 600, true)).toBeNull();
    expect(detector.getView(600).counts).toEqual({ KNEE_LEFT: 1, KNEE_RIGHT: 0 });
  });

  it('requires BOTH sides strictly inside EXIT for the full dwell, then permits the opposite event', () => {
    const detector = ready(); detector.processFrame(features(-0.4), 0, true);
    detector.processFrame(features(0, KICK_EXIT_DISPLACEMENT), 50, true);
    detector.processFrame(features(0, KICK_EXIT_DISPLACEMENT), 300, true);
    expect(detector.getView(300).state).toBe('WAIT_RETURN');
    detector.processFrame(features(), 350, true);
    detector.processFrame(features(), 350 + RETURN_DWELL_MS - 1, true);
    expect(detector.getView(529).state).toBe('WAIT_RETURN');
    detector.processFrame(features(), 350 + RETURN_DWELL_MS, true);
    expect(detector.getView(530).state).toBe('ARMED');
    expect(detector.processFrame(features(0, 0.4), 550, true)).toMatchObject({ id: 2, direction: 'KNEE_RIGHT' });
  });

  it('resets dwell on missing data and large frame gaps without resetting the event latch', () => {
    const detector = ready(); detector.processFrame(features(-0.4), 0, true);
    detector.processFrame(features(), 50, true);
    detector.processFrame({ ...features(), leftKneeVisibility: 0.1 }, 200, true);
    detector.processFrame(features(), 230, true);
    expect(detector.getView(230).state).toBe('WAIT_RETURN');
    detector.processFrame(features(), 630, true);
    expect(detector.getView(630).state).toBe('WAIT_RETURN');
    detector.processFrame(features(), 810, true);
    expect(detector.getView(810).state).toBe('ARMED');
  });

  it('never triggers on stale pose, missing hips or two unusable knees', () => {
    const detector = ready();
    expect(detector.processFrame(features(-1), 0, false)).toBeNull();
    expect(detector.processFrame({ ...features(-1), leftHipVisibility: 0.69 }, 50, true)).toBeNull();
    expect(detector.processFrame({ ...features(-1, 1), leftKneeVisibility: 0.49, rightKneeVisibility: null }, 100, true)).toBeNull();
    expect(detector.getView(100)).toMatchObject({ state: 'ARMED', validNow: false, currentEvent: 'NONE' });
  });

  it.each(['left', 'right'] as const)('uses an independently visible %s knee while the other is missing', (side) => {
    const detector = ready();
    const values = features(-0.4, 0.4);
    values[side === 'left' ? 'rightKneeVisibility' : 'leftKneeVisibility'] = null;
    expect(detector.processFrame(values, 0, true)?.direction).toBe(side === 'left' ? 'KNEE_LEFT' : 'KNEE_RIGHT');
  });

  it('accepts slow displacement with no velocity gate and expires current-event display', () => {
    const detector = ready();
    for (let index = 0; index <= 28; index++) detector.processFrame(features(index / 100), index * 100, true);
    expect(detector.getView(2800).counts.KNEE_RIGHT).toBe(1);
    for (let time = 2900; time <= 3600; time += 100) detector.processFrame(features(0.3), time, true);
    expect(detector.getView(3600)).toMatchObject({ currentEvent: 'NONE', lastEvent: { id: 1 }, state: 'WAIT_RETURN' });
    expect(detector.getView(4000)).toMatchObject({ validNow: false, normalizedLeft: null, normalizedLeftVelocity: null });
  });

  it('computes body-normalized relative velocity and excludes a previously invisible knee', () => {
    const detector = new KneeKickDetector(); detector.setBaseline({ ...baseline, bodyScale: 0.5 });
    detector.processFrame({ ...features(), leftKneeVisibility: 0.1 }, 0, true);
    detector.processFrame({ ...features(0.1), hipCenterX: 0.52, leftKneeX: 0.62, rightKneeX: 0.52 }, 100, true);
    expect(detector.getView(100).normalizedLeftVelocity).toBeNull();
    expect(detector.getView(100).normalizedRightVelocity).toBeCloseTo(0);
    detector.processFrame({ ...features(0.2), hipCenterX: 0.54, leftKneeX: 0.74, rightKneeX: 0.54 }, 200, true);
    expect(detector.getView(200).normalizedLeftVelocity).toBeCloseTo(2);
  });

  it('ignores duplicate/backward frames and resets counts, baseline, velocity and pending state', () => {
    const detector = ready(); detector.processFrame(features(-0.4), 100, true);
    expect(detector.processFrame(features(0.4), 100, true)).toBeNull();
    expect(detector.processFrame(features(0.4), 50, true)).toBeNull();
    detector.reset();
    expect(detector.getView(200)).toMatchObject({ state: 'NOT_READY', lastEvent: null, counts: { KNEE_LEFT: 0, KNEE_RIGHT: 0 }, normalizedLeftVelocity: null });
  });
});
