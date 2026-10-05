import { describe, expect, it } from 'vitest';
import { MultiSignalShadow, MULTI_DEFAULT, multiConfigs, multiConfigId, type MultiConfig } from './multiSignalShadow';
import type { MultiFrame } from './multiSignalFeatures';
const config = (changes: Partial<MultiConfig> = {}): MultiConfig => ({ ...MULTI_DEFAULT, strategy: 'Y_OR_FLEXION', ...changes });
function frame(timestamp: number, left: Partial<MultiFrame['LEFT']> = {}, right: Partial<MultiFrame['RIGHT']> = {}): MultiFrame {
  return { timestamp, LEFT: { Y: 0, X: 0, FLEXION: 0, ...left }, RIGHT: { Y: 0, X: 0, FLEXION: 0, ...right } };
}
function run(frames: MultiFrame[], changes: Partial<MultiConfig> = {}) {
  const detector = new MultiSignalShadow(config(changes));
  const events = frames.flatMap((f) => { const e = detector.processFrame(f); return e ? [e] : []; });
  return { detector, events };
}
describe('analysis-only multi-signal temporal/return semantics', () => {
  it('keeps exact requested bounded sweep with no automatic best', () => {
    const all = multiConfigs(); expect(all).toHaveLength(491); expect(new Set(all.map(multiConfigId)).size).toBe(491);
    expect(all.filter((c) => c.strategy === 'Y_OR_FLEXION')).toHaveLength(450);
  });
  it.each([
    [{ Y: .6 }, 'Y'], [{ FLEXION: 20 }, 'FLEXION'], [{ Y: .6, FLEXION: 20 }, 'BOTH'],
  ] as const)('uses strong evidence %o once from %s', (values, source) => {
    const { events } = run([frame(0), frame(20, values), frame(80, values), frame(140, values), frame(200, values)]);
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ triggerSource: source, direction: 'KNEE_LEFT', timestamp: 80, crossGap: false });
  });
  it('keeps flexion below threshold unavailable as an event, without absolute overextension evidence', () => {
    expect(run([frame(0), frame(100, { FLEXION: 9.99 }), frame(200, { FLEXION: 9.99 })]).events).toEqual([]);
  });
  it('rejects a 33ms flexion spike for 50ms dwell and accepts 200ms sustained evidence', () => {
    expect(run([frame(0), frame(20, { FLEXION: 20 }), frame(53, { FLEXION: 20 }), frame(60)]).events).toEqual([]);
    const r = run([frame(0), frame(20, { FLEXION: 20 }), frame(220, { FLEXION: 20 })]);
    expect(r.events).toHaveLength(1); expect(r.events[0].confirmationLatencyMs).toBe(200);
  });
  it('does not combine time above threshold on different channels', () => {
    expect(run([frame(0), frame(20, { Y: .6 }), frame(50, { FLEXION: 20 }), frame(80, { Y: .6 }), frame(100)]).events).toEqual([]);
  });
  it('lets Y work when the ankle/flexion is missing', () => {
    const r = run([frame(0, { FLEXION: null }), frame(20, { Y: .6, FLEXION: null }), frame(80, { Y: .6, FLEXION: null })]);
    expect(r.events[0].triggerSource).toBe('Y'); expect(r.detector.getView().sides.LEFT.FLEXION.tracking).toBe('LOST');
  });
  it('allows a Y event while a reacquired bent ankle remains FLEX_REACQUIRED_NOT_READY', () => {
    const r = run([frame(0), frame(20, { FLEXION: null }), frame(60, { FLEXION: 20 }),
      frame(80, { Y: .6, FLEXION: 20 }), frame(140, { Y: .6, FLEXION: 20 })]);
    expect(r.events[0].triggerSource).toBe('Y');
    expect(r.detector.getView().sides.LEFT.FLEXION.tracking).toBe('FLEX_REACQUIRED_NOT_READY');
  });
  it('blocks a bent ankle reacquisition until observed flexion clear without gating Y', () => {
    const d = new MultiSignalShadow(config()); d.processFrame(frame(0)); d.processFrame(frame(20, { FLEXION: null }));
    d.processFrame(frame(60, { FLEXION: 20 })); expect(d.getView().sides.LEFT).toMatchObject({ FLEXION: { tracking: 'FLEX_REACQUIRED_NOT_READY' }, Y: { tracking: 'READY' } });
    expect(d.processFrame(frame(120, { FLEXION: 20 }))).toBeNull();
    d.processFrame(frame(200)); d.processFrame(frame(300)); expect(d.getView().sides.LEFT.FLEXION.tracking).toBe('READY');
    d.processFrame(frame(320, { FLEXION: 20 })); expect(d.processFrame(frame(380, { FLEXION: 20 }))?.triggerSource).toBe('FLEXION');
    expect(d.getEpisodes().find((e) => e.channel === 'FLEXION')).toMatchObject({ durationMs: 40, gated: true, readyAt: 300 });
  });
  it.each(['TRIGGER_CHANNEL_CLEAR', 'ALL_AVAILABLE_CHANNELS_CLEAR'] as const)('prevents bent-knee duplicates while Y is clear: %s', (returnPolicy) => {
    const d = new MultiSignalShadow(config({ returnPolicy })); const events = [];
    for (let t = 0; t <= 1000; t += 20) { const e = d.processFrame(frame(t, { FLEXION: t ? 20 : 0 })); if (e) events.push(e); }
    expect(events).toHaveLength(1); expect(d.getView().state).toBe('WAIT_RETURN');
    d.processFrame(frame(1020)); d.processFrame(frame(1120)); expect(d.getView().state).toBe('ARMED');
  });
  it('compares return policies: a Y trigger can clear while non-trigger flexion remains bent', () => {
    const sequence = [frame(0), frame(20, { Y: .6, FLEXION: 8 }), frame(80, { Y: .6, FLEXION: 8 }), frame(100, { FLEXION: 8 }), frame(200, { FLEXION: 8 })];
    expect(run(sequence).detector.getView().state).toBe('ARMED');
    expect(run(sequence, { returnPolicy: 'ALL_AVAILABLE_CHANNELS_CLEAR' }).detector.getView().state).toBe('WAIT_RETURN');
  });
  it('requires both trigger channels clear for BOTH; missing trigger does not become zero', () => {
    const r = run([frame(0), frame(20, { Y: .6, FLEXION: 20 }), frame(80, { Y: .6, FLEXION: 20 }), frame(100, { FLEXION: null }), frame(220, { FLEXION: null })]);
    expect(r.events[0].triggerSource).toBe('BOTH'); expect(r.detector.getView().state).toBe('WAIT_RETURN');
  });
  it('ALL_AVAILABLE skips missing flexion on return, but reacquisition high stays gated', () => {
    const r = run([frame(0), frame(20, { FLEXION: 20 }), frame(80, { FLEXION: 20 }), frame(100, { FLEXION: null }), frame(220, { FLEXION: null }),
      frame(240, { FLEXION: 20 }), frame(300, { FLEXION: 20 })], { returnPolicy: 'ALL_AVAILABLE_CHANNELS_CLEAR' });
    expect(r.events).toHaveLength(1); expect(r.detector.getView().sides.LEFT.FLEXION.tracking).toBe('FLEX_REACQUIRED_NOT_READY');
  });
  it('keeps Y clear dwell at 100ms even when flexion clear dwell is 180ms', () => {
    const r = run([frame(0), frame(20, { Y: .6, FLEXION: 20 }), frame(80, { Y: .6, FLEXION: 20 }), frame(100), frame(200)], { flexClearDwellMs: 180 });
    expect(r.detector.getView().state).toBe('WAIT_RETURN'); r.detector.processFrame(frame(280)); expect(r.detector.getView().state).toBe('ARMED');
  });
  it.each(['Y', 'FLEXION'] as const)('resets %s on missing and >=400ms gaps; never confirms across a loss', (channel) => {
    const high = { [channel]: channel === 'Y' ? .6 : 20 };
    for (const sequence of [[frame(0), frame(20, high), frame(40, { [channel]: null }), frame(80, high), frame(150, high)],
      [frame(0), frame(20, high), frame(420, high), frame(500, high)]]) expect(run(sequence).events).toEqual([]);
  });
  it('uses limb identity and normalized simultaneous evidence, no arbitrary LEFT tie-break', () => {
    const r = run([frame(0), frame(20, { Y: .8 }, { FLEXION: 20 }), frame(80, { Y: .8 }, { FLEXION: 20 })]);
    expect(r.events).toEqual([]); expect(r.detector.getView().state).toBe('WAIT_CLEAR');
    r.detector.processFrame(frame(100)); r.detector.processFrame(frame(200)); expect(r.detector.getView().state).toBe('ARMED');
    expect(run([frame(0), frame(20, {}, { FLEXION: 20 }), frame(80, {}, { FLEXION: 20 })]).events[0].direction).toBe('KNEE_RIGHT');
  });
  it('records X controls explicitly and never substitutes legacy X events', () => {
    const r = run([frame(0), frame(20, { X: .6, Y: .6 }), frame(80, { X: .6, Y: .6 })], { strategy: 'Y_OR_X_CONTROL' });
    expect(r.events).toHaveLength(1); expect(r.events[0].triggerSource).toBe('Y_X_BOTH');
  });
  it('resets the X-only control run on missing X and a >=400ms gap', () => {
    for (const middle of [frame(40, { X: null }), frame(420, { X: .6 })]) {
      const r = run([frame(0), frame(20, { X: .6 }), middle, frame(middle.timestamp + 10, { X: .6 })], { strategy: 'X_ONLY_CONTROL' });
      expect(r.events).toEqual([]);
    }
  });
  it('uses first observed dwell rather than waiting for a later stronger opposite side', () => {
    const r = run([frame(0), frame(20, { FLEXION: 12 }), frame(60, { FLEXION: 12 }, { Y: 2 }), frame(80, { FLEXION: 12 }, { Y: 2 }), frame(140, { FLEXION: 12 }, { Y: 2 })]);
    expect(r.events).toHaveLength(1); expect(r.events[0]).toMatchObject({ side: 'LEFT', triggerSource: 'FLEXION', timestamp: 80 });
  });
  it('is deterministic and ignores retrograde/duplicate timestamps', () => {
    const sequence = [frame(0), frame(20, { FLEXION: 20 }), frame(80, { FLEXION: 20 }), frame(100), frame(200)];
    expect(run(sequence).events).toEqual(run(sequence).events);
    const d = run(sequence).detector, before = d.getView(); d.processFrame(frame(200)); d.processFrame(frame(100)); expect(d.getView()).toEqual(before);
  });
});
