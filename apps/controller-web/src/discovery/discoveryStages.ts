import { DETECTOR_TEST_SEQUENCE } from '../pose/kick/guidedDetectorTest';
import type { ReplaySession, ReplayTrial } from '../replay/replayTypes';

export type DiscoveryLabel = 'NEUTRAL' | 'TWIST_LEFT' | 'TWIST_RIGHT' | 'KNEE_LEFT' | 'KNEE_RIGHT';
export interface DiscoveryStage { stageIndex: number; expected: DiscoveryLabel; startMs: number; endMs: number }

/** Stage time, not detector events/readiness, is the experimental label. Boundaries are [start, end). */
export function discoveryStages(session: ReplaySession, trial: ReplayTrial) {
  const markers = session.markers.filter((m) => m.trialId === trial.id);
  const changes = markers.filter((m) => m.type === 'GUIDED_STAGE_CHANGE').sort((a, b) => a.tMs - b.tMs || a.order - b.order);
  const stops = markers.filter((m) => m.type === 'GUIDED_TEST_COMPLETE' || m.type === 'GUIDED_TEST_STOP').map((m) => m.tMs);
  const end = Math.min(session.timing.durationMs, trial.endMs ?? session.timing.durationMs, ...stops);
  const warnings: string[] = [];
  const source = changes.length ? 'GUIDED_STAGE_CHANGE' : 'FIXED_SEQUENCE_FALLBACK';
  if (!changes.length) {
    warnings.push('GUIDED_STAGE_CHANGE 없음: trial start + 기존 22초 Guided sequence로 label을 추정했습니다.');
    let start = trial.startMs;
    for (const [stageIndex, stage] of DETECTOR_TEST_SEQUENCE.entries()) {
      if (start < end) changes.push({ type: 'GUIDED_STAGE_CHANGE', tMs: start, order: 0, trialId: trial.id, stageIndex, expected: stage.expected });
      start += stage.durationMs;
    }
  }
  const stages: DiscoveryStage[] = changes.map((marker, index) => {
    const plan = DETECTOR_TEST_SEQUENCE[index];
    if (!plan || marker.stageIndex !== index || marker.expected !== plan.expected ||
        marker.tMs < trial.startMs || (index === 0 && marker.tMs !== trial.startMs) ||
        (index > 0 && marker.tMs <= changes[index - 1].tMs)) {
      throw new Error(`Trial ${trial.id}: Guided stage marker 순서/label이 잘못되었거나 누락되었습니다.`);
    }
    return { stageIndex: index, expected: plan.expected, startMs: marker.tMs,
      endMs: Math.max(marker.tMs, Math.min(end, changes[index + 1]?.tMs ?? marker.tMs + plan.durationMs)) };
  });
  return { stages, source, warnings };
}
export function stageForTime(stages: readonly DiscoveryStage[], tMs: number) {
  return stages.find((stage) => tMs >= stage.startMs && tMs < stage.endMs) ?? null;
}
