import type { DetectorTestExpected, DetectorTestSummary, KneeKickDirection, KneeKickEvent, KneeKickState } from '@plank-stork/protocol';
import { finite } from '../motion/kneeMotionFeatures';
import { robustStats } from '../motion/kneeMotionAnalyzer';
import type { KneeKickBaseline } from './kneeKickDetector';
import { KICK_ENTER_DISPLACEMENT, KICK_EXIT_DISPLACEMENT, RETURN_DWELL_MS, KICK_HIP_VISIBILITY, KICK_KNEE_VISIBILITY, KICK_STALE_MS } from './kneeKickDetector';
import type { DetectorTestStage } from './guidedDetectorTest';

/** Controller-local derived numbers only. Never holds a PoseFrame or landmark arrays. */
export interface KickDetectorDiagnosticFrame {
  timestamp: number;
  stageIndex: number;
  expected: DetectorTestExpected;
  poseFresh: boolean;
  usableLeft: boolean;
  usableRight: boolean;
  stateBefore: KneeKickState;
  stateAfter: KneeKickState;
  hipCenterX: number | null;
  hipWidth: number | null;
  leftKneeVisibility: number | null;
  rightKneeVisibility: number | null;
  normalizedLeft: number | null;
  normalizedRight: number | null;
  dominantNormalizedDisplacement: number | null;
  normalizedLeftVelocity: number | null;
  normalizedRightVelocity: number | null;
  event: KneeKickEvent | null;
}
export type KickDiagnosticInput = Omit<KickDetectorDiagnosticFrame, 'stageIndex' | 'expected'>;

export interface NeutralKickDiagnosticSample {
  hipCenterX: number | null;
  leftKneeVisibility: number | null;
  rightKneeVisibility: number | null;
}
export interface NeutralKickDiagnostics {
  hipCenterX: { sampleCount: number; median: number | null; p10: number | null; p90: number | null };
  leftKneeVisibility: { sampleCount: number; median: number | null };
  rightKneeVisibility: { sampleCount: number; median: number | null };
}

export interface KickDiagnosticMetadata {
  createdAt: string;
  startedAt: number;
  baseline: { detector: KneeKickBaseline | null; diagnostics: NeutralKickDiagnostics | null };
  testStart: { detectorState: KneeKickState; ready: boolean; valid: boolean };
}
export interface KickStageDiagnostics {
  stageIndex: number;
  expected: DetectorTestExpected;
  /** First observed inference in this stage; null if no frames arrived. */
  firstFrameTimestamp: number | null;
  stateAtStageStart: KneeKickState | null;
  stateFrameCounts: Record<KneeKickState, number>;
  stateAfterFrameCounts: Record<KneeKickState, number>;
  totalFrames: number;
  freshFrames: number;
  staleFrames: number;
  leftUsableFrames: number;
  rightUsableFrames: number;
  bothUsableFrames: number;
  maxAbsDominantDisplacement: number | null;
  signedDominantAtMax: number | null;
  maxAbsLeftDisplacement: number | null;
  maxAbsRightDisplacement: number | null;
  framesAboveEnter: number;
  armedFramesAboveEnter: number;
  maxAbsDominantWhileArmed: number | null;
  enterMargin: number | null;
  armedEnterMargin: number | null;
  peakAbsLeftVelocity: number | null;
  peakAbsRightVelocity: number | null;
  medianLeftKneeVisibility: number | null;
  medianRightKneeVisibility: number | null;
  minLeftKneeVisibility: number | null;
  minRightKneeVisibility: number | null;
  medianHipCenterX: number | null;
  minHipCenterX: number | null;
  maxHipCenterX: number | null;
  medianHipWidth: number | null;
  eventCount: number;
  eventDirections: KneeKickDirection[];
  wrongEventCount: number;
  duplicateCount: number;
}
export interface KickDiagnosticDataset extends KickDiagnosticMetadata {
  version: 1;
  detectorConfig: ReturnType<typeof diagnosticConfig>;
  sequence: { expected: DetectorTestExpected; durationMs: number }[];
  frames: KickDetectorDiagnosticFrame[];
  stageSummaries: KickStageDiagnostics[];
  existingGuidedSummary: DetectorTestSummary;
}

export function diagnosticConfig() {
  return { enterDisplacement: KICK_ENTER_DISPLACEMENT, exitDisplacement: KICK_EXIT_DISPLACEMENT, returnDwellMs: RETURN_DWELL_MS,
    hipVisibility: KICK_HIP_VISIBILITY, kneeVisibility: KICK_KNEE_VISIBILITY, staleMs: KICK_STALE_MS };
}
export function summarizeNeutralDiagnostics(samples: readonly NeutralKickDiagnosticSample[]): NeutralKickDiagnostics {
  const hip = robustStats(samples.map((sample) => sample.hipCenterX));
  const left = robustStats(samples.map((sample) => sample.leftKneeVisibility));
  const right = robustStats(samples.map((sample) => sample.rightKneeVisibility));
  return {
    hipCenterX: { sampleCount: hip.sampleCount, median: hip.median, p10: hip.p10, p90: hip.p90 },
    leftKneeVisibility: { sampleCount: left.sampleCount, median: left.median },
    rightKneeVisibility: { sampleCount: right.sampleCount, median: right.median },
  };
}

const emptyStates = (): Record<KneeKickState, number> => ({ NOT_READY: 0, ARMED: 0, TRIGGERED_LEFT: 0, TRIGGERED_RIGHT: 0, WAIT_RETURN: 0 });
const peak = (values: readonly (number | null)[]) => {
  const present = values.filter(finite);
  return present.length ? Math.max(...present.map(Math.abs)) : null;
};

/** Observations only: no diagnosis, threshold selection, or feedback into the detector. */
export function summarizeKickDiagnostics(frames: readonly KickDetectorDiagnosticFrame[], stages: readonly DetectorTestStage[]): KickStageDiagnostics[] {
  return stages.map((stage, stageIndex) => {
    const rows = frames.filter((frame) => frame.stageIndex === stageIndex);
    const values = (key: 'hipCenterX' | 'hipWidth' | 'leftKneeVisibility' | 'rightKneeVisibility') => rows.map((row) => row[key]).filter(finite);
    const stateFrameCounts = emptyStates(), stateAfterFrameCounts = emptyStates();
    for (const row of rows) { stateFrameCounts[row.stateBefore] += 1; stateAfterFrameCounts[row.stateAfter] += 1; }
    const dominant = rows.map((row) => row.dominantNormalizedDisplacement).filter(finite);
    // Preserve the first signed value at an equal absolute peak.
    const signedDominantAtMax = dominant.reduce<number | null>((best, value) => best === null || Math.abs(value) > Math.abs(best) ? value : best, null);
    const maxAbsDominantDisplacement = signedDominantAtMax === null ? null : Math.abs(signedDominantAtMax);
    const armed = rows.filter((row) => row.stateBefore === 'ARMED');
    const aboveEnter = (row: KickDetectorDiagnosticFrame) => finite(row.dominantNormalizedDisplacement) && Math.abs(row.dominantNormalizedDisplacement) >= KICK_ENTER_DISPLACEMENT;
    const maxAbsDominantWhileArmed = peak(armed.map((row) => row.dominantNormalizedDisplacement));
    const leftVisibility = values('leftKneeVisibility'), rightVisibility = values('rightKneeVisibility'), hip = values('hipCenterX');
    return {
      stageIndex, expected: stage.expected, firstFrameTimestamp: rows[0]?.timestamp ?? null, stateAtStageStart: rows[0]?.stateBefore ?? null,
      stateFrameCounts, stateAfterFrameCounts,
      totalFrames: rows.length, freshFrames: rows.filter((row) => row.poseFresh).length, staleFrames: rows.filter((row) => !row.poseFresh).length,
      leftUsableFrames: rows.filter((row) => row.usableLeft).length, rightUsableFrames: rows.filter((row) => row.usableRight).length,
      bothUsableFrames: rows.filter((row) => row.usableLeft && row.usableRight).length,
      maxAbsDominantDisplacement, signedDominantAtMax,
      maxAbsLeftDisplacement: peak(rows.map((row) => row.normalizedLeft)), maxAbsRightDisplacement: peak(rows.map((row) => row.normalizedRight)),
      framesAboveEnter: rows.filter(aboveEnter).length, armedFramesAboveEnter: armed.filter(aboveEnter).length, maxAbsDominantWhileArmed,
      enterMargin: maxAbsDominantDisplacement === null ? null : maxAbsDominantDisplacement - KICK_ENTER_DISPLACEMENT,
      armedEnterMargin: maxAbsDominantWhileArmed === null ? null : maxAbsDominantWhileArmed - KICK_ENTER_DISPLACEMENT,
      peakAbsLeftVelocity: peak(rows.map((row) => row.normalizedLeftVelocity)), peakAbsRightVelocity: peak(rows.map((row) => row.normalizedRightVelocity)),
      medianLeftKneeVisibility: robustStats(leftVisibility).median, medianRightKneeVisibility: robustStats(rightVisibility).median,
      minLeftKneeVisibility: leftVisibility.length ? Math.min(...leftVisibility) : null, minRightKneeVisibility: rightVisibility.length ? Math.min(...rightVisibility) : null,
      medianHipCenterX: robustStats(hip).median, minHipCenterX: hip.length ? Math.min(...hip) : null, maxHipCenterX: hip.length ? Math.max(...hip) : null,
      medianHipWidth: robustStats(values('hipWidth')).median,
      eventCount: stage.events.length, eventDirections: stage.events.map((event) => event.direction),
      wrongEventCount: stage.wrongEventCount, duplicateCount: stage.duplicateCount,
    };
  });
}
