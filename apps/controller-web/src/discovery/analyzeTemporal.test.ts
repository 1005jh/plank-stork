import { describe, expect, it, vi } from 'vitest';
import { analyzeTemporal, createTemporalReport, type TemporalDataset } from './analyzeTemporal';
import { discoveryFixture, discoveryFrame, STAGE_OFFSETS } from './testFixtures';
import { TRIAL_AT } from '../replay/testFixtures';
const assign = (datasets: TemporalDataset[], role: 'CLEAN' | 'STRESS') => datasets.map((d) => ({ ...d, role }));

async function temporalFixture(edgeTail = false) {
  const session = await discoveryFixture(), scale = session.liveResult.trials[0].baseline.bodyScale;
  session.poseFrames = STAGE_OFFSETS.flatMap((start, index) => {
    const duration = (STAGE_OFFSETS[index + 1] ?? 22000) - start;
    return Array.from({ length: duration / 50 }, (_, frameIndex) => {
      const t = frameIndex * 50, kick = index === 5 || index === 7;
      const y = kick ? (t >= 500 && t <= 900 ? 0.5 : 0) : edgeTail ? (t >= 50 && t <= 150 ? 0.7 : 0) : t === 500 ? 0.7 : 0;
      return discoveryFrame(start + t, index === 7 ? 0 : y * scale, index === 7 ? y * scale : 0);
    });
  });
  return session;
}
describe('CLEAN temporal rules and STRESS isolation', () => {
  it('lists every viable combination without treating the static high non-kick peak as a detector rule', async () => {
    const report = createTemporalReport(assign(analyzeTemporal(await temporalFixture(), 'clean인가요.json'), 'CLEAN'));
    expect(report.rulesClean).toHaveLength(392);
    const rule = (dwellMs: number) => report.rulesClean.find((r) => r.window === 'FULL' && r.threshold === 0.3 && r.dwellMs === dwellMs && r.confirmation2D === null)!;
    expect(rule(0).assessment).toBe('REJECTED');
    expect(rule(100)).toMatchObject({ assessment: 'VIABLE', neutralFalse: 0, twistLeftFalse: 0, twistRightFalse: 0, kneeLeftDetected: true, kneeRightDetected: true });
    expect(report.viableRulesClean).toContainEqual(rule(100));
    expect(report.viableRulesClean.every((r) => r.assessment === 'VIABLE')).toBe(true);
  });
  it('keeps FULL tails visible and shows an independent TRIMMED result', async () => {
    const report = createTemporalReport(assign(analyzeTemporal(await temporalFixture(true), 'clean인가요.json'), 'CLEAN'));
    const rules = report.rulesClean.filter((r) => r.threshold === 0.3 && r.dwellMs === 80 && r.confirmation2D === null);
    expect(rules.map((r) => r.assessment)).toEqual(['REJECTED', 'VIABLE']);
    const tl = report.perDataset[0].stages.filter((s) => s.expected === 'TWIST_LEFT');
    expect(tl[0].sides.LEFT.peak).toBeCloseTo(0.7); expect(tl[1].sides.LEFT.peak).toBeCloseTo(0);
  });
  it('excludes unobservable STRESS from CLEAN evaluation and never emits a missing kick as false', async () => {
    const clean = await temporalFixture(), stress = structuredClone(clean); stress.captureId = 'stress';
    for (const frame of stress.poseFrames.filter((f) => f.tMs >= TRIAL_AT + 17000 && f.tMs < TRIAL_AT + 20000)) { frame.landmarks = []; frame.worldLandmarks = []; }
    const cleanDatasets = assign(analyzeTemporal(clean, 'clean인가요.json'), 'CLEAN'), stressDatasets = assign(analyzeTemporal(stress, '3차검증2.json'), 'STRESS');
    const cleanReport = createTemporalReport(cleanDatasets), together = createTemporalReport([...cleanDatasets, ...stressDatasets]);
    expect(together.viableRulesClean).toEqual(cleanReport.viableRulesClean);
    const right = stressDatasets[0].stages.find((s) => s.expected === 'KNEE_RIGHT' && s.window === 'FULL')!;
    expect(right).toMatchObject({ observable: false, coverage: 0, directionEvidence: [] });
    expect(right.sides.RIGHT.thresholds[0].dwellResults.every((d) => d.triggered === null)).toBe(true);
    expect(right.sides.RIGHT.maxUsableGapMs).toBe(3000);
    stressDatasets[0].role = 'CLEAN';
    expect(createTemporalReport([...cleanDatasets, ...stressDatasets]).viableRulesClean).toEqual([]);
  });
  it('requires explicit CLEAN assignment for unfamiliar filenames and exports no per-frame arrays', async () => {
    const data = analyzeTemporal(await temporalFixture(), 'renamed.json');
    expect(data[0].role).toBe('UNASSIGNED'); expect(createTemporalReport(data).viableRulesClean).toEqual([]);
    data[0].role = 'CLEAN';
    const report = createTemporalReport(data, '2026-10-02T00:00:00Z'), json = JSON.stringify(report);
    expect(report.viableRulesClean.length).toBeGreaterThan(0); expect(report.feature).toBe('deltaDyNorm');
    expect(json).not.toMatch(/"(poseFrames|landmarks|worldLandmarks|series|deltaDyNormVelocity)":/);
    expect(report.perDataset[0].stages[0].sides.LEFT.features.normalizedXDisplacement).toBeDefined();
  });
  it.each(['clean인가요.json', '3차검증2.json'])('never infers role from %s and warns when no CLEAN is selected', async (filename) => {
    const datasets = analyzeTemporal(await temporalFixture(), filename);
    expect(datasets[0].role).toBe('UNASSIGNED');
    expect(createTemporalReport(datasets).warnings).toEqual(['No CLEAN dataset selected']);
  });
  it('preserves raw input and is deterministic under a different wall clock or Mirror flag', async () => {
    const session = await temporalFixture(), before = JSON.stringify(session);
    const result = analyzeTemporal(session, 'clean인가요.json');
    expect(JSON.stringify(session)).toBe(before);
    const now = vi.spyOn(performance, 'now').mockImplementation(() => { throw new Error('wall-clock analysis'); });
    try { session.display.mirrorEnabled = !session.display.mirrorEnabled; expect(analyzeTemporal(session, 'clean인가요.json')).toEqual(result); }
    finally { now.mockRestore(); }
  });
});
