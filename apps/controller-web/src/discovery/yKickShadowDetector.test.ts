import { describe, expect, it } from 'vitest';
import { DEFAULT_SHADOW_CONFIG, YKickShadowDetector, type DirectionStrategy } from './yKickShadowDetector';

function engine(directionStrategy: DirectionStrategy = 'FIRST_DWELL') {
  const detector = new YKickShadowDetector({ ...DEFAULT_SHADOW_CONFIG, directionStrategy });
  const send = (timestamp: number, LEFT: number | null = 0, RIGHT: number | null = 0) => detector.processFrame({ timestamp, LEFT, RIGHT });
  return { detector, send };
}
describe('Y shadow entry and direction (independent core)', () => {
  it('33ms above enter cannot satisfy 50ms dwell', () => {
    const { detector, send } = engine(); send(0, 0.4); send(33, 0.45); send(67, 0);
    expect(detector.result().events).toEqual([]); expect(detector.getState()).toBe('ARMED');
  });
  it.each(['LEFT', 'RIGHT'] as const)('67ms sustained %s triggers exactly once', (side) => {
    const { detector, send } = engine();
    for (const t of [0, 33, 67, 100, 200, 300]) send(t, side === 'LEFT' ? 0.5 : 0, side === 'RIGHT' ? 0.5 : 0);
    expect(detector.result().events).toHaveLength(1);
    expect(detector.result().events[0]).toMatchObject({ side, timestamp: 67, crossGapConfirmation: false });
    expect(detector.getState()).toBe('WAIT_RETURN');
  });
  it.each(['FIRST_DWELL', 'INTEGRATED_WINDOW'] as const)('%s allows RIGHT with LEFT entirely missing', (strategy) => {
    const { detector, send } = engine(strategy);
    for (const t of [0, 33, 67, 100, 133, 167]) send(t, null, t <= 67 ? 0.46 : 0.1);
    expect(detector.result().events.map((e) => e.side)).toEqual(['RIGHT']);
    expect(detector.result().events[0].leftIntegratedEvidence).toBe(0);
  });
  it('compares first observed dwell with stronger integrated eligible limb', () => {
    const first = engine(), integrated = engine('INTEGRATED_WINDOW');
    for (const instance of [first, integrated]) for (const t of [0, 33, 67, 100, 133, 167]) instance.send(t, 0.5, t < 33 ? 0 : 0.8);
    expect(first.detector.result().events[0]).toMatchObject({ side: 'LEFT', timestamp: 67 });
    const event = integrated.detector.result().events[0];
    expect(event).toMatchObject({ side: 'RIGHT', timestamp: 167, decisionStartedAt: 67, decisionEndsAt: 167 });
    expect(event.leftIntegratedEvidence).toBeCloseTo(0.01); expect(event.rightIntegratedEvidence).toBeCloseTo(0.04);
    expect(event.absoluteMargin).toBeCloseTo(0.03); expect(event.ratio).toBeCloseTo(0.8);
  });
  it('cannot promote a large opponent spike that never met dwell', () => {
    const { detector, send } = engine('INTEGRATED_WINDOW');
    for (const t of [0, 33, 67, 100, 133, 167]) send(t, 0.5, t === 100 ? 5 : 0);
    expect(detector.result().events[0].side).toBe('LEFT');
  });
  it.each(['FIRST_DWELL', 'INTEGRATED_WINDOW'] as const)('%s reports equal evidence as ambiguous instead of choosing LEFT', (strategy) => {
    const { detector, send } = engine(strategy);
    for (const t of [0, 33, 67, 100, 133, 167]) send(t, 0.5, 0.5);
    expect(detector.result().events).toHaveLength(0); expect(detector.getState()).toBe('WAIT_CLEAR');
    expect(detector.result().cancelledCandidates[0].reason).toBe('AMBIGUOUS');
  });
});

describe('side-owned return and loss quarantine', () => {
  it('absorbs 700ms post-kick return tail without another event', () => {
    const { detector, send } = engine(); send(0, 0.5); send(67, 0.5);
    for (let t = 100; t <= 800; t += 50) send(t, 0.55);
    expect(detector.result().events).toHaveLength(1); expect(detector.getState()).toBe('WAIT_RETURN');
    send(850, 0.1); send(950, 0.1); send(1030, 0.1);
    expect(detector.getState()).toBe('ARMED'); expect(detector.result().events).toHaveLength(1);
    expect(detector.result().rearmTimes[0]).toMatchObject({ timestamp: 1030, returnLatencyMs: 963, side: 'LEFT' });
  });
  it('rearams using only the triggered side while opponent is missing or still high', () => {
    const { detector, send } = engine(); send(0, 0.5); send(67, 0.5);
    send(100, 0.1, null); send(200, 0.1, 0.9); send(280, 0.1, null);
    expect(detector.getState()).toBe('ARMED'); expect(detector.result().rearmTimes).toHaveLength(1);
  });
  it('cancels candidate immediately on owner loss and discards all active evidence', () => {
    const { detector, send } = engine(); send(0, 0.5); send(33, 0.6); send(50, null, 0.9);
    expect(detector.getSnapshot()).toMatchObject({ state: 'WAIT_CLEAR', candidate: null, waitingSide: 'LEFT' });
    expect(detector.result().cancelledCandidates[0]).toMatchObject({ reason: 'POSE_LOSS', candidateStartedAt: 0, timestamp: 50, leftRunStartedAt: 0 });
    for (const t of [67, 100, 133, 200]) send(t, 0.6, 0.9);
    expect(detector.result().events).toEqual([]); expect(detector.getState()).toBe('WAIT_CLEAR');
  });
  it('requires observed clear then entirely fresh dwell after reacquisition', () => {
    const { detector, send } = engine(); send(0, 0.5); send(33, 0.6); send(50, null, null);
    send(100, 0.1); send(200, 0.1); send(280, 0.1);
    expect(detector.getState()).toBe('ARMED');
    send(300, 0, 0.5); send(333, 0, 0.5); expect(detector.result().events).toHaveLength(0);
    send(367, 0, 0.5);
    expect(detector.result().events[0]).toMatchObject({ side: 'RIGHT', candidateStartedAt: 300, timestamp: 367,
      crossGapConfirmation: false, recovery: { cancelledAt: 50, clearedAt: 280, reason: 'POSE_LOSS' } });
  });
  it('loss in WAIT_RETURN never automatically unlocks and breaks an earlier return run', () => {
    const { detector, send } = engine(); send(0, 0.5); send(67, 0.5); send(100, 0.1); send(200, null);
    send(1000, null); expect(detector.getState()).toBe('WAIT_RETURN');
    send(1033, 0.1); send(1166, 0.1); expect(detector.getState()).toBe('WAIT_RETURN');
    send(1233, 0.1); expect(detector.getState()).toBe('ARMED');
  });
  it('EXIT equality does not clear and a 400ms return gap starts dwell again', () => {
    const { detector, send } = engine(); send(0, 0.5); send(67, 0.5);
    send(100, 0.2); send(300, 0.2); expect(detector.getState()).toBe('WAIT_RETURN');
    send(333, 0.1); send(733, 0.1); expect(detector.getState()).toBe('WAIT_RETURN');
    send(913, 0.1); expect(detector.getState()).toBe('ARMED');
  });
  it('400ms candidate gap quarantines instead of combining pre/post gap evidence', () => {
    const { detector, send } = engine(); send(0, 0.5); send(400, 0.8);
    expect(detector.getState()).toBe('WAIT_CLEAR'); expect(detector.result().events).toEqual([]);
    expect(detector.result().cancelledCandidates[0].reason).toBe('TIMESTAMP_GAP');
  });
  it('INTEGRATED_WINDOW loses its whole decision on owner pose loss', () => {
    const { detector, send } = engine('INTEGRATED_WINDOW'); send(0, 0.5); send(67, 0.5); send(100, null, 0.7); send(167, 0.8, 0.8);
    expect(detector.result().events).toEqual([]); expect(detector.getState()).toBe('WAIT_CLEAR');
    expect(detector.result().cancelledCandidates[0]).toMatchObject({ reason: 'POSE_LOSS', decisionStartedAt: 67 });
  });
  it('opponent loss resets its own integrated evidence without vetoing the owner', () => {
    const { detector, send } = engine('INTEGRATED_WINDOW'); send(0, 0.5); send(33, 0.5, 0.8); send(67, 0.5, 0.8); send(100, 0.5, null); send(167, 0.5, null);
    expect(detector.result().events[0]).toMatchObject({ side: 'LEFT', rightIntegratedEvidence: 0, rightEligibleAt: null });
  });
  it('ignores duplicate/reversed timestamps and produces deterministic snapshots', () => {
    const run = () => {
      const { detector, send } = engine(); send(0, 0.5); send(0, 0.9); send(-1, 0.9); send(33, 0.5); send(67, 0.5);
      return detector.result();
    };
    expect(run()).toEqual(run()); expect(run().events).toHaveLength(1);
  });
  it('diagnoses a fresh ARMED reacquisition candidate separately from cross-gap evidence reuse', () => {
    const { detector, send } = engine(); send(0); send(33, null, null); send(67, null, 1.1); send(100, null, 1.2); send(134, null, 1.2);
    const event = detector.result().events[0];
    expect(event).toMatchObject({ side: 'RIGHT', candidateStartedAt: 67, crossGapConfirmation: false, recovery: null,
      entryReacquisition: { timestamp: 67, lossAt: 33, reason: 'POSE_LOSS' } });
  });
});
