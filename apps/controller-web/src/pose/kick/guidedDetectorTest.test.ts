// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DETECTOR_TEST_SEQUENCE, GuidedDetectorTest } from './guidedDetectorTest';

describe('guided detector measurement', () => {
  it('requires readiness and runs all nine exact stages for 22 seconds without restarting on duplicate start', () => {
    const test = new GuidedDetectorTest();
    expect(test.start(0, false)).toBe(false); expect(test.start(100, true)).toBe(true);
    expect(test.start(1000, true)).toBe(false);
    let time = 100;
    expect(DETECTOR_TEST_SEQUENCE.map((stage) => stage.expected)).toEqual(['NEUTRAL', 'TWIST_LEFT', 'NEUTRAL', 'TWIST_RIGHT', 'NEUTRAL', 'KNEE_LEFT', 'NEUTRAL', 'KNEE_RIGHT', 'NEUTRAL']);
    for (const stage of DETECTOR_TEST_SEQUENCE) {
      expect(test.getView(time)).toMatchObject({ status: 'ACTIVE', expected: stage.expected, remainingMs: stage.durationMs });
      expect(test.getView(time + stage.durationMs - 1).remainingMs).toBe(1);
      time += stage.durationMs;
    }
    expect(time).toBe(22100);
    expect(test.getView(time)).toMatchObject({ status: 'COMPLETED', remainingMs: 0 });
  });

  it('summarizes false kicks, wrong direction, duplicates and misses without pass/fail', () => {
    const test = new GuidedDetectorTest(); test.start(0, true);
    const events = [
      { id: 1, direction: 'KNEE_LEFT' as const, timestamp: 1999 },
      { id: 2, direction: 'KNEE_RIGHT' as const, timestamp: 2000 },
      { id: 3, direction: 'KNEE_LEFT' as const, timestamp: 7000 },
      { id: 4, direction: 'KNEE_LEFT' as const, timestamp: 12000 },
      { id: 5, direction: 'KNEE_RIGHT' as const, timestamp: 13000 },
    ];
    for (const event of events) { test.record(event); test.record(event); }
    const view = test.getView(22000);
    expect(view.eventCount).toBe(5);
    expect(view.summary).toEqual({
      NEUTRAL: { falseKickCount: 1 }, TWIST_LEFT: { falseKickCount: 1 }, TWIST_RIGHT: { falseKickCount: 1 },
      KNEE_LEFT: { detected: true, directionCorrect: false, wrongEventCount: 1, duplicateCount: 1 },
      KNEE_RIGHT: { detected: false, directionCorrect: null, wrongEventCount: 0, duplicateCount: 0 },
    });
    events[0].timestamp = 999;
    expect(test.getStages()[0].events[0].timestamp).toBe(1999);
    test.record({ id: 6, direction: 'KNEE_RIGHT', timestamp: 22000 });
    expect(test.getView(23000).eventCount).toBe(5);
    test.reset(); expect(test.getStages()).toEqual([]);
    expect(test.getView(23000)).toMatchObject({ status: 'IDLE', eventCount: 0, summary: null });
  });

  it('records correct knee detections separately from false-positive-free Twist observations', () => {
    const test = new GuidedDetectorTest(); test.start(0, true);
    test.record({ id: 1, direction: 'KNEE_LEFT', timestamp: 13000 });
    test.record({ id: 2, direction: 'KNEE_RIGHT', timestamp: 18000 });
    expect(test.getView(22000).summary).toMatchObject({ KNEE_LEFT: { detected: true, directionCorrect: true, duplicateCount: 0 }, KNEE_RIGHT: { detected: true, directionCorrect: true, duplicateCount: 0 }, TWIST_LEFT: { falseKickCount: 0 } });
  });
});
