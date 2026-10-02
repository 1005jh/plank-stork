import { describe, expect, it, vi } from 'vitest';
import { analyzeShadowConfig, createShadowReport, shadowConfigs } from './analyzeShadow';
import { prepareTemporalDatasets, summarizeTemporalDatasets } from './analyzeTemporal';
import { DEFAULT_SHADOW_CONFIG } from './yKickShadowDetector';
import { discoveryFixture, discoveryFrame } from './testFixtures';
import { buildNeutralReference, discoveryFeatures } from './discoveryFeatures';
import { fullTrial, TRIAL_AT } from '../replay/testFixtures';
import { replayLandmarks } from '../replay/landmarkReplay';

async function shadowFixture(stress = false) {
  const session = await discoveryFixture(), scale = session.liveResult.trials[0].baseline.bodyScale;
  session.captureId = stress ? 'stress' : 'clean'; session.poseFrames = [];
  // A long LEFT hold crosses the KNEE_LEFT -> NEUTRAL boundary, then has a 700ms tail.
  for (let t = 0; t < 22000; t += 25) {
    const left = t >= 12500 && t < 15700 ? 0.6 : t === 2500 ? 0.65 : 0;
    const right = t >= 17500 && t <= 17575 ? 0.46 : 0;
    const frame = discoveryFrame(t, left * scale, right * scale);
    if (t >= 17000 && t < 20000) frame.landmarks[25].visibility = 0.1; // RIGHT eligibility must stay independent.
    if (stress && t >= 17000 && t < 20000) { frame.landmarks = []; frame.worldLandmarks = []; }
    if (stress && t === 8000) frame.landmarks[25].y += 0.5 * scale;
    if (stress && t === 8025) { frame.landmarks = []; frame.worldLandmarks = []; }
    session.poseFrames.push(frame);
  }
  const prepared = prepareTemporalDatasets(session, stress ? '3차검증2.json' : 'clean인가요.json');
  const temporal = summarizeTemporalDatasets(prepared); temporal[0].role = stress ? 'STRESS' : 'CLEAN';
  return { session, prepared, temporal };
}
describe('stateful whole-timeline shadow analysis', () => {
  it('reuses STEP 4G Y values exactly without mirror or a production baseline change', async () => {
    const { session, prepared } = await shadowFixture();
    const before = JSON.stringify(session);
    const stage = prepared[0].stages[0], neutral = buildNeutralReference(session.poseFrames.filter((f) => f.tMs >= stage.startMs && f.tMs < stage.endMs));
    for (const index of [0, 100, 510, 702]) {
      const values = discoveryFeatures(session.poseFrames[index], neutral, session.liveResult.trials[0].baseline);
      expect(prepared[0].frames[index].LEFT.deltaDyNorm).toBe(values.deltaDyNorm.LEFT);
      expect(prepared[0].frames[index].RIGHT.absY).toBe(values.deltaDyNorm.RIGHT === null ? null : Math.abs(values.deltaDyNorm.RIGHT!));
    }
    expect(JSON.stringify(session)).toBe(before);
  });
  it.each(['FIRST_DWELL', 'INTEGRATED_WINDOW'] as const)('%s: clean 0.4/50 detects both sides once and absorbs the 700ms neutral tail', async (directionStrategy) => {
    const { prepared, temporal } = await shadowFixture();
    const r = analyzeShadowConfig(prepared, temporal, { ...DEFAULT_SHADOW_CONFIG, directionStrategy });
    expect(r.assessment).toBe('VIABLE');
    expect(r.clean).toMatchObject({ correctLeft: 1, correctRight: 1, falseEvents: 0, duplicates: 0, wrongDirection: 0 });
    expect(r.clean.events.map((e) => e.expected)).toEqual(['KNEE_LEFT', 'KNEE_RIGHT']);
    const data = r.clean.datasets[0];
    expect(data.finalState).toBe('ARMED');
    const right = data.stages.find((s) => s.expected === 'KNEE_RIGHT')!;
    expect(right).toMatchObject({ observable: true, leftCoverage: 0, rightCoverage: 1, outcome: 'CORRECT' });
    expect(temporal[0].stages.find((s) => s.expected === 'KNEE_RIGHT')?.observable).toBe(true);
    const rearm = data.rearmTimes.find((r) => r.eventId === 1)!;
    expect(rearm.timestamp).toBeGreaterThan(TRIAL_AT + 15700);
    expect(rearm.nextAction).toMatchObject({ expected: 'KNEE_RIGHT', armedBeforeStart: true });
  });
  it('reports loss cancellation/WAIT_CLEAR and does not penalize an unobservable STRESS right miss', async () => {
    const clean = await shadowFixture(), stress = await shadowFixture(true);
    const r = analyzeShadowConfig([...clean.prepared, ...stress.prepared], [...clean.temporal, ...stress.temporal], DEFAULT_SHADOW_CONFIG);
    expect(r.assessment).toBe('VIABLE');
    expect(r.stress).toMatchObject({ crossGapConfirmations: 0, poseLossGeneratedFalseEvents: 0, falseEvents: 0 });
    expect(r.stress.cancelledCandidates.some((c) => c.reason === 'POSE_LOSS')).toBe(true);
    const right = r.stress.datasets[0].stages.find((s) => s.expected === 'KNEE_RIGHT')!;
    expect(right.outcome).toBe('UNOBSERVABLE'); expect(right.rightCoverage).toBe(0);
  });
  it('sweeps only requested neighbors and exports all viable results with deterministic return times', async () => {
    const { prepared, temporal } = await shadowFixture(), configs = shadowConfigs();
    expect(configs).toHaveLength(288); expect(new Set(configs.map((c) => c.enter))).toEqual(new Set([0.35, 0.4, 0.45]));
    const center = configs.filter((c) => c.enter === 0.4 && c.dwellMs === 50);
    const perConfig = center.map((c) => analyzeShadowConfig(prepared, temporal, c));
    expect(perConfig).toHaveLength(32); expect(perConfig.every((r) => r.assessment === 'VIABLE')).toBe(true);
    const report = createShadowReport(temporal, perConfig, '2026-10-02T00:00:00Z');
    expect(report.viableStatefulConfigs).toHaveLength(32);
    expect(JSON.stringify(report)).not.toMatch(/"(landmarks|worldLandmarks|frames)":/);
    const a = perConfig.find((r) => r.returnDwellMs === 100 && r.directionStrategy === 'FIRST_DWELL')!;
    const b = perConfig.find((r) => r.returnDwellMs === 200 && r.directionStrategy === 'FIRST_DWELL')!;
    expect(b.clean.rearmTimes[0].timestamp - a.clean.rearmTimes[0].timestamp).toBe(100);
  });
  it('preserves role selections/warns without CLEAN, with no filename-based role inference', async () => {
    const { prepared, temporal } = await shadowFixture(); temporal[0].role = 'UNASSIGNED';
    const result = analyzeShadowConfig(prepared, temporal, DEFAULT_SHADOW_CONFIG);
    const report = createShadowReport(temporal, [result]);
    expect(result.assessment).toBe('INSUFFICIENT_EVIDENCE'); expect(report.viableStatefulConfigs).toEqual([]);
    expect(report.warnings).toEqual(['No CLEAN dataset selected']); expect(report.inputs[0].role).toBe('UNASSIGNED');
  });
  it('does not use non-kick coverage as an extra viability gate, but flags fresh reacquisition false events', async () => {
    const clean = await shadowFixture(), stress = await shadowFixture();
    // Non-kick missing evidence is exposed separately from observed shadow event counts.
    for (const frame of clean.prepared[0].frames) if (frame.timestamp >= TRIAL_AT + 5000 && frame.timestamp < TRIAL_AT + 7000) {
      frame.LEFT.usable = false; frame.LEFT.absY = null;
    }
    clean.temporal = summarizeTemporalDatasets(clean.prepared); clean.temporal[0].role = 'CLEAN';
    expect(analyzeShadowConfig(clean.prepared, clean.temporal, DEFAULT_SHADOW_CONFIG).assessment).toBe('VIABLE');
    stress.temporal[0].role = 'STRESS'; stress.prepared[0].input.filename = 'reacquisition.json';
    stress.temporal[0].input = stress.prepared[0].input;
    for (const f of stress.prepared[0].frames) {
      const t = f.timestamp - TRIAL_AT;
      if (t === 5000) { f.RIGHT.usable = false; f.RIGHT.absY = null; }
      if (t >= 5025 && t <= 5100) { f.RIGHT.usable = true; f.RIGHT.absY = 1.2; }
    }
    const result = analyzeShadowConfig([...clean.prepared, ...stress.prepared], [...clean.temporal, ...stress.temporal], DEFAULT_SHADOW_CONFIG);
    expect(result.stress.crossGapConfirmations).toBe(0);
    expect(result.stress.poseLossGeneratedFalseEvents).toBe(1); expect(result.assessment).toBe('REJECTED');
  });
  it('is deterministic, read-only, and leaves the live production detector/LANDMARK parity unchanged', async () => {
    const live = await fullTrial(), source = JSON.stringify(live.session), snapshot = live.kick.getReplaySnapshot();
    const prepared = prepareTemporalDatasets(live.session, 'parity.json'), temporal = summarizeTemporalDatasets(prepared);
    const baselineReplay = replayLandmarks(live.session, 1);
    const now = vi.spyOn(performance, 'now').mockImplementation(() => { throw new Error('wall clock'); });
    try {
      expect(analyzeShadowConfig(prepared, temporal, DEFAULT_SHADOW_CONFIG)).toEqual(analyzeShadowConfig(prepared, temporal, DEFAULT_SHADOW_CONFIG));
    } finally { now.mockRestore(); }
    expect(JSON.stringify(live.session)).toBe(source); expect(live.kick.getReplaySnapshot()).toEqual(snapshot);
    expect(replayLandmarks(live.session, 1)).toEqual(baselineReplay);
    expect(baselineReplay.comparison).toMatchObject({ eventsEqual: true, finalStateEqual: true, guidedSummaryEqual: true });
  });
});
