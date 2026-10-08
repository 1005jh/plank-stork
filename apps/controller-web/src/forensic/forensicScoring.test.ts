import { describe, expect, it } from 'vitest';
import { matchFrames, pearson } from './forensicMath';
import { classifyTraceMatrix, scoreTraceMatrix, scoreTracePair, type RecordedTrace } from './forensicScoring';
import { replayVideoSourceError, replayVideoSourceFromFilename } from '../replay/replayVideoSource';

function trace(captureId = 'capture', phase = 0): RecordedTrace {
  return { captureId, captureDurationMs: 4000, requiredEndMs: 3960, windows: [{ id: 'kick', kind: 'STAGE', label: 'KNEE_LEFT', startMs: 500, endMs: 2500 }],
    frames: Array.from({ length: 100 }, (_, i) => ({ tMs: i * 40, order: i,
      landmarks: Array.from({ length: 33 }, (_, j) => ({ x: .5 + .2 * Math.sin(i / 8 + phase + j / 3), y: .5 + .2 * Math.cos(i / 13 + phase + j / 4), z: 0, visibility: .99 })), worldLandmarks: [] })) };
}
const inferred = (phase = 0, mediaId = 'media') => ({ mediaId, frames: trace('unused', phase).frames });
const passing = (captureId: string, mediaId: string) => scoreTracePair(trace(captureId), inferred(0, mediaId));
const alternate = (captureId: string, mediaId: string) => scoreTracePair(trace(captureId), inferred(2, mediaId));
describe('fixed forensic matching and statistics', () => {
  it('accepts inclusive ±20ms, excludes outside and selects nearest with earlier ties', () => {
    expect(matchFrames([{ tMs: 20 }, { tMs: 100 }, { tMs: 200 }], [{ tMs: 0 }, { tMs: 120 }, { tMs: 220.001 }])).toEqual([
      { recordedIndex: 0, inferredIndex: 0, dtMs: -20 }, { recordedIndex: 1, inferredIndex: 1, dtMs: 20 }]);
    expect(matchFrames([{ tMs: 40 }], [{ tMs: 30 }, { tMs: 50 }])[0].inferredIndex).toBe(0);
  });
  it('never reuses an inferred frame and remains monotonic', () => {
    const matches = matchFrames([{ tMs: 0 }, { tMs: 10 }, { tMs: 20 }], [{ tMs: 5 }, { tMs: 21 }]);
    expect(matches.map((m) => m.inferredIndex)).toEqual([0, 1]);
  });
  it('rejects duplicate/non-monotonic timestamps rather than silently dropping frames', () => {
    expect(() => matchFrames([{ tMs: 1 }, { tMs: 1 }], [])).toThrow();
    expect(() => matchFrames([], [{ tMs: NaN }])).toThrow();
  });
  it('does not optimize an offset even for otherwise identical traces', () => {
    const b = inferred(); b.frames = b.frames.map((f) => ({ ...f, tMs: f.tMs + 10000 }));
    const score = scoreTracePair(trace(), b); expect(score.matchedFrames).toBe(0); expect(score.offsetMs).toBe(0); expect(score.thresholdPass).toBe(false);
  });
  it('uses null for constant/near constant or fewer than 30 paired values', () => {
    expect(pearson(Array(40).fill(1), Array(40).fill(1))).toBeNull();
    expect(pearson(Array.from({ length: 40 }, (_, i) => i * 1e-9), Array.from({ length: 40 }, (_, i) => i))).toBeNull();
    expect(pearson([1, 2], [1, 2])).toBeNull();
  });
  it('scores all 30 combinations identically to the individual scorer', () => {
    const a = Array.from({ length: 5 }, (_, i) => trace(`r${i}`)), b = Array.from({ length: 6 }, (_, i) => inferred(i, `m${i}`));
    const matrix = scoreTraceMatrix(a, b).matrix; expect(matrix).toHaveLength(30);
    for (const r of a) for (const m of b) expect(matrix.find((p) => p.captureId === r.captureId && p.mediaId === m.mediaId)).toEqual(scoreTracePair(r, m));
  });
  it('ignores filenames and prior candidate hints', () => {
    const a = trace(), b = inferred();
    expect(scoreTracePair({ ...a, filename: 'different', hintedWinner: 'foo' } as RecordedTrace, { ...b, filename: 'expected.webm' } as typeof b)).toEqual(scoreTracePair(a, b));
  });
  it('accepts the same moving synthetic trace, rejects wrong motion', () => {
    const good = scoreTracePair(trace(), inferred()); expect(good.thresholdPass).toBe(true); expect(good.poseError.median).toBe(0); expect(good.medianMotionDeltaCorrelation).toBe(1);
    expect(scoreTracePair(trace(), inferred(2)).thresholdPass).toBe(false);
  });
  it('keeps missing values unavailable and records pose/joint confusion', () => {
    const a = trace(), b = inferred(); a.frames.forEach((f) => { f.landmarks = []; });
    const score = scoreTracePair(a, b); expect(score.poseError.median).toBeNull(); expect(score.medianCorrelationAcrossAxes).toBeNull(); expect(score.usablePoseFrames).toBe(0);
    expect(score.poseMissingAgreement.inferredOnly).toBe(100); expect(score.perJoint[0].missingAgreement.inferredOnly).toBe(100);
  });
  it('requires four mutually usable joints per scored frame, not four unilateral detections', () => {
    const b = inferred(); b.frames.forEach((f) => f.landmarks.forEach((p, j) => { p.visibility = [11, 12, 23].includes(j) ? .99 : 0; }));
    expect(scoreTracePair(trace(), b).usablePoseFrames).toBe(0);
  });
  it('records window summaries and world evidence separately', () => {
    const s = scoreTracePair(trace(), inferred()); expect(s.windows[0].matchedFrames).toBe(50); expect(s.secondaryWorldError.median).toBeNull(); expect(s.thresholdPass).toBe(true);
  });
  it('never bridges a 400ms gap or a missing joint in deltas', () => {
    const a = trace(), b = inferred(); for (const t of [a, b]) { t.frames = t.frames.slice(0, 40).map((f, i) => ({ ...f, tMs: i * 400 })); }
    expect(scoreTracePair(a, b).perJoint[0].deltaSamples).toBe(0);
    const c = trace(), d = inferred(); d.frames[10].landmarks = [];
    expect(scoreTracePair(c, d).perJoint[0].deltaSamples).toBe(97);
  });
  it('rejects insufficient temporal coverage even if local motion matches', () => {
    const a = trace(); a.requiredEndMs = 9000; expect(scoreTracePair(a, inferred()).status).toBe('TEMPORALLY_INCOMPATIBLE');
  });
});
describe('unique matching and separation', () => {
  it('accepts one separated threshold winner', () => {
    const r = classifyTraceMatrix([passing('a', 'winner'), alternate('a', 'other')]); expect(r.allVerified).toBe(true); expect(r.matrix[0].status).toBe('TRACE_VERIFIED_MEDIA_MATCH');
  });
  it('refuses two passing candidates', () => {
    const r = classifyTraceMatrix([passing('a', 'm1'), passing('a', 'm2')]); expect(r.allVerified).toBe(false); expect(r.rows[0].uniqueWinner).toBe(false);
  });
  it('refuses a shared media winner', () => {
    const r = classifyTraceMatrix([passing('a', 'm1'), alternate('a', 'm2'), passing('b', 'm1'), alternate('b', 'm2')]); expect(r.rows.every((v) => v.sharedMediaWinner)).toBe(true); expect(r.allVerified).toBe(false);
  });
  it('requires separation even if runner-up fails a threshold', () => {
    const a = passing('a', 'm1'), b = passing('a', 'm2'); a.poseError.median = .04; b.poseError.median = .05; b.thresholdPass = false;
    const r = classifyTraceMatrix([a, b]); expect(r.rows[0].separationPass).toBe(false); expect(r.allVerified).toBe(false);
  });
  it('does not verify without an eligible runner-up', () => { expect(classifyTraceMatrix([passing('a', 'm1')]).allVerified).toBe(false); });
  it('includes temporally short alternatives in separation conservatively', () => {
    const a = passing('a', 'm1'), b = passing('a', 'm2'); b.thresholdPass = false; b.status = 'TEMPORALLY_INCOMPATIBLE';
    expect(classifyTraceMatrix([a, b]).rows[0].separationPass).toBe(false);
  });
  it('refuses duplicate pair or trace identities', () => {
    expect(() => classifyTraceMatrix([passing('a', 'm1'), passing('a', 'm1')])).toThrow();
    expect(() => scoreTraceMatrix([trace(), trace()], [inferred()])).toThrow();
  });
  it('forensic proof cannot bypass the general filename/capture guard', () => {
    const expected = { filename: 'plank-stork-replay-2026-10-03T16-39-36-229Z.webm', sourceCaptureId: 'plank-stork-replay-2026-10-03T16-39-36-229Z' };
    const forged = { ...replayVideoSourceFromFilename('renamed.webm'), verification: 'TRACE_VERIFIED_MEDIA_MATCH', forensicReportId: 'report' };
    expect(replayVideoSourceError(expected, forged)).not.toBeNull();
    expect(replayVideoSourceError(expected, replayVideoSourceFromFilename(expected.filename))).toBeNull();
  });
});
