// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fullTrial, TRIAL_AT } from './testFixtures';
import { replayKneeKickV3, resolveV3ReplayBaseline } from './kneeKickV3Replay';
import { replayCalibration, replayLandmarks } from './landmarkReplay';
import { readReplaySession } from './readReplaySession';
import { discoveryFixture, discoveryFrame } from '../discovery/testFixtures';
import { prepareTemporalDatasets } from '../discovery/analyzeTemporal';

async function fixture(stress = false) {
  const session = await discoveryFixture(), scale = session.liveResult.trials[0].baseline.bodyScale;
  session.poseFrames = session.poseFrames.filter((f) => f.tMs < TRIAL_AT);
  for (let t = 0; t <= 22000; t += 25) {
    const left = t >= 12500 && t < 15700 ? 0.7 : 0;
    const right = t >= 17500 && t < 17700 ? 0.46 : 0;
    const f = discoveryFrame(t, left * scale, right * scale);
    if (t >= 17000 && t < 20000) f.landmarks[25].visibility = 0.1;
    if (stress) {
      if (t >= 5000 && t < 5050 || t >= 17000 && t < 20000) { f.landmarks = []; f.worldLandmarks = []; }
      if (t >= 5050 && t < 5600) f.landmarks[26].y += 1.2 * scale;
    }
    session.poseFrames.push(f);
  }
  return session;
}
describe('V3 LANDMARK production-candidate replay', () => {
  it('uses production V3 core with a stored frozen baseline, keeping X replay/recorded baseline intact', async () => {
    const session = await fixture(), before = JSON.stringify(session), x = replayLandmarks(session, 1);
    const r = replayKneeKickV3(session, 1);
    expect(r.baseline.source).toBe('STORED_V3'); expect(r.cleanAcceptance).toBe(true);
    expect(r.counts).toMatchObject({ leftDetected: 1, rightDetected: 1, falseEvents: 0, wrongDirection: 0, duplicates: 0 });
    expect(r.result.finalState).toBe('ARMED'); expect(r.result.guidedSummary!.KNEE_RIGHT).toMatchObject({ detected: true, directionCorrect: true });
    expect(r.stages.find((s) => s.expected === 'KNEE_RIGHT')).toMatchObject({ outcome: 'CORRECT', leftUsableFrames: 0, observable: true });
    expect(r.legacyX).toEqual(x); expect(JSON.stringify(session)).toBe(before);
  });
  it('gates reacquisition and lets Guided time continue while an expected STRESS kick is unobservable', async () => {
    const r = replayKneeKickV3(await fixture(true), 1);
    expect(r.stressAcceptance).toBe(true); expect(r.counts).toMatchObject({ falseEvents: 0, crossGapConfirmations: 0, reacquisitionFalseEvents: 0 });
    expect(r.stages.find((s) => s.expected === 'KNEE_RIGHT')!.outcome).toBe('UNOBSERVABLE');
    expect(r.guided.status).toBe('COMPLETED'); expect(r.guided.timings.every((s) => s.armedWaitMs === 0)).toBe(true);
    expect(r.diagnostics.find((d) => d.timestamp === TRIAL_AT + 5200)).toMatchObject({ rightTrackingState: 'REACQUIRED_NOT_READY', rightEnterRunMs: 0 });
  });
  it('restores Y baseline from real calibration frames when the old capture lacks V3 metadata', async () => {
    const { session } = await fullTrial(); delete session.liveResult.trials[0].baselineV3; delete session.liveResult.kickBaselineV3;
    const r = replayKneeKickV3(session, 1);
    expect(r.baseline.source).toBe('CALIBRATION_REPLAY'); expect(r.baseline.baseline.leftYMedian).toBeCloseTo(0.3);
    expect(replayCalibration(session, 1)).toMatchObject({ neutralBaselineEqual: true, kickBaselineEqual: true });
  });
  it('labels legacy first-Neutral reconstruction and excludes its in-sample calibration frames', async () => {
    const session = await fixture(); delete session.liveResult.trials[0].baselineV3;
    session.markers = session.markers.filter((m) => m.type !== 'NEUTRAL_CALIBRATION_START');
    const r = replayKneeKickV3(session, 1), prepared = prepareTemporalDatasets(session, 'old.json')[0];
    expect(r.baseline.source).toBe('FIRST_NEUTRAL_RECONSTRUCTION'); expect(r.calibrationOnlyFrameCount).toBeGreaterThan(0);
    expect(r.stages[0]).toMatchObject({ calibrationOnly: true, outcome: 'NOT_EVALUATED' });
    expect(r.events.every((e) => e.timestamp >= TRIAL_AT + 2000)).toBe(true); expect(r.cleanAcceptance).toBe(true);
    for (const row of r.diagnostics.filter((d) => !d.calibrationOnly && d.expected === 'KNEE_LEFT')) {
      const original = prepared.frames.find((f) => f.timestamp === row.timestamp)!;
      expect(row.normalizedYLeft).toBeCloseTo(original.LEFT.deltaDyNorm!, 12);
    }
  });
  it('never learns from action stages when baseline reconstruction has insufficient valid Neutral samples', async () => {
    const session = await fixture(); delete session.liveResult.trials[0].baselineV3;
    session.markers = session.markers.filter((m) => m.type !== 'NEUTRAL_CALIBRATION_START');
    session.poseFrames.forEach((f) => { if (f.tMs < TRIAL_AT + 2000) { f.landmarks = []; f.worldLandmarks = []; } });
    expect(() => replayKneeKickV3(session, 1)).toThrow('usable samples');
  });
  it('keeps old version1 readable but rejects invalid optional V3 fields instead of silently reconstructing them', async () => {
    const session = await fixture(); expect(readReplaySession(JSON.stringify(session)).liveResult.trials[0].baselineV3?.version).toBe(3);
    const b = session.liveResult.trials[0].baselineV3!; b.bodyScale = 0;
    expect(() => readReplaySession(JSON.stringify(session))).toThrow('Replay JSON');
    expect(() => resolveV3ReplayBaseline(session, session.liveResult.trials[0])).toThrow('baseline');
    delete session.liveResult.trials[0].baselineV3; delete session.liveResult.kickBaselineV3;
    expect(readReplaySession(JSON.stringify(session)).version).toBe(1);
  });
  it('is deterministic under UI clock reads and Mirror changes; preserves X LIVE/LANDMARK calibration regression', async () => {
    const session = await fixture(), r = replayKneeKickV3(session, 1);
    session.display.mirrorEnabled = !session.display.mirrorEnabled;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => { throw new Error('wall clock'); });
    try { expect(replayKneeKickV3(session, 1)).toEqual(r); } finally { clock.mockRestore(); }
    const live = await fullTrial(); const before = live.kick.getReplaySnapshot();
    replayKneeKickV3(live.session, 1); expect(live.kick.getReplaySnapshot()).toEqual(before);
    expect(replayLandmarks(live.session, 1).comparison).toMatchObject({ eventsEqual: true, finalStateEqual: true, guidedSummaryEqual: true });
  });
});
