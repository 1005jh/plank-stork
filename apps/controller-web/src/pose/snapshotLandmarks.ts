import type { PoseFrame, RecordedLandmark } from '../recorder/poseRecorderTypes';

/** Call synchronously while the MediaPipe result is alive. */
export function snapshotLandmarks(points: PoseFrame['landmarks']): RecordedLandmark[] {
  return points.map(({ x, y, z, visibility }, index) => ({ index, x, y, z, visibility: visibility ?? null }));
}
