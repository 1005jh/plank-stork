import { describe, expect, it } from 'vitest';
import { ReacquisitionGate, type GateFrame, type ReacquisitionConfig } from './reacquisitionGate';
import { DEFAULT_SHADOW_CONFIG, YKickShadowDetector } from './yKickShadowDetector';

const fixed: ReacquisitionConfig = { lossMinMs: 0, strategy: 'FIXED_SETTLE', settleMs: 100, clearThreshold: null, clearDwellMs: 0 };
const clear: ReacquisitionConfig = { lossMinMs: 0, strategy: 'CLEAR_ONLY', settleMs: 0, clearThreshold: 0.25, clearDwellMs: 100 };
const frame = (timestamp: number, LEFT: number | null = 0, RIGHT: number | null = 0, hipUsable = true): GateFrame => ({ timestamp, LEFT, RIGHT, hipUsable });
function harness(config: ReacquisitionConfig) {
  const gate = new ReacquisitionGate(config), shadow = new YKickShadowDetector();
  const push = (f: GateFrame) => { const entryEligible = gate.processFrame(f); shadow.processFrame({ ...f, entryEligible }); return entryEligible; };
  return { gate, shadow, push };
}
describe('analysis-only side reacquisition gates', () => {
  it('A: one missing frame qualifies at lossMin=0; diagnostics retain both gap definitions', () => {
    const { gate, push, shadow } = harness(fixed);
    push(frame(0)); push(frame(33, 0, null));
    expect(push(frame(66, 0, 1))).toEqual({ LEFT: true, RIGHT: false });
    expect(shadow.getState()).toBe('ARMED');
    expect(gate.result().sides.RIGHT).toMatchObject({ tracking: 'USABLE', state: 'REACQUIRED_NOT_READY' });
    expect(gate.result().episodes[0]).toMatchObject({ side: 'RIGHT', qualifies: true, gapDurationMs: 33, usableToUsableGapMs: 66, lastUsableBeforeGapMs: 0 });
  });
  it('B: a sub-minimum dropout does not gate; the minimum is inclusive', () => {
    for (const [lossMinMs, allowed] of [[34, true], [33, false]] as const) {
      const { push } = harness({ ...fixed, lossMinMs }); push(frame(0)); push(frame(33, null));
      expect(push(frame(66, 1)).LEFT).toBe(allowed);
    }
  });
  it('C: a 60ms spike after reacquisition cannot start a candidate during settle100', () => {
    const { push, shadow } = harness(fixed); push(frame(0)); push(frame(20, null));
    for (let t = 40; t <= 200; t += 20) push(frame(t, t < 100 ? 0.8 : 0));
    expect(shadow.result().events).toEqual([]); expect(shadow.result().cancelledCandidates).toEqual([]);
    expect(shadow.getState()).toBe('ARMED');
  });
  it('D/F: persistent/mid-kick >ENTER can trigger after fixed settle, while clear stays disarmed', () => {
    const a = harness(fixed), b = harness(clear);
    for (const h of [a, b]) { h.push(frame(0)); h.push(frame(20, null));
      for (let t = 40; t <= 540; t += 20) h.push(frame(t, 0.8)); }
    expect(a.shadow.result().events).toHaveLength(1);
    expect(a.shadow.result().events[0]).toMatchObject({ candidateStartedAt: 140, timestamp: 200 });
    expect(b.shadow.result().events).toEqual([]); expect(b.gate.result().sides.LEFT.state).toBe('REACQUIRED_NOT_READY');
  });
  it('E: continuous neutral clear100 arms, then a genuine new kick emits once', () => {
    const { push, shadow, gate } = harness(clear); push(frame(0)); push(frame(20, null)); push(frame(40, 0.8));
    for (let t = 60; t <= 160; t += 20) push(frame(t));
    expect(gate.result().episodes[0]).toMatchObject({ readyAt: 160, addedEligibilityLatencyMs: 120 });
    push(frame(180, 0.8)); push(frame(205, 0.8)); push(frame(230, 0.8));
    expect(shadow.result().events.map((e) => e.direction)).toEqual(['KNEE_LEFT']);
  });
  it.each(['LEFT', 'RIGHT'] as const)('G/H: %s loss does not block the other knee or its candidate', (lost) => {
    const other = lost === 'LEFT' ? 'RIGHT' : 'LEFT', h = harness(clear); h.push(frame(0));
    for (const timestamp of [20, 50, 75]) h.push({ ...frame(timestamp), [lost]: null, [other]: 0.8 });
    expect(h.shadow.result().events.map((e) => e.side)).toEqual([other]);
    expect(h.gate.result().sides[lost].state).toBe('LOST');
  });
  it('I: hip loss is recorded separately and qualifies both side episodes', () => {
    const { push, gate } = harness(clear); push(frame(0)); push(frame(20, null, null, false));
    expect(push(frame(40, 0.8, 0.8))).toEqual({ LEFT: false, RIGHT: false });
    expect(gate.result().episodes.map((e) => [e.side, e.hipLossObserved])).toEqual([['LEFT', true], ['RIGHT', true]]);
    expect(gate.result().hipLosses).toEqual([{ startedAt: 20, endedAt: 40 }]);
  });
  it.each(['FIRST_DWELL', 'INTEGRATED_WINDOW'] as const)('J/K: no-loss path equals previous %s shadow exactly and is deterministic', (directionStrategy) => {
    const run = (withGate: boolean) => {
      const gate = new ReacquisitionGate(clear), shadow = new YKickShadowDetector({ ...DEFAULT_SHADOW_CONFIG, directionStrategy });
      for (let t = 0; t < 2000; t += 25) {
        const f = frame(t, t >= 200 && t < 600 ? 0.8 : 0, t >= 1000 && t < 1400 ? 0.9 : 0);
        shadow.processFrame({ ...f, entryEligible: withGate ? gate.processFrame(f) : undefined });
      }
      return shadow.result();
    };
    expect(run(true)).toEqual(run(false)); expect(run(true)).toEqual(run(true)); expect(run(true).events).toHaveLength(2);
  });
  it('loss during settle restarts the timer even if the new loss is shorter than lossMin', () => {
    const { push, gate } = harness({ ...fixed, lossMinMs: 50 }); push(frame(0)); push(frame(20, null)); push(frame(80));
    push(frame(130, null)); expect(push(frame(140)).LEFT).toBe(false);
    expect(push(frame(239)).LEFT).toBe(false); expect(push(frame(240)).LEFT).toBe(true);
    expect(gate.result().episodes[1]).toMatchObject({ qualifies: false, continuedGate: true, readyAt: 240 });
    expect(gate.result().episodes[0]).toMatchObject({ interruptedAt: 130, readyAt: null });
  });
  it('clear equality, missing frame and dt >=400ms all break clear continuity', () => {
    const { push } = harness(clear); push(frame(0)); push(frame(20, null)); push(frame(40));
    push(frame(100, 0.25)); expect(push(frame(140)).LEFT).toBe(false);
    push(frame(180, null)); expect(push(frame(220)).LEFT).toBe(false);
    expect(push(frame(620)).LEFT).toBe(false); expect(push(frame(719)).LEFT).toBe(false); expect(push(frame(720)).LEFT).toBe(true);
  });
  it('settle AND current clear dwell overlap but an expired clear run cannot unlock later', () => {
    const { push } = harness({ ...clear, strategy: 'SETTLE_AND_CLEAR', settleMs: 200 });
    push(frame(0)); push(frame(20, null)); push(frame(40)); push(frame(140));
    expect(push(frame(240, 0.8)).LEFT).toBe(false); push(frame(260));
    expect(push(frame(359)).LEFT).toBe(false); expect(push(frame(360)).LEFT).toBe(true);
  });
  it('a disarmed high opponent contributes neither direction evidence nor a fake loss cancellation', () => {
    const { push, shadow } = harness(clear); push(frame(0)); push(frame(20, 0, null));
    push(frame(40, 0.6, 4)); push(frame(65, 0.6, 4)); push(frame(90, 0.6, 4));
    expect(shadow.result().events[0]).toMatchObject({ side: 'LEFT', rightIntegratedEvidence: 0, rightPeak: null });
    expect(shadow.result().cancelledCandidates).toEqual([]);
  });
  it('loss in a candidate still discards physical evidence and waits for clear', () => {
    const { push, shadow } = harness(fixed); push(frame(0)); push(frame(20, 0.8)); push(frame(40, null));
    for (let t = 60; t <= 500; t += 20) push(frame(t, 0.8));
    expect(shadow.result().events).toEqual([]); expect(shadow.getState()).toBe('WAIT_CLEAR');
    expect(shadow.result().cancelledCandidates[0].reason).toBe('POSE_LOSS');
  });
  it('ignores duplicate/retrograde timestamps and rejects invalid configuration', () => {
    const { push, gate } = harness(clear); push(frame(0)); push(frame(20, null)); push(frame(40));
    const before = gate.result(); push(frame(40, null)); push(frame(10, null)); expect(gate.result()).toEqual(before);
    expect(() => new ReacquisitionGate({ ...clear, clearThreshold: null })).toThrow();
    expect(() => new ReacquisitionGate({ ...fixed, settleMs: NaN })).toThrow();
  });
});
