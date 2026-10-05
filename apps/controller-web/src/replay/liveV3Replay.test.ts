// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fullTrial, fullV3Trial, liveHarness, ORIGIN, TRIAL_AT } from './testFixtures';
import { readReplaySession } from './readReplaySession';
import { replayDetectorMode } from './replayTypes';
import { replayKneeKickV3, resolveV3ReplayBaseline } from './kneeKickV3Replay';
import { replayCalibration, replayLandmarks } from './landmarkReplay';
import { motionFrame } from '../pose/motion/testFixtures';

describe('STEP 4I primary live capture / V3 replay parity', () => {
  it('writes backward-compatible version1 with V3 primary result and separately labelled X shadow', async () => {
    const { session } = await fullV3Trial(), saved = readReplaySession(JSON.stringify(session));
    expect(saved).toMatchObject({ version: 1, detectorMode: 'Y_V3', detectorConfigV3: { version: 3, enter: .4, enterDwellMs: 50 } });
    const trial = saved.liveResult.trials[0];
    expect(trial.baselineV3).toMatchObject({ version: 3 }); expect(trial.baseline).toHaveProperty('leftMedian');
    expect(trial.result.events.map((e) => e.direction)).toEqual(['KNEE_LEFT', 'KNEE_RIGHT']);
    expect(trial.result.guidedSummary).toMatchObject({ NEUTRAL: { falseKickCount: 0 }, TWIST_LEFT: { falseKickCount: 0 }, TWIST_RIGHT: { falseKickCount: 0 },
      KNEE_LEFT: { detected: true, directionCorrect: true, wrongEventCount: 0, duplicateCount: 0 },
      KNEE_RIGHT: { detected: true, directionCorrect: true, wrongEventCount: 0, duplicateCount: 0 } });
    expect(trial.legacyXShadow!.result.guidedSummary!.TWIST_LEFT.falseKickCount).toBe(1);
    expect(saved.liveResult.events.map((e) => e.direction)).toEqual(['KNEE_LEFT', 'KNEE_RIGHT']);
  });
  it('matches primary directions/times, summary, final state and frame coverage without X contamination', async () => {
    const { session } = await fullV3Trial(), recorded = session!, before = JSON.stringify(recorded);
    const replay = replayKneeKickV3(recorded, 1);
    expect(replay.comparison).toMatchObject({ target: 'LIVE_V3', eventsEqual: true, finalStateEqual: true, guidedSummaryEqual: true });
    expect(replay.result).toEqual(recorded.liveResult.trials[0].result);
    expect(replay.result.finalState).toBe('ARMED'); expect(replay.cleanAcceptance).toBe(true);
    expect(replay.legacyX.comparison).toMatchObject({ target: 'LIVE_X_SHADOW', eventsEqual: true, guidedSummaryEqual: true, finalStateEqual: true });
    expect(replay.legacyX.result.events).not.toEqual(replay.result.events);
    expect(JSON.stringify(recorded)).toBe(before);
  });
  it('reconstructs the stored V3 baseline from captured Neutral calibration, never first Guided Neutral', async () => {
    const { session } = await fullV3Trial(), saved = session!;
    expect(replayCalibration(saved, 1)).toMatchObject({ neutralBaselineEqual: true, kickBaselineEqual: true, kickBaselineV3Equal: true });
    expect(replayKneeKickV3(saved, 1)).toMatchObject({ baseline: { source: 'STORED_V3' }, calibrationOnlyFrameCount: 0, calibrationParity: { kickBaselineV3Equal: true } });
    delete saved.liveResult.trials[0].baselineV3;
    expect(resolveV3ReplayBaseline(saved, saved.liveResult.trials[0]).source).toBe('CALIBRATION_REPLAY');
    saved.markers = saved.markers.filter((m) => m.type !== 'NEUTRAL_CALIBRATION_START');
    expect(() => replayKneeKickV3(saved, 1)).toThrow('첫 Neutral stage');
  });
  it('keeps captures with no mode as X even when an optional V3 baseline exists', async () => {
    const { session } = await fullTrial(); delete session.detectorMode; delete session.detectorConfigV3;
    const old = readReplaySession(JSON.stringify(session));
    expect(replayDetectorMode(old)).toBe('LEGACY_X');
    expect(replayLandmarks(old, 1).comparison).toMatchObject({ target: 'LIVE_X', eventsEqual: true, guidedSummaryEqual: true, finalStateEqual: true });
    expect(replayKneeKickV3(old, 1).comparison).toBeNull();
  });
  it('is repeatable, isolated from wall time / Mirror and unaffected by capture being enabled', async () => {
    const live = await fullV3Trial(), without = await fullV3Trial(false);
    expect(live.kick.getReplaySnapshot()).toEqual(without.kick.getReplaySnapshot());
    const first = replayKneeKickV3(live.session!, 1); live.session!.display.mirrorEnabled = false;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => { throw new Error('No wall clock'); });
    try { expect(replayKneeKickV3(live.session!, 1)).toEqual(first); } finally { clock.mockRestore(); }
  });
  it('keeps X a reference when a V3 capture has no saved shadow and rejects unknown mode', async () => {
    const { session } = await fullV3Trial(), saved = session!; delete saved.liveResult.trials[0].legacyXShadow;
    expect(replayKneeKickV3(saved, 1).comparison!.eventsEqual).toBe(true);
    expect(replayLandmarks(saved, 1).comparison).toMatchObject({ target: 'LIVE_X_SHADOW', available: false });
    expect(() => readReplaySession(JSON.stringify({ ...saved, detectorMode: 'TYPO' }))).toThrow('Replay JSON');
  });
  it('restarts both frozen baselines and captures a second trial independently', async () => {
    const live = liveHarness(true, 'Y_V3');
    const send = (t: number) => {
      const f = motionFrame(ORIGIN + TRIAL_AT + t); f.landmarks[26].y += .6 * live.baseline.bodyScale; live.frame(f);
    };
    send(20); send(80);
    const time = ORIGIN + TRIAL_AT + 100;
    live.capture.observe({ kind: 'RESET', timestamp: time }, () => live.kick.getReplaySnapshot()); live.kick.resetTest(time);
    live.kick.startTest(time + 20); live.capture.observe({ kind: 'START', timestamp: time + 20 }, () => live.kick.getReplaySnapshot());
    send(160); send(220);
    const session = await live.finish(240);
    expect(session.liveResult.trials).toHaveLength(2);
    for (const trial of session.liveResult.trials) {
      expect(trial.result.events).toHaveLength(1); expect(trial.result.events[0].id).toBe(1);
      expect(replayKneeKickV3(session, trial.id).comparison).toMatchObject({ eventsEqual: true, finalStateEqual: true, guidedSummaryEqual: true });
    }
  });
});
