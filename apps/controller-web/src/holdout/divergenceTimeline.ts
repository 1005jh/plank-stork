import { discoveryStages, stageForTime, type DiscoveryStage } from '../discovery/discoveryStages';
import { GEOMETRY_JOINTS, rawReliabilityGeometry } from '../discovery/geometryReliabilityFeatures';
import { distribution } from '../discovery/integrityFeatures';
import { Y_KICK_V3_CONFIG, usableKneesV3 } from '../pose/kick/kneeKickDetectorV3';
import { extractKneeMotionFeatures } from '../pose/motion/kneeMotionFeatures';
import type { KneeKickV3Replay } from '../replay/kneeKickV3Replay';
import type { ReplayPoseFrame, ReplaySession } from '../replay/replayTypes';

/** Fixed before reading counterfactual outcomes. This is an analysis matching tolerance, not a detector threshold. */
export const ALIGNMENT_TOLERANCE_MS = 1000 / 60;
export type TraceRow = KneeKickV3Replay['diagnostics'][number];

/** Count missing and non-finite observations separately; never impute either as zero. */
export function observedDistribution(values: readonly (number | null | undefined)[]) {
  return { ...distribution([...values].map((v) => v ?? null)),
    missing: values.filter((v) => v == null).length,
    nonFinite: values.filter((v) => typeof v === 'number' && !Number.isFinite(v)).length };
}

export function frameCoverage(frames: readonly ReplayPoseFrame[]) {
  const geometry = frames.map((f) => rawReliabilityGeometry(f.landmarks, f.worldLandmarks));
  const usable = frames.map((f) => usableKneesV3(extractKneeMotionFeatures(f.landmarks)));
  const poseMissing = frames.filter((f) => f.landmarks.length === 0).length;
  return { frameCount: frames.length, poseMissing, posePresent: frames.length - poseMissing,
    leftUsable: usable.filter((u) => u.left).length, rightUsable: usable.filter((u) => u.right).length,
    bothUsable: usable.filter((u) => u.left && u.right).length,
    posePresentLeftUnusable: frames.filter((f, i) => f.landmarks.length > 0 && !usable[i].left).length,
    posePresentRightUnusable: frames.filter((f, i) => f.landmarks.length > 0 && !usable[i].right).length,
    joints: Object.fromEntries(Object.entries(GEOMETRY_JOINTS).map(([name, [index, threshold]]) => [name, {
      threshold, available: geometry.filter((g) => g.image.points[name as keyof typeof GEOMETRY_JOINTS] !== null).length,
      visibility: observedDistribution(frames.map((f) => f.landmarks[index]?.visibility)),
    }])) };
}

export function frameTimeline(session: ReplaySession, frames: readonly ReplayPoseFrame[]) {
  const stages = discoveryStages(session, session.liveResult.trials[0]).stages;
  const part = (rows: readonly ReplayPoseFrame[]) => ({ ...frameCoverage(rows),
    firstMs: rows[0]?.tMs ?? null, lastMs: rows.at(-1)?.tMs ?? null,
    intervalMs: observedDistribution(rows.slice(1).map((r, i) => r.tMs - rows[i].tMs)),
    gapsAtLeastStaleMs: rows.slice(1).filter((r, i) => r.tMs - rows[i].tMs >= Y_KICK_V3_CONFIG.staleMs).length });
  return { total: part(frames), guided: part(frames.filter((f) => stageForTime(stages, f.tMs))),
    stages: stages.map((s) => ({ ...s, ...part(frames.filter((f) => stageForTime(stages, f.tMs)?.stageIndex === s.stageIndex)) })) };
}

/** Monotone one-to-one nearest match, LIVE time/order first, earlier VIDEO PTS breaks ties.
 * No shift fit, interpolation, pose-based matching, or claim that these are the same camera frames.
 * Missing poses still participate. Original indices and every unmatched frame are retained.
 */
export function alignFrames(live: readonly ReplayPoseFrame[], video: readonly ReplayPoseFrame[], stages: readonly DiscoveryStage[]) {
  const sorted = (frames: readonly ReplayPoseFrame[]) => frames.map((f, index) => ({ ...f, index }))
    .filter((f) => Number.isFinite(f.tMs)).sort((a, b) => a.tMs - b.tMs || a.order - b.order);
  const l = sorted(live), v = sorted(video), matchedLive = new Set<number>(), matchedVideo = new Set<number>();
  const matches: { liveIndex: number; videoIndex: number; liveMs: number; videoMs: number; deltaMs: number; stageIndex: number | null }[] = [];
  let after = -1;
  for (const f of l) {
    const stageIndex = stageForTime(stages, f.tMs)?.stageIndex ?? null;
    let best = -1, distance = Infinity;
    for (let i = after + 1; i < v.length; i++) {
      if (v[i].tMs > f.tMs + ALIGNMENT_TOLERANCE_MS) break;
      const d = Math.abs(v[i].tMs - f.tMs);
      if (d <= ALIGNMENT_TOLERANCE_MS && d < distance && (stageForTime(stages, v[i].tMs)?.stageIndex ?? null) === stageIndex) {
        best = i; distance = d;
      }
    }
    if (best < 0) continue;
    const other = v[best]; after = best; matchedLive.add(f.index); matchedVideo.add(other.index);
    matches.push({ liveIndex: f.index, videoIndex: other.index, liveMs: f.tMs, videoMs: other.tMs, deltaMs: other.tMs - f.tMs, stageIndex });
  }
  const unmatched = (frames: readonly ReplayPoseFrame[], matched: Set<number>) => frames.flatMap((f, index) => matched.has(index) ? [] : [{
    index, tMs: Number.isFinite(f.tMs) ? f.tMs : null, stageIndex: stageForTime(stages, f.tMs)?.stageIndex ?? null,
    reason: Number.isFinite(f.tMs) ? 'NO_MONOTONE_SAME_STAGE_MATCH_WITHIN_TOLERANCE' : 'NON_FINITE_TIMESTAMP',
  }]);
  return { toleranceMs: ALIGNMENT_TOLERANCE_MS, matches, unmatchedLive: unmatched(live, matchedLive), unmatchedVideo: unmatched(video, matchedVideo),
    signedDeltaMs: observedDistribution(matches.map((m) => m.deltaMs)), absoluteDeltaMs: observedDistribution(matches.map((m) => Math.abs(m.deltaMs))) };
}

/** Observed intervals only: do not extend a usable run through an unobserved frame or across a stale gap. */
export function observedRuns(rows: readonly TraceRow[], predicate: (r: TraceRow) => boolean) {
  const runs: { startMs: number; endMs: number; frameCount: number; observedSpanMs: number }[] = [];
  let current: typeof runs[number] | null = null;
  for (const row of rows) {
    if (!predicate(row)) { current = null; continue; }
    if (!current || row.timestamp - current.endMs >= Y_KICK_V3_CONFIG.staleMs) {
      current = { startMs: row.timestamp, endMs: row.timestamp, frameCount: 0, observedSpanMs: 0 }; runs.push(current);
    }
    current.endMs = row.timestamp; current.frameCount++; current.observedSpanMs = current.endMs - current.startMs;
  }
  return runs;
}

export function stageSignals(rows: readonly TraceRow[]) {
  return Object.fromEntries((['left', 'right'] as const).map((side) => {
    const left = side === 'left', y = (r: TraceRow) => left ? r.normalizedYLeft : r.normalizedYRight;
    const above = (r: TraceRow) => y(r) !== null && Math.abs(y(r)!) >= Y_KICK_V3_CONFIG.enter;
    const tracking = (r: TraceRow) => left ? r.leftTrackingState : r.rightTrackingState;
    const usable = (r: TraceRow) => left ? r.usableLeft : r.usableRight;
    return [side, { usableIntervals: observedRuns(rows, usable), y: observedDistribution(rows.map(y)),
      absY: observedDistribution(rows.map((r) => y(r) === null ? null : Math.abs(y(r)!))),
      thresholdIntervals: observedRuns(rows, above), aboveEnterFrames: rows.filter(above).length,
      aboveEnterTrackingReadyFrames: rows.filter((r) => above(r) && tracking(r) === 'READY').length,
      aboveEnterReacquisitionBlockedFrames: rows.filter((r) => above(r) && tracking(r) === 'REACQUIRED_NOT_READY').length,
      enterDwellMs: observedDistribution(rows.map((r) => left ? r.leftEnterRunMs : r.rightEnterRunMs)),
      clearDwellMs: observedDistribution(rows.map((r) => left ? r.leftClearRunMs : r.rightClearRunMs)),
      lossStarts: rows.filter((r) => (left ? r.leftLossStartedAt : r.rightLossStartedAt) === r.timestamp).map((r) => r.timestamp),
      reacquisitions: rows.filter((r) => (left ? r.leftReacquiredAt : r.rightReacquiredAt) === r.timestamp).map((r) => r.timestamp),
      trackingFrames: Object.fromEntries(['READY', 'LOST', 'REACQUIRED_NOT_READY'].map((s) => [s, rows.filter((r) => tracking(r) === s).length])),
    }];
  }));
}

export function diagnosticTrace(replay: KneeKickV3Replay) {
  return replay.diagnostics.map((r, index) => ({ ...r,
    stateBefore: replay.diagnostics[index - 1]?.state ?? 'ARMED',
    thresholdCrossingLeft: r.normalizedYLeft === null ? null : Math.abs(r.normalizedYLeft) >= Y_KICK_V3_CONFIG.enter,
    thresholdCrossingRight: r.normalizedYRight === null ? null : Math.abs(r.normalizedYRight) >= Y_KICK_V3_CONFIG.enter,
    event: replay.events.find((e) => e.timestamp === r.timestamp) ?? null,
  }));
}
