// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fullV3Trial } from '../replay/testFixtures';
import { frameSequence } from '../estimator/estimatorInference';
import { analyzeProvisionalRun, createProvisionalReport, sensitivityClass, type ProvisionalAnalysis } from './provisionalReport';
import { PROVISIONAL_PAIRS, PROVISIONAL_PROVENANCE, PROVISIONAL_VARIANTS, provisionalConfig } from './provisionalContract';
import type { ProvisionalRun } from './provisionalInference';
import { FORENSIC_RULES } from '../forensic/forensicRules';
import { Y_KICK_V3_CONFIG } from '../pose/kick/kneeKickDetectorV3';
import { FIXED_FLEXION_CONFIG, PRE_REGISTERED_INTEGRITY_CONFIG } from '../discovery/integrityGuard';
let base: ProvisionalAnalysis;
const keys = ['segmentExtremeCount', 'worldSegmentExtremeCount', 'positiveSwapCount', 'largeSwapCount', 'poseMissingCount', 'jointMissingCount'] as const;
beforeAll(async () => {
  const session = (await fullV3Trial()).session!, pair = PROVISIONAL_PAIRS[2]; session.captureId = pair.captureId;
  const run: ProvisionalRun = { ...PROVISIONAL_PROVENANCE, mediaIdentity: { ...pair, selectedFilename: pair.webmFilename, limitation: '' }, mediaId: pair.webmSha256,
    variant: 'FULL_VIDEO_CONTROL', config: provisionalConfig('FULL_VIDEO_CONTROL'), sequence: await frameSequence(session.poseFrames.map((f) => f.tMs)),
    frames: session.poseFrames.map((f) => ({ ...structuredClone(f), posePresent: f.landmarks.length > 0, inferenceMs: 10 })),
    frameSequenceParity: true, cacheReuse: { reused: true, rejection: null }, clock: 'decoded media PTS * 1000 = existing VIDEO replay capture tMs mapping' };
  const input = { session, filename: 'synthetic.json', role: 'REFERENCE_LIVE_1' as const }, before = JSON.stringify(session);
  base = analyzeProvisionalRun(input, run);
  const altered = structuredClone(run); altered.variant = 'FULL_IMAGE'; altered.config = provisionalConfig('FULL_IMAGE');
  altered.frames.forEach((f) => f.landmarks.forEach((p) => { p.x *= 2; p.y *= 2; p.z *= 2; }));
  const other = analyzeProvisionalRun(input, altered);
  expect(base.trials[0].baseline.window).toEqual(other.trials[0].baseline.window);
  expect(other.trials[0].baseline.y!.bodyScale).toBeCloseTo(base.trials[0].baseline.y!.bodyScale * 2);
  expect(JSON.stringify(session)).toBe(before);
});
function complete() {
  return PROVISIONAL_PAIRS.flatMap((pair) => PROVISIONAL_VARIANTS.map((variant) => {
    const a = structuredClone(base); a.variant = variant; a.config = provisionalConfig(variant);
    a.input = { ...a.input, role: pair.role as typeof a.input.role, captureId: pair.captureId }; a.mediaIdentity = { ...a.mediaIdentity, ...pair };
    return a;
  }));
}
function comparisons() {
  const all = complete();
  for (const a of all) for (const t of a.trials) {
    t.knownFalseGeometry = structuredClone(t.geometry);
    for (const k of keys) t.knownFalseGeometry[k] = 10;
    for (const mode of ['PRODUCTION_Y_V3', 'FIXED_REFERENCE'] as const) if (['REFERENCE_LIVE_2', 'REFERENCE_LIVE_3'].includes(a.input.role)) t.detectors[mode]!.falseEvents = 2;
  }
  return all;
}
function improve(all: ProvisionalAnalysis[], variant: 'FULL_IMAGE' | 'HEAVY_VIDEO', events = true, geometry = true) {
  for (const a of all.filter((a) => a.variant === variant && ['REFERENCE_LIVE_2', 'REFERENCE_LIVE_3'].includes(a.input.role))) for (const t of a.trials) {
    if (geometry) { t.knownFalseGeometry.segmentExtremeCount = 5; t.knownFalseGeometry.worldSegmentExtremeCount = 5; }
    if (events) for (const mode of ['PRODUCTION_Y_V3', 'FIXED_REFERENCE'] as const) t.detectors[mode]!.falseEvents = 0;
  }
}
describe('provisional provenance, report determinism, and fixed configs', () => {
  it('is deterministic, explicitly non-decisional, and excludes stronger result labels', () => {
    const all = complete(), a = createProvisionalReport(all, 'fixed'); expect(a).toEqual(createProvisionalReport(all, 'fixed'));
    expect(a).toMatchObject(PROVISIONAL_PROVENANCE); expect(a.frameParity.every((p) => p.identical)).toBe(true); expect(a.detectorMatrix).toHaveLength(30);
    expect(a.limitation).toContain('cannot establish estimator superiority'); expect(a.classification).toBe('NO_MATERIAL_DIFFERENCE');
    const text = JSON.stringify(a); for (const forbidden of ['TRACE_VERIFIED', 'EXACT_IDENTITY', 'INDEPENDENT_HOLDOUT', 'PRODUCTION_READY', 'CANDIDATE']) expect(text).not.toContain(forbidden);
  });
  it('requires all fifteen analyses and valid baselines', () => {
    expect(createProvisionalReport([base], 'fixed').classification).toBe('INSUFFICIENT');
    const all = complete(); all[0].trials[0].detectors.PRODUCTION_Y_V3 = null;
    expect(createProvisionalReport(all, 'fixed').classification).toBe('INSUFFICIENT');
  });
  it('refuses missing provenance, duplicates and shifted frame sequences', () => {
    const all = complete(); expect(() => createProvisionalReport([...all, all[0]], 'fixed')).toThrow('Duplicate');
    all[1].sequence.timestampHash = 'wrong'; expect(() => createProvisionalReport(all, 'fixed')).toThrow('INVALID_FRAME_SEQUENCE');
    const missing = complete(); delete (missing[0] as unknown as Record<string, unknown>).PAIRING_STATUS;
    expect(() => createProvisionalReport(missing, 'fixed')).toThrow('provenance');
  });
  it('reports offline pooled timing and fixed detector configs without mutation', () => {
    const before = JSON.stringify({ Y_KICK_V3_CONFIG, PRE_REGISTERED_INTEGRITY_CONFIG, FIXED_FLEXION_CONFIG, FORENSIC_RULES });
    const report = createProvisionalReport(complete(), 'fixed');
    expect(report.performance.every((p) => p.medianMs === 10 && p.p95Ms === 10 && p.maxMs === 10 && p.estimatedSustainableFps === 100)).toBe(true);
    expect(report.detectorConfigs.PRODUCTION_Y_V3).toEqual(Y_KICK_V3_CONFIG); expect(report.detectorConfigs.FIXED_REFERENCE.integrity.velocity).toBe(12);
    expect(JSON.stringify({ Y_KICK_V3_CONFIG, PRE_REGISTERED_INTEGRITY_CONFIG, FIXED_FLEXION_CONFIG, FORENSIC_RULES })).toBe(before);
    expect(FORENSIC_RULES).toMatchObject({ timestampToleranceMs: 20, offsetMs: 0, minMatchedCoverage: .8, maxMedianPoseError: .05, maxP95PoseError: .12, minMedianTrajectoryCorrelation: .9, minMedianDeltaCorrelation: .6 });
  });
  it('has no import from production/live/general replay to the provisional entry', async () => {
    for (const file of ['../components/PoseCamera.tsx', '../replay/replayVideoSource.ts', '../components/ReplayRunner.tsx']) {
      const text = await readFile(new URL(file, import.meta.url), 'utf8'); expect(text).not.toContain('provisional');
    }
  });
});
describe('descriptive sensitivity with no parameter optimization', () => {
  it.each(['FULL_IMAGE', 'HEAVY_VIDEO'] as const)('%s combined improvement triggers only new validation', (variant) => {
    const all = comparisons(); improve(all, variant); const report = createProvisionalReport(all, 'fixed');
    expect(report.classification).toBe(variant === 'FULL_IMAGE' ? 'FULL_IMAGE_BETTER' : 'HEAVY_VIDEO_BETTER'); expect(report.nextValidationWorthy).toBe(true);
    expect(report.comparisons.find((c) => c.variant === variant)!.modes.every((m) => m.difference === 'MATERIAL_EVENT_AND_GEOMETRY_IMPROVEMENT')).toBe(true);
  });
  it('can report both better without promoting either to a production decision', () => {
    const all = comparisons(); improve(all, 'FULL_IMAGE'); improve(all, 'HEAVY_VIDEO'); expect(createProvisionalReport(all, 'fixed').classification).toBe('BOTH_BETTER');
  });
  it.each([{ events: true, geometry: false, expected: 'EVENT_ONLY_DIFFERENCE' }, { events: false, geometry: true, expected: 'GEOMETRY_ONLY_DIFFERENCE' }])('separates $expected', ({ events, geometry, expected }) => {
    const all = comparisons(); improve(all, 'FULL_IMAGE', events, geometry); const report = createProvisionalReport(all, 'fixed');
    expect(report.comparisons[0].modes[0].difference).toBe(expected); expect(report.nextValidationWorthy).toBe(false);
  });
  it('does not mistake more missing geometry for improvement', () => {
    const all = comparisons(); improve(all, 'FULL_IMAGE'); const a = all.find((a) => a.variant === 'FULL_IMAGE' && a.input.role === 'REFERENCE_LIVE_2')!;
    a.trials[0].knownFalseGeometry.poseMissingCount++;
    expect(createProvisionalReport(all, 'fixed').nextValidationWorthy).toBe(false);
    a.trials[0].knownFalseGeometry.poseMissingCount--;
    a.trials[0].knownFalseGeometry.distributions['image.leftHipKneeRatio'].usable = 0;
    expect(createProvisionalReport(all, 'fixed').nextValidationWorthy).toBe(false);
  });
  it('lost recall in either detector prevents a trigger even if another detector improves', () => {
    const all = comparisons(); improve(all, 'FULL_IMAGE'); const a = all.find((a) => a.variant === 'FULL_IMAGE' && a.input.role === 'REFERENCE_LIVE_1')!;
    const d = a.trials[0].detectors.PRODUCTION_Y_V3!; d.stages.filter((s) => s.expected === 'KNEE_RIGHT').forEach((s) => { s.correct = 0; }); d.right = 0;
    expect(createProvisionalReport(all, 'fixed').nextValidationWorthy).toBe(false);
  });
  it('reports worse for two adverse variants and mixed for opposing effects', () => {
    const evidence = { available: true, material: false, adverseEvents: true, same: false, worse: true };
    expect(sensitivityClass(evidence, evidence)).toBe('WORSE');
    expect(sensitivityClass({ ...evidence, material: true, adverseEvents: false, worse: false }, evidence)).toBe('MIXED');
  });
});
