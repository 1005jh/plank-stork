// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GeometryEntryGuard, markerDecision, nullableOr, descriptiveCategories, qualityGateConfigs, reliabilityMarkers } from './geometryReliabilityMarkers';
import type { GeometryFrame } from './geometryReliabilityFeatures';
import { IntegrityShadow, PRE_REGISTERED_INTEGRITY_CONFIG, FIXED_FLEXION_CONFIG } from './integrityGuard';
import { integrityGeometry, type IntegrityFrame, type IntegrityMeasurement } from './integrityFeatures';
function geometry(timestamp: number, image: number | null, world: number | null): GeometryFrame {
  return { timestamp, stageIndex: 0, calibrationOnly: false, values: { 'image.swapAdvantage': image, 'world.swapAdvantage': world }, flags: {} };
}
function measurement(y: number | null, velocity: number): IntegrityMeasurement {
  return { ...integrityGeometry([], [], 'LEFT'), deltaDyNorm: y, deltaDyNormVelocity: velocity, kneeRelativeX: 0, kneeRelativeY: 0,
    kneeRelativeXNorm: 0, kneeRelativeYNorm: y, kneeCenterRelative2DVelocity: 0, hipKneeRatio: 1, kneeAnkleRatio: 1, kneeAngleVelocity: 0, trackingState: 'READY', candidateRunMs: 0 };
}
function frame(timestamp: number, y: number | null, velocity = 0): IntegrityFrame {
  return { timestamp, stageIndex: 0, calibrationOnly: false, ankleVisible: { LEFT: true, RIGHT: true },
    LEFT: { Y: y, X: 0, FLEXION: 0 }, RIGHT: { Y: 0, X: 0, FLEXION: 0 }, measurements: { LEFT: measurement(y, velocity), RIGHT: measurement(0, 0) } };
}
const identity = { family: 'IDENTITY_CONTINUITY' as const, threshold: 0 };
function runner() {
  const observations = new Map<number, GeometryFrame>(), guard = new GeometryEntryGuard(observations, qualityGateConfigs().find((c) => c.id === 'IDENTITY_CONTINUITY/0')!);
  const detector = new IntegrityShadow(PRE_REGISTERED_INTEGRITY_CONFIG, FIXED_FLEXION_CONFIG, guard.evaluate);
  const send = (f: IntegrityFrame, advantage: number | null = -1) => { observations.set(f.timestamp, geometry(f.timestamp, advantage, advantage)); return detector.processFrame(f); };
  return { send, guard, detector };
}
describe('descriptive reliability markers and entry-only thought experiment', () => {
  it('uses strict positive swap advantage at zero, not a zero/no-motion anomaly', () => {
    expect(markerDecision(geometry(0, 0, 0), 'LEFT', identity).decision).toBe(false);
    expect(markerDecision(geometry(0, .001, 0), 'LEFT', identity).decision).toBe(true);
    expect(markerDecision(geometry(0, .1, -.1), 'LEFT', { ...identity, threshold: .1 }).decision).toBe(false);
  });
  it('retains unknown observations instead of inventing anomaly zero', () => {
    expect(nullableOr([false, null])).toBeNull(); expect(nullableOr([true, null])).toBe(true);
    expect(markerDecision(geometry(0, null, null), 'LEFT', identity).decision).toBeNull();
    expect(descriptiveCategories({ ...geometry(0, null, null), values: { 'image.leftHipKneeLength': null, 'world.leftHipKneeLength': null }, flags: { 'image.pelvisNumericDegeneracy': null, 'image.torsoNumericDegeneracy': null } }, 'LEFT', 0).labels).toEqual(['LOW_OBSERVABILITY']);
  });
  it('checks each limb bone separately and keeps a known anomaly with another segment missing', () => {
    const g = geometry(0, 0, 0); g.values['world.leftHipKneeRatioDeviation'] = .5; g.values['world.leftKneeAnkleRatioDeviation'] = null;
    g.values['world.rightHipKneeRatioDeviation'] = 0; g.values['world.rightKneeAnkleRatioDeviation'] = 0;
    const m = { family: 'WORLD_SEGMENT_INSTABILITY' as const, threshold: .35 };
    expect(markerDecision(g, 'LEFT', m).decision).toBe(true); expect(markerDecision(g, 'RIGHT', m).decision).toBe(false);
  });
  it('marks numeric axis degeneracy independently of the angular velocity cut', () => {
    const g = geometry(0, 0, 0); g.flags['image.pelvisNumericDegeneracy'] = true; g.flags['image.torsoNumericDegeneracy'] = false;
    expect(markerDecision(g, 'LEFT', { family: 'AXIS_DEGENERACY', threshold: 720 }).decision).toBe(true);
  });
  it('has 20 declared marker cuts and 24 bounded gate configs without changing production parameters', () => {
    expect(reliabilityMarkers()).toHaveLength(20); expect(qualityGateConfigs()).toHaveLength(24);
    expect(new Set(qualityGateConfigs().map((c) => c.id)).size).toBe(24);
    expect(PRE_REGISTERED_INTEGRITY_CONFIG.velocity).toBe(12); expect(FIXED_FLEXION_CONFIG).toMatchObject({ flexEnter: 15, flexDwellMs: 67 });
  });
  it('denies entry only while its current geometry is suspect and retries on later clear data', () => {
    const { send, guard } = runner(); send(frame(0, 0)); send(frame(50, .6), .1); send(frame(100, .6), -1);
    expect(send(frame(150, .6))).toMatchObject({ direction: 'KNEE_LEFT', candidateStartedAt: 100 });
    expect(guard.observations.map((o) => [o.timestamp, o.decision])).toEqual([[50, true], [100, false]]);
  });
  it('never cancels a continuing side run even when another channel enters on an anomalous frame', () => {
    const { send, guard } = runner(); send(frame(0, 0)); send(frame(50, .6));
    const next = frame(100, .6); next.LEFT.FLEXION = 30;
    expect(send(next, .3)?.direction).toBe('KNEE_LEFT'); expect(guard.observations).toHaveLength(1);
  });
  it('checks a genuinely new channel when the previous run ends now', () => {
    const { send, guard, detector } = runner(); send(frame(0, 0)); send(frame(50, .6));
    const next = frame(100, 0); next.LEFT.FLEXION = 30; send(next, .3);
    expect(guard.observations.at(-1)).toMatchObject({ timestamp: 100, decision: true }); expect(detector.getView().sides.LEFT.FLEXION.runAt).toBeNull();
  });
  it('never uses past anomaly peaks or unknown geometry as a veto', () => {
    const { send, guard } = runner(); send(frame(0, 0), 5); send(frame(50, .6), null);
    expect(send(frame(100, .6))?.direction).toBe('KNEE_LEFT'); expect(guard.observations[0].decision).toBeNull();
  });
  it('preserves integrity12 entry blocking and recovery', () => {
    const { send, guard, detector } = runner(); send(frame(0, 0)); send(frame(50, .6, 13), .3);
    expect(guard.observations).toEqual([]); expect(detector.getSoftEpisodes()[0].reasons[0].threshold).toBe(12);
    send(frame(100, 0)); send(frame(200, 0)); send(frame(250, .6)); expect(send(frame(300, .6))?.direction).toBe('KNEE_LEFT');
  });
});
