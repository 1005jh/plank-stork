import { median, type Limb } from './discoveryFeatures';
import { discoveryStages } from './discoveryStages';
import { latestCalibrationStart, orderedFrames, type CalibrationSelection } from '../replay/landmarkReplay';
import { CALIBRATION_WINDOW_MS } from '../pose/features/poseFeatureAnalysis';
import type { ReplayPoint, ReplayPoseFrame, ReplaySession, ReplayTrial } from '../replay/replayTypes';

export const FLEXION_VISIBILITY = 0.5;
export const MULTI_ROLES = ['UNASSIGNED', 'REFERENCE_OLD_CLEAN', 'REFERENCE_LIVE', 'STRESS'] as const;
export type MultiRole = typeof MULTI_ROLES[number];
export type Channel = 'Y' | 'X' | 'FLEXION';
export type MultiFrame = { timestamp: number } & Record<Limb, Record<Channel, number | null>>;

/** Image-normalized XY angle at the same-side knee. Z/other limb do not gate flexion. */
export function kneeAngle(points: readonly ReplayPoint[], side: Limb): number | null {
  const offset = side === 'LEFT' ? 0 : 1;
  const triple = [23, 25, 27].map((i) => points[i + offset]);
  if (!triple.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) &&
      p.visibility !== null && Number.isFinite(p.visibility) && p.visibility >= FLEXION_VISIBILITY)) return null;
  const [hip, knee, ankle] = triple;
  const a = [hip.x - knee.x, hip.y - knee.y], b = [ankle.x - knee.x, ankle.y - knee.y];
  const divisor = Math.hypot(...a) * Math.hypot(...b);
  if (divisor <= 1e-8) return null;
  return Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / divisor))) * 180 / Math.PI;
}
export function flexionIncrease(neutral: number | null, current: number | null): number | null {
  return neutral === null || current === null ? null : Math.max(0, neutral - current);
}
export function neutralCalibrationWindow(session: ReplaySession, trial: ReplayTrial, selection: CalibrationSelection = 'LATEST_START') {
  const start = latestCalibrationStart(session, trial, selection), frames = orderedFrames(session.poseFrames);
  let selected: ReplayPoseFrame[], startMs: number, endMs: number;
  let source: 'LATEST_CALIBRATION_WINDOW' | 'FIRST_NEUTRAL_COMPATIBILITY';
  if (start) {
    const frozen = session.markers.filter((m) => m.type === 'NEUTRAL_FROZEN' &&
      (m.tMs > start.tMs || m.tMs === start.tMs && m.order > start.order) &&
      (m.tMs < trial.startMs || m.tMs === trial.startMs && m.order < trial.startOrder))
      .sort((a, b) => a.tMs - b.tMs || a.order - b.order)[0];
    if (!frozen) throw new Error('최신 Neutral calibration의 FROZEN marker가 없습니다. 동작 구간으로 baseline을 대체하지 않습니다.');
    source = 'LATEST_CALIBRATION_WINDOW'; endMs = frozen.tMs;
    startMs = Math.max(start.tMs, endMs - CALIBRATION_WINDOW_MS);
    selected = frames.filter((f) => f.tMs > startMs && (f.tMs < endMs || f.tMs === endMs && f.order <= frozen.order));
  } else {
    // Old CLEAN has no setup frames. Mark the reused Neutral as excluded evidence.
    const neutral = discoveryStages(session, trial).stages.find((s) => s.expected === 'NEUTRAL');
    if (!neutral) throw new Error('Flexion baseline을 재구성할 Neutral stage가 없습니다.');
    source = 'FIRST_NEUTRAL_COMPATIBILITY'; startMs = neutral.startMs; endMs = neutral.endMs;
    selected = frames.filter((f) => f.tMs >= startMs && f.tMs < endMs);
  }
  return { source, calibrationStartMs: start?.tMs ?? null, startMs, endMs, frameCount: selected.length, frames: selected,
    excludedStageIndex: source === 'FIRST_NEUTRAL_COMPATIBILITY' ? 0 : null };
}
export type AnalysisNeutralWindow = Omit<ReturnType<typeof neutralCalibrationWindow>, 'source'> & { source: ReturnType<typeof neutralCalibrationWindow>['source'] | 'ESTIMATOR_NEUTRAL_REFERENCE' };
export function flexionBaseline(session: ReplaySession, trial: ReplayTrial, selection: CalibrationSelection = 'LATEST_START', analysisWindow?: AnalysisNeutralWindow) {
  const { frames, ...window } = analysisWindow ?? neutralCalibrationWindow(session, trial, selection);
  const values = (side: Limb) => frames.map((f) => kneeAngle(f.landmarks, side)).filter((n): n is number => n !== null);
  const left = values('LEFT'), right = values('RIGHT');
  return { ...window, LEFT: { neutralAngle: median(left), usableFrames: left.length }, RIGHT: { neutralAngle: median(right), usableFrames: right.length } };
}
