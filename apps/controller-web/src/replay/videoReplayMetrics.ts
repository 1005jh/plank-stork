import type { ReplayPoseFrame, ReplaySession } from './replayTypes';

export interface FrameTimestampStats {
  frameCount: number;
  firstMediaTimestampMs: number | null;
  lastMediaTimestampMs: number | null;
  medianFrameIntervalMs: number | null;
  maxFrameIntervalMs: number | null;
}
export interface VideoDecodeDiagnostics extends FrameTimestampStats {
  decodedFrameCount: number;
  processedFrameCount: number;
  duplicateFrameCount: number;
  duplicateMediaTimestampCount: number;
  skippedFrameCount: number;
  outOfOrderMediaTimestampCount: number;
  invalidMediaTimestampCount: number;
  expectedApproxFrameCount: number | null;
}
export interface VideoReplayDiagnostics extends VideoDecodeDiagnostics {
  source: 'WEBCODECS_WEBM';
  recordedPoseFrameCount: number;
  videoProcessedFrameCount: number;
  recordedTimestamps: FrameTimestampStats;
  guidedInterval: {
    trialId: number; startMs: number; endMs: number;
    recordedPoseFrameCount: number; videoProcessedFrameCount: number;
    recordedTimestamps: FrameTimestampStats; videoTimestamps: FrameTimestampStats;
  };
}
export function timestampStats(timestamps: readonly number[]): FrameTimestampStats {
  const intervals = timestamps.slice(1).map((time, index) => time - timestamps[index]).sort((a, b) => a - b);
  const middle = Math.floor(intervals.length / 2);
  return { frameCount: timestamps.length, firstMediaTimestampMs: timestamps[0] ?? null, lastMediaTimestampMs: timestamps.at(-1) ?? null,
    medianFrameIntervalMs: !intervals.length ? null : intervals.length % 2 ? intervals[middle] : (intervals[middle - 1] + intervals[middle]) / 2,
    maxFrameIntervalMs: intervals.at(-1) ?? null };
}
/** Explicit accounting; duplicates are never counted as skipped source frames. */
export class VideoFrameAccounting {
  private previous = -Infinity;
  private seen = new Set<number>();
  private decoded = 0;
  private duplicates = 0;
  private backwards = 0;
  private invalid = 0;
  private processed: number[] = [];
  accept(timestampMs: number): boolean {
    this.decoded++;
    if (!Number.isFinite(timestampMs) || timestampMs < 0) { this.invalid++; return false; }
    if (this.seen.has(timestampMs)) { this.duplicates++; return false; }
    this.seen.add(timestampMs);
    if (timestampMs < this.previous) { this.backwards++; return false; }
    this.previous = timestampMs; return true;
  }
  recordProcessed(timestampMs: number) { this.processed.push(timestampMs); }
  snapshot(expectedApproxFrameCount: number | null): VideoDecodeDiagnostics {
    return { ...timestampStats(this.processed), decodedFrameCount: this.decoded, processedFrameCount: this.processed.length,
      duplicateFrameCount: this.duplicates, duplicateMediaTimestampCount: this.duplicates,
      skippedFrameCount: this.backwards + this.invalid, outOfOrderMediaTimestampCount: this.backwards,
      invalidMediaTimestampCount: this.invalid, expectedApproxFrameCount };
  }
}
export function compareVideoCoverage(session: ReplaySession, trialId: number, frames: readonly ReplayPoseFrame[], diagnostics: VideoDecodeDiagnostics): VideoReplayDiagnostics {
  const trial = session.liveResult.trials.find((entry) => entry.id === trialId);
  if (!trial || trial.endMs === null) throw new Error('종료된 Guided trial이 필요합니다.');
  // Match the existing replay's observed start/stop boundary, including the completion observation.
  // GUIDED_TEST_COMPLETE alone is the planned 22s boundary and can precede that observation.
  const inTrial = (frame: ReplayPoseFrame, video: boolean) =>
    (frame.tMs > trial.startMs || (frame.tMs === trial.startMs && frame.order > trial.startOrder)) &&
    (frame.tMs < trial.endMs! || (frame.tMs === trial.endMs && (video ? 0 : frame.order) <= (trial.endOrder ?? Infinity)));
  const recorded = session.poseFrames.filter((frame) => inTrial(frame, false)).map((frame) => frame.tMs);
  const processed = frames.filter((frame) => inTrial(frame, true)).map((frame) => frame.tMs);
  return { ...diagnostics, source: 'WEBCODECS_WEBM', recordedPoseFrameCount: session.poseFrames.length,
    videoProcessedFrameCount: frames.length, recordedTimestamps: timestampStats(session.poseFrames.map((frame) => frame.tMs)),
    guidedInterval: { trialId, startMs: trial.startMs, endMs: trial.endMs, recordedPoseFrameCount: recorded.length,
      videoProcessedFrameCount: processed.length, recordedTimestamps: timestampStats(recorded), videoTimestamps: timestampStats(processed) } };
}
