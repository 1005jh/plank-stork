import { describe, expect, it, vi } from 'vitest';
import { analyzeReacquisitionConfig, createReacquisitionReport, reacquisitionConfigs, type ReacquisitionSweepConfig } from './analyzeReacquisition';
import { prepareTemporalDatasets, summarizeTemporalDatasets } from './analyzeTemporal';
import { clearAvailability, eventTracking, falseReacquisitionTraces, physicalContinuity } from './reacquisitionTrace';
import { discoveryFixture } from './testFixtures';
import type { TemporalPoint, TemporalRole } from './temporalEvidence';
import { fullTrial } from '../replay/testFixtures';
import { replayLandmarks } from '../replay/landmarkReplay';

const config: ReacquisitionSweepConfig = { lossMinMs: 0, strategy: 'CLEAR_ONLY', settleMs: 0, clearThreshold: 0.25, clearDwellMs: 100, directionStrategy: 'FIRST_DWELL' };
async function fixture(role: TemporalRole) {
  const session = await discoveryFixture(); session.captureId = role;
  const prepared = prepareTemporalDatasets(session, `${role}.json`), d = prepared[0], seed = d.frames[0], start = d.stages[0].startMs;
  d.frames = [];
  for (let t = 0; t < 22000; t += 25) {
    const timestamp = start + t, left = t >= 12500 && t < 13000 ? 0.8 : 0, right = t >= 17500 && t < 18000 ? 0.8 : 0;
    const point = (y: number): TemporalPoint => ({ ...seed.LEFT, timestamp, usable: true, absY: y, deltaDyNorm: y });
    const frame = { timestamp, LEFT: point(left), RIGHT: point(right) };
    if (role === 'STRESS') {
      if (t >= 5000 && t < 5050 || t >= 17000 && t < 20000) { frame.RIGHT.usable = false; frame.RIGHT.absY = null; }
      if (t >= 5050 && t < 5550) frame.RIGHT.absY = 1.2;
    }
    d.frames.push(frame);
  }
  const temporal = summarizeTemporalDatasets(prepared); temporal[0].role = role;
  return { prepared, temporal, start };
}
describe('reacquisition sweep and trace', () => {
  it('bounds the grid to 472 gate configs x two strategies, keeping the shadow thresholds fixed', () => {
    const configs = reacquisitionConfigs(); expect(configs).toHaveLength(944);
    expect(new Set(configs.map((c) => JSON.stringify(c))).size).toBe(944);
    expect(configs.filter((c) => c.strategy === 'FIXED_SETTLE')).toHaveLength(128);
    expect(configs.filter((c) => c.strategy === 'CLEAR_ONLY')).toHaveLength(384);
    expect(configs.filter((c) => c.strategy === 'SETTLE_AND_CLEAR')).toHaveLength(432);
    expect(new Set(configs.map((c) => c.lossMinMs))).toEqual(new Set([0, 33, 67, 100, 150, 200, 300, 400]));
  });
  it('evaluates CLEAN regression and excludes an unobservable STRESS kick miss', async () => {
    const a = await fixture('CLEAN'), b = await fixture('STRESS');
    const r = analyzeReacquisitionConfig([...a.prepared, ...b.prepared], [...a.temporal, ...b.temporal], config);
    expect(r.assessment).toBe('VIABLE'); expect(r.clean).toMatchObject({ leftDetected: 1, rightDetected: 1, falseEvents: 0, duplicates: 0, wrongDirection: 0 });
    expect(r.clean.finalStates[0].state).toBe('ARMED'); expect(r.stress).toMatchObject({ crossGapConfirmations: 0, reacquisitionFalseEvents: 0, poseLossFalseEvents: 0 });
    expect(r.stress.datasets[0].stages.find((s) => s.expected === 'KNEE_RIGHT')!.outcome).toBe('UNOBSERVABLE');
    expect(r.clean.datasets[0].events[0].source).toBe('NORMAL_TRACKING');
  });
  it('attributes a delayed post-settle false event to reacquisition, not just its first frame', async () => {
    const a = await fixture('CLEAN'), b = await fixture('STRESS');
    const r = analyzeReacquisitionConfig([...a.prepared, ...b.prepared], [...a.temporal, ...b.temporal], { ...config, strategy: 'FIXED_SETTLE', settleMs: 100, clearThreshold: null });
    expect(r.assessment).toBe('REJECTED'); expect(r.stress.reacquisitionFalseEvents).toBe(1);
    const e = r.stress.datasets[0].events.find((e) => e.falseEvent)!;
    expect(e).toMatchObject({ source: 'POST_REACQUISITION', candidateStartedTrackingAgeMs: 100, crossGapConfirmation: false });
  });
  it('tracks a reacquired winning side even when the other side seeded the candidate earlier', async () => {
    const { prepared, start } = await fixture('STRESS'), d = prepared[0];
    const continuity = physicalContinuity(d);
    expect(eventTracking(continuity.episodes, d.frames, 'RIGHT', start + 5025, start + 5050)).toMatchObject({
      source: 'POST_REACQUISITION', candidateStartedTrackingAgeMs: -25, sideEvidenceStartedTrackingAgeMs: 0,
      reacquiredAt: start + 5050,
    });
  });
  it('identifies a normal CLEAN kick suppressed by a qualifying brief dropout/clear gate', async () => {
    const a = await fixture('CLEAN'), b = await fixture('STRESS');
    const f = a.prepared[0].frames.find((f) => f.timestamp === a.start + 12475)!; f.LEFT.usable = false; f.LEFT.absY = null;
    a.temporal = summarizeTemporalDatasets(a.prepared); a.temporal[0].role = 'CLEAN';
    const r = analyzeReacquisitionConfig([...a.prepared, ...b.prepared], [...a.temporal, ...b.temporal], config);
    expect(r.assessment).toBe('REJECTED'); expect(r.clean.leftDetected).toBe(0); expect(r.clean.rightDetected).toBe(1);
    expect(r.clean.datasets[0].stages.find((s) => s.expected === 'KNEE_LEFT')!.outcome).toBe('MISS');
  });
  it('exports ungated exact event/gap/visibility traces for both direction strategies with null-aware decay', async () => {
    const a = await fixture('STRESS');
    const traces = falseReacquisitionTraces(a.prepared, a.temporal);
    expect(traces).toHaveLength(2);
    expect(traces[0]).toMatchObject({ gapDurationMs: 50, usableToUsableGapMs: 75, reacquireToCandidateMs: 0, reacquireToTriggerMs: 50,
      atReacquisition: { RIGHT: 1.2 } });
    expect(traces[1].reacquireToTriggerMs).toBe(150);
    expect(traces[0].evidenceWindows.map((w) => w.afterMs)).toEqual([50, 100, 200, 300, 500, 1000]);
    expect(traces[0].evidenceWindows[0].RIGHT.cumulativeMedianAbsY).toBe(1.2);
    expect(traces[0].clearAvailability.find((c) => c.side === 'RIGHT' && c.threshold === 0.25 && c.dwellMs === 100))
      .toMatchObject({ firstClearStartMs: a.start + 5550, firstClearSatisfiedMs: a.start + 5650, timeToClearMs: 600 });
    for (const f of a.prepared[0].frames) if (f.timestamp >= a.start + 5125 && f.timestamp < a.start + 7000) { f.RIGHT.usable = false; f.RIGHT.absY = null; }
    const trace = falseReacquisitionTraces(a.prepared, a.temporal)[0];
    expect(trace.evidenceWindows[5].RIGHT.trailing50msMedianAbsY).toBeNull();
    expect(trace.evidenceWindows[5].RIGHT.cumulativeMedianAbsY).toBe(1.2);
    expect(trace.clearAvailability.filter((c) => c.side === 'RIGHT').every((c) => c.status === 'NO_CLEAR_OBSERVED')).toBe(true);
  });
  it('clear availability resets on missing, equality and 400ms gap, and respects stage end', async () => {
    const { prepared } = await fixture('CLEAN'), seed = prepared[0].frames[0];
    const frames = [0, 50, 75, 100, 125, 150, 550, 600, 650].map((timestamp) => ({ ...seed, timestamp,
      RIGHT: { ...seed.RIGHT, usable: timestamp !== 50, absY: timestamp === 100 ? 0.25 : 0 } }));
    expect(clearAvailability(frames, 'RIGHT', 0, 650, 0.25, 100)).toMatchObject({ status: 'CLEAR_DWELL_NOT_SATISFIED', firstClearStartMs: 0 });
    expect(clearAvailability(frames, 'RIGHT', 0, 651, 0.25, 100)).toMatchObject({ status: 'CLEAR_SATISFIED', satisfiedRunStartMs: 550, firstClearSatisfiedMs: 650 });
  });
  it('preserves explicit roles, requires both test roles, exports latency/censored episodes without a BEST', async () => {
    const a = await fixture('CLEAN');
    const r = analyzeReacquisitionConfig(a.prepared, a.temporal, config);
    expect(r.assessment).toBe('INSUFFICIENT_EVIDENCE');
    const report = createReacquisitionReport(a.temporal, [], [r], 'fixed-date');
    expect(report.warnings).toEqual(['No STRESS dataset selected']); expect(report.viableReacquisitionConfigs).toEqual([]);
    expect(r.strategyComplexity).toBe(1); expect(r.clean.addedEligibilityLatencyMs).toMatchObject({ completedCount: 0, unresolvedCount: 0, median: null });
    expect(JSON.stringify(report)).not.toMatch(/"(landmarks|worldLandmarks|frames|best)":/);
    a.temporal[0].role = 'UNASSIGNED'; expect(analyzeReacquisitionConfig(a.prepared, a.temporal, config).unassigned).toHaveLength(1);
  });
  it('same replay/config is deterministic and read-only; live and LANDMARK production parity is unchanged', async () => {
    const a = await fixture('CLEAN'), b = await fixture('STRESS');
    const live = await fullTrial(), before = JSON.stringify(live.session), snapshot = live.kick.getReplaySnapshot();
    const baselineReplay = replayLandmarks(live.session, 1);
    const prepared = [...a.prepared, ...b.prepared], temporal = [...a.temporal, ...b.temporal], saved = JSON.stringify(prepared);
    const now = vi.spyOn(performance, 'now').mockImplementation(() => { throw new Error('wall-clock must not affect analysis'); });
    try { expect(analyzeReacquisitionConfig(prepared, temporal, config)).toEqual(analyzeReacquisitionConfig(prepared, temporal, config)); }
    finally { now.mockRestore(); }
    expect(JSON.stringify(prepared)).toBe(saved); expect(JSON.stringify(live.session)).toBe(before);
    expect(live.kick.getReplaySnapshot()).toEqual(snapshot); expect(replayLandmarks(live.session, 1)).toEqual(baselineReplay);
  });
});
