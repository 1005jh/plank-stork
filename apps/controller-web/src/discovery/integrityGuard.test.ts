import { describe, expect, it } from 'vitest';
import { IntegrityShadow, integrityConfigs, integrityConfigId, FIXED_FLEXION_CONFIG, type IntegrityConfig } from './integrityGuard';
import { integrityGeometry, type IntegrityFrame, type IntegrityMeasurement } from './integrityFeatures';
import { GuidedDetectorTest } from '../pose/kick/guidedDetectorTest';
const velocity: IntegrityConfig = { guardType: 'Y_VELOCITY', velocity: 10, minRatio: null };
const collapse: IntegrityConfig = { guardType: 'SEGMENT_COLLAPSE', velocity: null, minRatio: .3 };
function measure(changes: Partial<IntegrityMeasurement> = {}): IntegrityMeasurement {
  return { ...integrityGeometry([], [], 'LEFT'), deltaDyNorm: 0, deltaDyNormVelocity: 0, kneeRelativeX: 0, kneeRelativeY: .3,
    kneeRelativeXNorm: 0, kneeRelativeYNorm: 1, kneeCenterRelative2DVelocity: 0, hipKneeRatio: 1, kneeAnkleRatio: 1,
    kneeAngleVelocity: 0, trackingState: 'READY', candidateRunMs: 0, ...changes };
}
function frame(timestamp: number, left: Partial<IntegrityMeasurement> = {}, right: Partial<IntegrityMeasurement> = {}, flexion = 0): IntegrityFrame {
  const l = measure(left), r = measure(right);
  return { timestamp, stageIndex: 0, calibrationOnly: false, ankleVisible: { LEFT: true, RIGHT: true },
    LEFT: { Y: l.deltaDyNorm === null ? null : Math.abs(l.deltaDyNorm), X: 0, FLEXION: flexion },
    RIGHT: { Y: r.deltaDyNorm === null ? null : Math.abs(r.deltaDyNorm), X: 0, FLEXION: 0 }, measurements: { LEFT: l, RIGHT: r } };
}
const high = { deltaDyNorm: .8, deltaDyNormVelocity: 0 };
describe('analysis-only soft tracking loss', () => {
  it('uses a bounded 36-guard grid plus NONE with one fixed flexion config', () => {
    const configs = integrityConfigs(); expect(configs).toHaveLength(37); expect(new Set(configs.map(integrityConfigId)).size).toBe(37);
    expect(FIXED_FLEXION_CONFIG).toMatchObject({ flexEnter: 15, flexDwellMs: 67, flexClear: 5, flexClearDwellMs: 150 });
  });
  it('accepts Y rising normally over 100ms and a true kick below the veto', () => {
    const d = new IntegrityShadow(velocity);
    d.processFrame(frame(0)); d.processFrame(frame(50, { deltaDyNorm: .2, deltaDyNormVelocity: 4 }));
    d.processFrame(frame(100, { deltaDyNorm: .5, deltaDyNormVelocity: 6 }));
    expect(d.processFrame(frame(150, { deltaDyNorm: .6, deltaDyNormVelocity: 2 }))?.direction).toBe('KNEE_LEFT');
    expect(d.getSoftEpisodes()).toEqual([]);
  });
  it('treats a huge one-frame jump as soft loss, discards entry, and never emits from a held high Y', () => {
    const d = new IntegrityShadow(velocity); d.processFrame(frame(0));
    expect(d.processFrame(frame(20, { ...high, deltaDyNormVelocity: -40 }))).toBeNull();
    for (let t = 40; t <= 1000; t += 20) expect(d.processFrame(frame(t, high))).toBeNull();
    expect(d.getSoftView().LEFT.state).toBe('SUSPECT_NOT_READY'); expect(d.getSoftEpisodes()).toHaveLength(1);
    expect(d.getSoftEpisodes()[0]).toMatchObject({ entryPrevented: true, candidateCancelled: true, readyAt: null });
    expect(d.getView().sides.LEFT.Y.runAt).toBeNull();
  });
  it('needs exactly 100ms observed Y clear to recover and then starts a fresh run', () => {
    const d = new IntegrityShadow(velocity); d.processFrame(frame(0)); d.processFrame(frame(20, { ...high, deltaDyNormVelocity: 40 }));
    d.processFrame(frame(40)); d.processFrame(frame(139)); expect(d.getSoftView().LEFT.state).toBe('SUSPECT_NOT_READY');
    d.processFrame(frame(140)); expect(d.getSoftView().LEFT.state).toBe('READY');
    expect(d.getSoftEpisodes()[0]).toMatchObject({ readyAt: 140, timeToReadyMs: 120 });
    d.processFrame(frame(160, high)); expect(d.processFrame(frame(210, high))).toMatchObject({ softEpoch: 1, softGapCrossConfirmation: false });
  });
  it('uses the immediately preceding entry frame velocity, not a retained pre-loss maximum', () => {
    const d = new IntegrityShadow(velocity); d.processFrame(frame(0)); d.processFrame(frame(20, { deltaDyNorm: .39, deltaDyNormVelocity: 19.5 }));
    d.processFrame(frame(40, { deltaDyNorm: .41, deltaDyNormVelocity: 1 }));
    expect(d.getSoftEpisodes()[0].reasons).toEqual([{ feature: 'Y_VELOCITY', observedAt: 20, value: 19.5, threshold: 10 }]);
    const missing = new IntegrityShadow(velocity); missing.processFrame(frame(0)); missing.processFrame(frame(20, { deltaDyNormVelocity: 20 }));
    missing.processFrame(frame(40, { deltaDyNorm: null, deltaDyNormVelocity: null }));
    missing.processFrame(frame(50, { ...high, deltaDyNormVelocity: null }));
    expect(missing.getSoftEpisodes()).toEqual([]);
  });
  it('checks velocity at candidate entry, not as positive confirmation or an every-frame speed cap', () => {
    const d = new IntegrityShadow(velocity); d.processFrame(frame(0)); d.processFrame(frame(20, { deltaDyNorm: .5, deltaDyNormVelocity: 5 }));
    expect(d.processFrame(frame(80, { deltaDyNorm: 1.5, deltaDyNormVelocity: 20 }))?.direction).toBe('KNEE_LEFT');
    expect(d.getSoftEpisodes()).toEqual([]);
  });
  it('keeps Y eligible when an ankle / segment baseline is unavailable', () => {
    const d = new IntegrityShadow(collapse); d.processFrame(frame(0, { kneeAnkleRatio: null }));
    d.processFrame(frame(20, { ...high, kneeAnkleRatio: null }));
    expect(d.processFrame(frame(80, { ...high, kneeAnkleRatio: null }))?.direction).toBe('KNEE_LEFT');
    expect(d.getSoftEpisodes()).toEqual([]);
  });
  it('vetoes visible segment collapse and cannot sum 30ms before soft loss with 30ms after recovery', () => {
    const d = new IntegrityShadow(collapse); d.processFrame(frame(0)); d.processFrame(frame(20, high)); d.processFrame(frame(50, high));
    d.processFrame(frame(60, { ...high, kneeAnkleRatio: .1 }));
    expect(d.getSoftEpisodes()[0]).toMatchObject({ existingRunCancelled: true, entryPrevented: false });
    d.processFrame(frame(80)); d.processFrame(frame(180));
    d.processFrame(frame(200, high)); expect(d.processFrame(frame(230, high))).toBeNull();
    expect(d.processFrame(frame(260, high))).toMatchObject({ candidateStartedAt: 200, softGapCrossConfirmation: false });
  });
  it.each(['missing', 'gap'] as const)('resets soft recovery continuity on %s', (kind) => {
    const d = new IntegrityShadow(velocity); d.processFrame(frame(0)); d.processFrame(frame(20, { ...high, deltaDyNormVelocity: 40 })); d.processFrame(frame(40));
    if (kind === 'missing') { d.processFrame(frame(80, { deltaDyNorm: null })); d.processFrame(frame(120)); d.processFrame(frame(180)); }
    else { d.processFrame(frame(440)); d.processFrame(frame(500)); }
    expect(d.getSoftView().LEFT.state).toBe('SUSPECT_NOT_READY');
  });
  it('does not gate the other side or advance/pause the Guided clock based on soft loss', () => {
    const d = new IntegrityShadow(velocity), guided = new GuidedDetectorTest(); guided.start(0, true);
    d.processFrame(frame(0)); d.processFrame(frame(20, { ...high, deltaDyNormVelocity: 40 }));
    d.processFrame(frame(40, high, high)); expect(d.processFrame(frame(100, high, high))?.direction).toBe('KNEE_RIGHT');
    for (let t = 200; t <= 22000; t += 100) { guided.advance(t, d.getView().state); d.processFrame(frame(t, high)); }
    expect(guided.getReplaySnapshot()).toMatchObject({ status: 'COMPLETED' });
    expect(guided.getReplaySnapshot().timings.every((t) => t.armedWaitMs === 0)).toBe(true);
    expect(d.getSoftView().LEFT.state).toBe('SUSPECT_NOT_READY');
  });
  it('2D veto observes normalized vector magnitude and combined guard accepts either corruption reason', () => {
    const vector = new IntegrityShadow({ guardType: 'KNEE_2D_VELOCITY', velocity: 15, minRatio: null });
    vector.processFrame(frame(0)); vector.processFrame(frame(20, { ...high, deltaDyNormVelocity: 2, kneeCenterRelative2DVelocity: 16 }));
    expect(vector.getSoftEpisodes()[0].reasons[0].feature).toBe('KNEE_2D_VELOCITY');
    for (const sample of [{ ...high, deltaDyNormVelocity: 20 }, { ...high, kneeAnkleRatio: .1 }]) {
      const d = new IntegrityShadow({ guardType: 'Y_VELOCITY_OR_COLLAPSE', velocity: 15, minRatio: .3 }); d.processFrame(frame(0)); d.processFrame(frame(20, sample));
      expect(d.getSoftEpisodes()).toHaveLength(1);
    }
  });
  it('blocks fixed flexion evidence on the same corrupted side too, with deterministic replay', () => {
    const run = () => {
      const d = new IntegrityShadow(velocity, FIXED_FLEXION_CONFIG), events = [];
      d.processFrame(frame(0));
      for (const t of [20, 100, 200]) { const event = d.processFrame(frame(t, { ...high, deltaDyNormVelocity: t === 20 ? 40 : 0 }, {}, 50)); if (event) events.push(event); }
      return { events, episodes: d.getSoftEpisodes() };
    };
    expect(run().events).toEqual([]); expect(run()).toEqual(run());
  });
  it('observes original return clear during recovery without adding a second 100ms hold', () => {
    const d = new IntegrityShadow(collapse); d.processFrame(frame(0)); d.processFrame(frame(20, high)); d.processFrame(frame(80, high));
    d.processFrame(frame(100, { kneeAnkleRatio: .1 })); d.processFrame(frame(120)); d.processFrame(frame(220)); d.processFrame(frame(240));
    expect(d.getSoftView().LEFT.state).toBe('READY'); expect(d.getView().state).toBe('ARMED');
  });
  it('ignores duplicate/retrograde timestamps and starts each config in an isolated state', () => {
    const d = new IntegrityShadow(velocity); d.processFrame(frame(100)); d.processFrame(frame(120, { ...high, deltaDyNormVelocity: 40 }));
    const before = d.getSoftView(); d.processFrame(frame(120)); d.processFrame(frame(0)); expect(d.getSoftView()).toEqual(before);
    expect(new IntegrityShadow(velocity).getSoftView().LEFT).toMatchObject({ state: 'READY', epoch: 0 });
  });
});
