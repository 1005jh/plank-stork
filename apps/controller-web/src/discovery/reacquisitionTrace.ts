import { analyzeShadowConfig } from './analyzeShadow';
import type { PreparedTemporalDataset, TemporalDataset } from './analyzeTemporal';
import { LIMBS, median, type Limb } from './discoveryFeatures';
import { stageForTime } from './discoveryStages';
import { gateFrame, ReacquisitionGate, type LossEpisode } from './reacquisitionGate';
import type { EvidencePair } from './temporalEvidence';
import { DEFAULT_SHADOW_CONFIG } from './yKickShadowDetector';

export const CLEAR_THRESHOLDS = [0.15, 0.2, 0.25, 0.3] as const;
export const CLEAR_DWELLS = [50, 100, 150, 180, 200, 300] as const;
const evidence = (frame: EvidencePair, side: Limb) => frame[side].usable ? frame[side].absY : null;
export function clearAvailability(frames: readonly EvidencePair[], side: Limb, reacquiredAt: number, stageEndMs: number, threshold: number, dwellMs: number) {
  let run: number | null = null, previous: number | null = null, firstClearStartMs: number | null = null;
  let firstClearSatisfiedMs: number | null = null, satisfiedRunStartMs: number | null = null;
  for (const frame of frames) {
    if (frame.timestamp < reacquiredAt || frame.timestamp >= stageEndMs) continue;
    const y = evidence(frame, side);
    if (previous !== null && frame.timestamp - previous >= 400) run = null;
    if (y === null || y >= threshold) run = null;
    else {
      run ??= frame.timestamp; firstClearStartMs ??= run;
      if (frame.timestamp - run >= dwellMs) { firstClearSatisfiedMs = frame.timestamp; satisfiedRunStartMs = run; break; }
    }
    previous = frame.timestamp;
  }
  return { threshold, dwellMs, firstClearStartMs, firstClearSatisfiedMs, satisfiedRunStartMs,
    timeToClearMs: firstClearSatisfiedMs === null ? null : firstClearSatisfiedMs - reacquiredAt,
    status: firstClearSatisfiedMs !== null ? 'CLEAR_SATISFIED' : firstClearStartMs === null ? 'NO_CLEAR_OBSERVED' : 'CLEAR_DWELL_NOT_SATISFIED' };
}
export function physicalContinuity(prepared: PreparedTemporalDataset) {
  const gate = new ReacquisitionGate({ lossMinMs: 0, strategy: 'FIXED_SETTLE', settleMs: 0, clearThreshold: null, clearDwellMs: 0 });
  for (const frame of prepared.frames) gate.processFrame(gateFrame(frame));
  return gate.result();
}
export function eventTracking(episodes: readonly LossEpisode[], frames: readonly EvidencePair[], side: Limb, candidateStartedAt: number, sideEvidenceStartedAt = candidateStartedAt) {
  const episode = [...episodes].reverse().find((e) => e.side === side && e.reacquiredAt <= sideEvidenceStartedAt);
  const startedAt = episode?.reacquiredAt ?? frames.find((f) => f[side].usable)?.timestamp ?? null;
  return { source: episode ? 'POST_REACQUISITION' as const : 'NORMAL_TRACKING' as const,
    candidateStartedTrackingAgeMs: startedAt === null ? null : candidateStartedAt - startedAt,
    sideEvidenceStartedAt, sideEvidenceStartedTrackingAgeMs: startedAt === null ? null : sideEvidenceStartedAt - startedAt,
    reacquiredAt: episode?.reacquiredAt ?? null };
}
/** Ungated FIRST_DWELL and INTEGRATED_WINDOW traces, computed before any gate sweep. */
export function falseReacquisitionTraces(prepared: readonly PreparedTemporalDataset[], temporal: readonly TemporalDataset[]) {
  const traces = [];
  for (const directionStrategy of ['FIRST_DWELL', 'INTEGRATED_WINDOW'] as const) {
    const baseline = analyzeShadowConfig(prepared, temporal, { ...DEFAULT_SHADOW_CONFIG, directionStrategy });
    for (const dataset of baseline.stress.datasets) {
      const source = prepared.find((d) => d.input === dataset.input)!;
      const continuity = physicalContinuity(source);
      for (const event of dataset.events.filter((e) => e.falseEvent || e.wrongDirection)) {
        const sideStartedAt = (event.side === 'LEFT' ? event.leftRunStartedAt ?? event.leftEligibleAt : event.rightRunStartedAt ?? event.rightEligibleAt) ?? event.candidateStartedAt;
        const episode = [...continuity.episodes].reverse().find((e) => e.side === event.side && e.reacquiredAt <= sideStartedAt);
        if (!episode) continue;
        const at = source.frames.find((f) => f.timestamp === episode.reacquiredAt)!;
        const stage = stageForTime(source.stages, episode.reacquiredAt)!;
        const after = source.frames.filter((f) => f.timestamp >= episode.reacquiredAt && f.timestamp < stage.endMs);
        const firstInterruption = after.findIndex((f, i) => evidence(f, event.side) === null ||
          (i > 0 && f.timestamp - after[i - 1].timestamp >= 400));
        const continuous = firstInterruption < 0 ? after : after.slice(0, firstInterruption);
        const allAboveEnter = continuous.length > 0 && continuous.every((f) => evidence(f, event.side)! >= DEFAULT_SHADOW_CONFIG.enter);
        const windows = [50, 100, 200, 300, 500, 1000].map((afterMs) => {
          const end = Math.min(episode.reacquiredAt + afterMs, stage.endMs);
          const cumulative = source.frames.filter((f) => f.timestamp >= episode.reacquiredAt && f.timestamp <= end && f.timestamp < stage.endMs);
          const sideStats = (side: Limb) => {
            const values = cumulative.map((f) => evidence(f, side)).filter((v): v is number => v !== null);
            const local = cumulative.filter((f) => f.timestamp > episode.reacquiredAt + afterMs - 50)
              .map((f) => evidence(f, side)).filter((v): v is number => v !== null);
            return { usableCount: values.length, observedCount: cumulative.length, peak: values.length ? Math.max(...values) : null,
              cumulativeMedianAbsY: median(values), trailing50msMedianAbsY: median(local), trailing50msUsableCount: local.length };
          };
          return { afterMs, observedThroughMs: end, stageTruncated: end < episode.reacquiredAt + afterMs, LEFT: sideStats('LEFT'), RIGHT: sideStats('RIGHT') };
        });
        traces.push({ input: dataset.input, directionStrategy, expected: event.expected, stageIndex: event.stageIndex, stageEndMs: stage.endMs,
          ...episode, falseCandidateStartedAt: event.candidateStartedAt, falseCandidateTriggeredAt: event.timestamp,
          reacquireToCandidateMs: event.candidateStartedAt - episode.reacquiredAt, reacquireToTriggerMs: event.timestamp - episode.reacquiredAt,
          candidate: { ...event, ...eventTracking(continuity.episodes, source.frames, event.side, event.candidateStartedAt, sideStartedAt) },
          driftDiagnostic: { continuousUsableThroughMs: continuous.at(-1)?.timestamp ?? null,
            continuousUsableDurationMs: continuous.length ? continuous.at(-1)!.timestamp - episode.reacquiredAt : null,
            nextContinuityLossAt: firstInterruption < 0 ? null : after[firstInterruption].timestamp,
            allObservedBeforeNextLossAboveEnter: allAboveEnter,
            interpretation: allAboveEnter ? 'NO_DECAY_BELOW_ENTER_OBSERVED: fixed settle alone cannot certify neutral recovery; later missing samples cannot establish persistent offset or decay. Compare clear gate; no rebaseline.'
              : 'Use cumulative and trailing medians with usable counts; missing evidence cannot establish decay or persistent offset.' },
          atReacquisition: { LEFT: evidence(at, 'LEFT'), RIGHT: evidence(at, 'RIGHT'),
            visibility: { leftHip: at.LEFT.visibility.leftHip, rightHip: at.LEFT.visibility.rightHip, leftKnee: at.LEFT.visibility.knee, rightKnee: at.RIGHT.visibility.knee } },
          evidenceWindows: windows,
          clearAvailability: LIMBS.flatMap((side) => CLEAR_THRESHOLDS.flatMap((threshold) => CLEAR_DWELLS.map((dwell) => ({ side,
            ...clearAvailability(source.frames, side, episode.reacquiredAt, stage.endMs, threshold, dwell) })))),
          // Bounded scalar trace only: no images/landmarks or entire replay frame arrays.
          observations: source.frames.filter((f) => f.timestamp >= (episode.lastUsableBeforeGapMs ?? episode.gapStartedAt) &&
            f.timestamp <= episode.reacquiredAt + 1000 && f.timestamp < stage.endMs).map((f) => ({ timestamp: f.timestamp,
              LEFT: evidence(f, 'LEFT'), RIGHT: evidence(f, 'RIGHT'), leftHipVisibility: f.LEFT.visibility.leftHip,
              rightHipVisibility: f.LEFT.visibility.rightHip, leftKneeVisibility: f.LEFT.visibility.knee, rightKneeVisibility: f.RIGHT.visibility.knee })) });
      }
    }
  }
  return traces;
}
export type FalseReacquisitionTrace = ReturnType<typeof falseReacquisitionTraces>[number];
