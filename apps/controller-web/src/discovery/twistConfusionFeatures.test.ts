// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fullV3Trial } from '../replay/testFixtures';
import { extractPoseFeatures } from '../pose/features/extractPoseFeatures';
import { calibratePoseFeatures } from '../pose/features/calibratePoseFeatures';
import { neutralMovementScore } from '../pose/actions/poseActionClassifier';
import { bilateralValues, circularMeanDeg, shortestAngleDeg, pelvisAxisDeg, prepareTwistInputs, candidateRelative } from './twistConfusionFeatures';
import { createTwistConfusionEvidence, temporalRelation, twistTracesCsv } from './analyzeTwistConfusion';

describe('STEP4L measured features and frozen calibration', () => {
  it('reuses raw/calibrated definitions and hip-only RMS without classifier prototypes or smoothing', async () => {
    const session = (await fullV3Trial()).session!;
    const recorded = session.poseFrames.find((f) => f.tMs > 2000)!;
    recorded.worldLandmarks[23].z = .16;
    const [f] = prepareTwistInputs([{ filename: 'x.json', role: 'REFERENCE_LIVE_1', session }]);
    const row = f.frames.find((r) => r.timestamp === recorded.tMs)!, raw = extractPoseFeatures(recorded.landmarks, recorded.worldLandmarks);
    const calibrated = calibratePoseFeatures(raw, f.twistBaseline.neutral);
    expect(row.twist).toMatchObject(calibrated); expect(row.twist.normalizedHipDepthDifference).toBeCloseTo(2);
    expect(row.twist.hipMotionScore).toBeCloseTo(neutralMovementScore(calibrated)!);
    expect(f.frames.find((r) => r.timestamp > recorded.tMs)!.twist.normalizedHipDepthDifference).toBe(0);
    expect(row.twist.hipWidth).toBeCloseTo(.2); expect(row.twist.hipWidthRatio).toBeCloseTo(1);
  });
  it('handles circular wrap-around, ambiguous circular baselines and degenerate/missing axes', () => {
    expect(Math.abs(circularMeanDeg([179, -179])!)).toBeCloseTo(180);
    expect(shortestAngleDeg(-179, 179)).toBe(2); expect(shortestAngleDeg(179, -179)).toBe(-2);
    expect(circularMeanDeg([0, 180])).toBeNull(); expect(circularMeanDeg([])).toBeNull();
    expect(shortestAngleDeg(null, 1)).toBeNull(); expect(pelvisAxisDeg([])).toBeNull();
  });
  it('never replaces missing/zero denominators with fake symmetry, dominance or Infinity', () => {
    expect(bilateralValues(.6, .3)).toEqual({ max: .6, min: .3, dominanceAbs: .3, symmetryRatio: .5 });
    expect(bilateralValues(null, .5)).toEqual({ max: null, min: null, dominanceAbs: null, symmetryRatio: null });
    expect(bilateralValues(0, 0).symmetryRatio).toBeNull();
  });
  it('masks missing world depth and low-visibility hips without hiding valid other-side Y', async () => {
    const session = (await fullV3Trial()).session!;
    const r = session.poseFrames.find((f) => f.tMs > 2000)!;
    r.worldLandmarks = [];
    const [f] = prepareTwistInputs([{ filename: 'x.json', role: 'REFERENCE_LIVE_1', session }]);
    const row = f.frames.find((f) => f.timestamp === r.tMs)!;
    expect(row.twist).toMatchObject({ deltaHipDepthDifference: null, normalizedHipDepthDifference: null, hipMotionScore: null });
    expect(row.twist.leftY).not.toBeNull(); expect(row.twist.deltaHipCenterX).toBe(0);
    const missing = f.frames.find((r) => r.LEFT.Y === null && r.RIGHT.Y === null)!;
    expect(missing.twist.ySymmetryRatio).toBeNull(); expect(missing.twist.hipMotionScore).toBeNull();
    expect(candidateRelative(missing.twist, 'LEFT').candidateToOpponentFlexionRatio).toBeNull();
    expect(candidateRelative(f.frames[0].twist, 'LEFT').candidateToOpponentYRatio).toBeNull();
  });
  it('uses latest frozen calibration for every role, and legacy first Neutral is excluded', async () => {
    const session = (await fullV3Trial()).session!;
    session.markers.push({ type: 'NEUTRAL_CALIBRATION_START', tMs: 1150, order: 999 });
    const [f] = prepareTwistInputs([{ filename: 'latest.json', role: 'REFERENCE_LIVE_1', session }]);
    expect(f.twistBaseline.calibrationStartMs).toBe(100);
    expect(f.twistBaseline.reconstruction?.neutralBaselineEqual).toBe(true);
    delete session.detectorMode; delete session.liveResult.trials[0].baselineV3;
    session.markers = session.markers.filter((m) => !['NEUTRAL_CALIBRATION_START', 'NEUTRAL_FROZEN'].includes(m.type));
    session.markers.push({ type: 'NEUTRAL_CALIBRATION_START', tMs: session.liveResult.trials[0].endMs! + 1, order: 99999 });
    const [old] = prepareTwistInputs([{ filename: 'old.json', role: 'REFERENCE_OLD_CLEAN', session }]);
    const evidence = createTwistConfusionEvidence([old]);
    expect(old.twistBaseline.source).toBe('FIRST_NEUTRAL_COMPATIBILITY');
    expect(evidence.twistConfusionEvidence.perFixture[0].perStage[0]).toMatchObject({ calibrationOnly: true,
      features: { hipMotionScore: { frames: 0, usable: 0, median: null } } });
    const baseline = structuredClone(old.twistBaseline);
    old.frames.forEach((r) => { r.twist.deltaHipCenterX = 99; }); expect(old.twistBaseline).toEqual(baseline);
  });
  it('keeps missing candidate-side relations null and uses observed ±750ms windows with exact temporal anchors', async () => {
    const session = (await fullV3Trial()).session!;
    const [f] = prepareTwistInputs([{ filename: 'capture.json', role: 'REFERENCE_LIVE_3_HOLDOUT', session }]);
    const e = createTwistConfusionEvidence([f]), trace = e.twistConfusionEvidence.perFixture[0].eventTraces[0];
    expect(trace.endMs - trace.startMs).toBe(1500);
    expect(trace.rows.every((r) => r.timestamp >= trace.startMs && r.timestamp <= trace.endMs)).toBe(true);
    expect(trace.rows.some((r) => r.relativeToCandidateStartMs === 0)).toBe(true);
    const rows = f.frames.slice(0, 3).map((r, i) => ({ ...r, timestamp: [0, 50, 100][i], twist: { ...r.twist, hipMotionScore: [3, 1, 2][i] } }));
    expect(temporalRelation(rows, 'hipMotionScore', 50, 100)).toMatchObject({ twistFeaturePeakAt: 0, twistFeatureAtCandidateStart: 1,
      twistFeatureAtConfirm: 2, peakOffsetFromCandidateMs: -50, peakRelation: 'BEFORE_ENTRY', peakAtWindowEdge: true });
    const csv = twistTracesCsv(e); expect(csv).toContain('candidateToOpponentYRatio'); expect(csv).toContain('POST_FAILURE_EXPLORATORY');
    expect(e.twistConfusionEvidence.perFixture[0].perLabel.find((l) => l.label === 'KNEE')!.features.hipMotionScore).toHaveProperty('p95');
  });
});
