import type { ReplayPoint, ReplayPoseFrame } from '../replay/replayTypes';
import { FORENSIC_JOINTS as JOINTS, FORENSIC_RULES as R } from './forensicRules';
import { matchFrames, median, pearson, stats } from './forensicMath';

export interface TraceWindow { id: string; kind: 'STAGE' | 'ANCHOR'; label: string; startMs: number; endMs: number }
export interface RecordedTrace { captureId: string; frames: ReplayPoseFrame[]; captureDurationMs: number; requiredEndMs: number; windows: TraceWindow[] }
export interface InferredTrace { mediaId: string; frames: ReplayPoseFrame[] }
export type PairStatus = 'TEMPORALLY_INCOMPATIBLE' | 'TRACE_VERIFIED_MEDIA_MATCH' | 'TRACE_SIMILAR_BUT_AMBIGUOUS' | 'TRACE_MISMATCH' | 'INSUFFICIENT_TRACE';
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
function usable(p: ReplayPoint | undefined, threshold: number) { return !!p && finite(p.x) && finite(p.y) && finite(p.visibility) && p.visibility >= threshold; }
const confusion = () => ({ bothPresent: 0, recordedOnly: 0, inferredOnly: 0, bothMissing: 0 });
function observe(c: ReturnType<typeof confusion>, a: boolean, b: boolean) { c[a ? b ? 'bothPresent' : 'recordedOnly' : b ? 'inferredOnly' : 'bothMissing']++; }
type Match = ReturnType<typeof matchFrames>[number];
function summarize(recorded: RecordedTrace, inferred: InferredTrace, matches: Match[], recordedCount: number) {
  const poseErrors: number[] = [], visibilityErrors: number[] = [], worldErrors: number[] = [], poseMissing = confusion();
  const joints = JOINTS.map((joint) => ({ ...joint, xy: [] as number[], visibilityErrors: [] as number[], world: [] as number[],
    rx: [] as number[], ry: [] as number[], ix: [] as number[], iy: [] as number[],
    rdx: [] as number[], rdy: [] as number[], idx: [] as number[], idy: [] as number[], deltaSquaredError: [] as number[], missing: confusion() }));
  let previous: Match | null = null;
  for (const match of matches) {
    const a = recorded.frames[match.recordedIndex], b = inferred.frames[match.inferredIndex], frameErrors: number[] = [];
    observe(poseMissing, a.landmarks.length > 0, b.landmarks.length > 0);
    for (const joint of joints) {
      const p = a.landmarks[joint.index], q = b.landmarks[joint.index], av = usable(p, joint.visibility), bv = usable(q, joint.visibility);
      observe(joint.missing, av, bv);
      if (finite(p?.visibility) && finite(q?.visibility)) { const e = Math.abs(p.visibility - q.visibility); joint.visibilityErrors.push(e); visibilityErrors.push(e); }
      if (!av || !bv) continue;
      const error = Math.hypot(p.x - q.x, p.y - q.y); frameErrors.push(error); joint.xy.push(error);
      joint.rx.push(p.x); joint.ry.push(p.y); joint.ix.push(q.x); joint.iy.push(q.y);
      const w = a.worldLandmarks[joint.index], v = b.worldLandmarks[joint.index];
      const worldUsable = (point: ReplayPoint | undefined) => point && finite(point.x) && finite(point.y) && finite(point.z) && (point.visibility === null || finite(point.visibility) && point.visibility >= joint.visibility);
      if (worldUsable(w) && worldUsable(v)) { const e = Math.hypot(w.x - v.x, w.y - v.y, w.z - v.z); joint.world.push(e); worldErrors.push(e); }
      if (previous) {
        const pa = recorded.frames[previous.recordedIndex], pb = inferred.frames[previous.inferredIndex];
        const dtA = a.tMs - pa.tMs, dtB = b.tMs - pb.tMs, oldP = pa.landmarks[joint.index], oldQ = pb.landmarks[joint.index];
        if (dtA > 0 && dtA < R.maxDeltaGapMs && dtB > 0 && dtB < R.maxDeltaGapMs && usable(oldP, joint.visibility) && usable(oldQ, joint.visibility)) {
          const dxA = p.x - oldP.x, dyA = p.y - oldP.y, dxB = q.x - oldQ.x, dyB = q.y - oldQ.y;
          joint.rdx.push(dxA); joint.rdy.push(dyA); joint.idx.push(dxB); joint.idy.push(dyB); joint.deltaSquaredError.push((dxA - dxB) ** 2 + (dyA - dyB) ** 2);
        }
      }
    }
    if (frameErrors.length >= R.minFrameJoints) poseErrors.push(median(frameErrors)!);
    previous = match;
  }
  const perJoint = joints.map((j) => ({ index: j.index, name: j.name, usableSamples: j.xy.length, medianXYError: median(j.xy), p95XYError: stats(j.xy).p95,
    visibilityError: stats(j.visibilityErrors), jointXCorrelation: pearson(j.rx, j.ix), jointYCorrelation: pearson(j.ry, j.iy),
    deltaSamples: j.deltaSquaredError.length, deltaRMSE: j.deltaSquaredError.length ? Math.sqrt(j.deltaSquaredError.reduce((a, b) => a + b, 0) / j.deltaSquaredError.length) : null,
    deltaXCorrelation: pearson(j.rdx, j.idx), deltaYCorrelation: pearson(j.rdy, j.idy), missingAgreement: j.missing, secondaryWorldError: stats(j.world) }));
  return { recordedFrames: recordedCount, matchedFrames: matches.length, usablePoseFrames: poseErrors.length,
    coverage: recordedCount ? matches.length / recordedCount : null,
    usableCoverageOfRecorded: recordedCount ? poseErrors.length / recordedCount : null, usableCoverageOfMatched: matches.length ? poseErrors.length / matches.length : null,
    timestampErrorMs: stats(matches.map((m) => Math.abs(m.dtMs))), poseError: stats(poseErrors), visibilityError: stats(visibilityErrors), perJoint,
    medianCorrelationAcrossAxes: median(perJoint.flatMap((j) => [j.jointXCorrelation, j.jointYCorrelation]).filter(finite)),
    medianMotionDeltaCorrelation: median(perJoint.flatMap((j) => [j.deltaXCorrelation, j.deltaYCorrelation]).filter(finite)),
    medianDeltaRMSE: median(perJoint.map((j) => j.deltaRMSE).filter(finite)), poseMissingAgreement: poseMissing, secondaryWorldError: stats(worldErrors) };
}
export function scoreTracePair(recorded: RecordedTrace, inferred: InferredTrace) {
  const matches = matchFrames(recorded.frames, inferred.frames), summary = summarize(recorded, inferred, matches, recorded.frames.length);
  const lastPts = inferred.frames.at(-1)?.tMs ?? null;
  const temporalCompatible = lastPts !== null && lastPts + R.timestampToleranceMs >= recorded.requiredEndMs;
  const sufficient = summary.usablePoseFrames >= R.minCorrelationSamples && summary.coverage !== null && summary.poseError.median !== null && summary.poseError.p95 !== null &&
    summary.medianCorrelationAcrossAxes !== null && summary.medianMotionDeltaCorrelation !== null;
  const checks = {
    matchedCoverage: summary.coverage !== null && summary.coverage >= R.minMatchedCoverage,
    medianPoseError: summary.poseError.median !== null && summary.poseError.median <= R.maxMedianPoseError,
    p95PoseError: summary.poseError.p95 !== null && summary.poseError.p95 <= R.maxP95PoseError,
    trajectoryCorrelation: summary.medianCorrelationAcrossAxes !== null && summary.medianCorrelationAcrossAxes >= R.minMedianTrajectoryCorrelation,
    motionDeltaCorrelation: summary.medianMotionDeltaCorrelation !== null && summary.medianMotionDeltaCorrelation >= R.minMedianDeltaCorrelation,
  };
  const thresholdPass = temporalCompatible && sufficient && Object.values(checks).every(Boolean);
  const status: PairStatus = !temporalCompatible ? 'TEMPORALLY_INCOMPATIBLE' : !sufficient ? 'INSUFFICIENT_TRACE' : thresholdPass ? 'TRACE_SIMILAR_BUT_AMBIGUOUS' : 'TRACE_MISMATCH';
  return { captureId: recorded.captureId, mediaId: inferred.mediaId, ...summary,
    temporal: { captureDurationMs: recorded.captureDurationMs, lastPts, durationMinusLastPtsMs: lastPts === null ? null : recorded.captureDurationMs - lastPts, requiredEndMs: recorded.requiredEndMs, compatible: temporalCompatible },
    offsetMs: 0, checks, thresholdPass, status: status as PairStatus,
    windows: recorded.windows.map((w) => ({ ...w, ...summarize(recorded, inferred, matches.filter((m) => recorded.frames[m.recordedIndex].tMs >= w.startMs && recorded.frames[m.recordedIndex].tMs < w.endMs),
      recorded.frames.filter((f) => f.tMs >= w.startMs && f.tMs < w.endMs).length) })) };
}
export type PairScore = ReturnType<typeof scoreTracePair>;
const rank = (a: PairScore, b: PairScore) => (a.poseError.median ?? Infinity) - (b.poseError.median ?? Infinity) ||
  (b.medianCorrelationAcrossAxes ?? -Infinity) - (a.medianCorrelationAcrossAxes ?? -Infinity) || a.mediaId.localeCompare(b.mediaId);
export function classifyTraceMatrix(scores: readonly PairScore[]) {
  const matrix = scores.map((s) => ({ ...s })), ids = [...new Set(matrix.map((s) => s.captureId))];
  if (new Set(matrix.map((s) => `${s.captureId}/${s.mediaId}`)).size !== matrix.length) throw new Error('Duplicate forensic pair.');
  const rows = ids.map((captureId) => {
    const pairs = matrix.filter((s) => s.captureId === captureId), candidates = pairs.filter((p) => p.thresholdPass);
    const eligible = pairs.filter((p) => p.usablePoseFrames >= R.minCorrelationSamples && p.poseError.median !== null && p.medianCorrelationAcrossAxes !== null).sort(rank);
    const winner = candidates.length === 1 ? candidates[0] : null;
    const bestScoring = eligible[0] ?? null, runnerUp = eligible.find((p) => p.mediaId !== (winner ?? bestScoring)?.mediaId) ?? null;
    const separation = winner && runnerUp ? {
      pose: winner.poseError.median! < runnerUp.poseError.median! * R.separationPoseRatio,
      trajectory: winner.medianCorrelationAcrossAxes! >= runnerUp.medianCorrelationAcrossAxes! + R.separationCorrelationMargin,
    } : { pose: false, trajectory: false };
    return { captureId, thresholdPassingCount: candidates.length, winnerMediaId: winner?.mediaId ?? null, bestScoringMediaId: bestScoring?.mediaId ?? null,
      runnerUpMediaId: runnerUp?.mediaId ?? null, separation, separationPass: separation.pose || separation.trajectory, uniqueWinner: candidates.length === 1, sharedMediaWinner: false, verified: false };
  });
  for (const row of rows) {
    row.sharedMediaWinner = row.winnerMediaId !== null && rows.filter((r) => r.winnerMediaId === row.winnerMediaId).length > 1;
    row.verified = row.uniqueWinner && !row.sharedMediaWinner && row.separationPass;
    if (row.verified) matrix.find((s) => s.captureId === row.captureId && s.mediaId === row.winnerMediaId)!.status = 'TRACE_VERIFIED_MEDIA_MATCH';
  }
  const unmatchedMedia = [...new Set(matrix.map((s) => s.mediaId))].filter((id) => !rows.some((r) => r.verified && r.winnerMediaId === id));
  return { matrix, rows, allVerified: rows.length > 0 && rows.every((r) => r.verified), unmatchedMedia };
}
/** No filename, role hint, model outcome, or duration ranking is consulted by this scorer. */
export function scoreTraceMatrix(recorded: readonly RecordedTrace[], inferred: readonly InferredTrace[]) {
  if (new Set(recorded.map((r) => r.captureId)).size !== recorded.length || new Set(inferred.map((r) => r.mediaId)).size !== inferred.length) throw new Error('Duplicate trace identity.');
  return classifyTraceMatrix(recorded.flatMap((r) => inferred.map((i) => scoreTracePair(r, i))));
}
