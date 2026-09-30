// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { compareVideoCoverage, timestampStats, VideoFrameAccounting } from './videoReplayMetrics';
import { fullTrial } from './testFixtures';
import { replayLandmarks } from './landmarkReplay';

describe('video completeness metrics', () => {
  it('counts duplicates independently, including repeated timestamps after a newer frame', () => {
    const stats = new VideoFrameAccounting();
    for (const timestamp of [0, 33, 33, 66, 33, 50, -1, NaN, 100, 133]) if (stats.accept(timestamp)) stats.recordProcessed(timestamp);
    expect(stats.snapshot(660)).toEqual({ frameCount: 5, decodedFrameCount: 10, processedFrameCount: 5,
      duplicateFrameCount: 2, duplicateMediaTimestampCount: 2, skippedFrameCount: 3, outOfOrderMediaTimestampCount: 1, invalidMediaTimestampCount: 2,
      firstMediaTimestampMs: 0, lastMediaTimestampMs: 133, medianFrameIntervalMs: 33, maxFrameIntervalMs: 34, expectedApproxFrameCount: 660 });
  });
  it('keeps missing timestamps/intervals null and computes irregular PTS intervals without inventing missing frames', () => {
    expect(timestampStats([])).toMatchObject({ frameCount: 0, firstMediaTimestampMs: null, medianFrameIntervalMs: null });
    expect(timestampStats([12])).toMatchObject({ firstMediaTimestampMs: 12, lastMediaTimestampMs: 12, maxFrameIntervalMs: null });
    expect(timestampStats([0, 33, 99, 133, 233])).toMatchObject({ medianFrameIntervalMs: 50, maxFrameIntervalMs: 100 });
  });
  it('compares full capture and marker-bounded Guided intervals independently without requiring 1:1 live/video counts', async () => {
    const { session } = await fullTrial();
    const frames = session.poseFrames.filter((_, index) => index % 2 === 0);
    const stats = new VideoFrameAccounting(); frames.forEach((frame) => { stats.accept(frame.tMs); stats.recordProcessed(frame.tMs); });
    const coverage = compareVideoCoverage(session, 1, frames, stats.snapshot(700));
    expect(coverage.recordedPoseFrameCount).toBe(session.poseFrames.length);
    expect(coverage.videoProcessedFrameCount).toBe(frames.length);
    expect(coverage.guidedInterval.recordedPoseFrameCount).toBe(session.liveResult.trials[0].result.poseFrameCount);
    expect(coverage.guidedInterval.videoProcessedFrameCount).toBe(replayLandmarks(session, 1, frames, 'VIDEO').result.poseFrameCount);
    expect(coverage.guidedInterval.recordedPoseFrameCount).toBeLessThan(coverage.recordedPoseFrameCount);
    expect(coverage.guidedInterval.videoTimestamps.medianFrameIntervalMs).toBe(80);
    expect(coverage.guidedInterval.recordedTimestamps.medianFrameIntervalMs).toBe(40);
    expect(coverage.expectedApproxFrameCount).toBe(700);
  });
});
