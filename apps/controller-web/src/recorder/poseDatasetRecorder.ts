import {
  POSE_LABELS,
  type DatasetMetadata,
  type GuidedStage,
  type PoseDataset,
  type PoseFrame,
  type PoseSample,
  type RecorderView,
  type SampleCounts,
} from './poseRecorderTypes';

export const GUIDED_SEQUENCE: readonly GuidedStage[] = [
  { phase: 'PREPARE', label: null, nextLabel: 'NEUTRAL', durationMs: 5000 },
  { phase: 'STABILIZE', label: null, nextLabel: 'NEUTRAL', durationMs: 1000 },
  ...POSE_LABELS.flatMap((label, index): GuidedStage[] => [
    ...(index > 0 ? [{ phase: 'TRANSITION' as const, label: null, nextLabel: label, durationMs: 3000 }] : []),
    { phase: 'RECORDING', label, nextLabel: null, durationMs: 3000 },
  ]),
];

const emptyCounts = (): SampleCounts => ({
  NEUTRAL: 0, TWIST_LEFT: 0, TWIST_RIGHT: 0, KNEE_LEFT: 0, KNEE_RIGHT: 0,
});

/** Stores per-inference samples outside React. UI reads small summaries only. */
export class PoseDatasetRecorder {
  private status: RecorderView['status'] = 'IDLE';
  private metadata: DatasetMetadata | null = null;
  private startedAt = 0;
  private stageIndex = 0;
  private remainingMs = 0;
  private samples: PoseSample[] = [];
  private counts = emptyCounts();
  private dropped = 0;
  private droppedCounts = emptyCounts();

  start(metadata: DatasetMetadata, now: number): boolean {
    // Keep finished data until an explicit Reset Dataset.
    if (this.status !== 'IDLE') return false;
    this.metadata = { ...metadata };
    this.startedAt = now;
    this.stageIndex = 0;
    this.remainingMs = GUIDED_SEQUENCE[0].durationMs;
    this.status = 'ACTIVE';
    return true;
  }

  private advance(now: number) {
    if (this.status !== 'ACTIVE') return;
    let elapsed = Math.max(0, now - this.startedAt);
    for (let index = 0; index < GUIDED_SEQUENCE.length; index++) {
      const stage = GUIDED_SEQUENCE[index];
      if (elapsed < stage.durationMs) {
        this.stageIndex = index;
        this.remainingMs = stage.durationMs - elapsed;
        return;
      }
      elapsed -= stage.durationMs;
    }
    this.status = 'COMPLETED';
    this.remainingMs = 0;
  }

  recordFrame(frame: PoseFrame): void {
    if (this.status !== 'ACTIVE' || frame.timestamp < this.startedAt) return;
    // Use the inference timestamp, never a React state label or a timer tick count.
    this.advance(frame.timestamp);
    if (this.status !== 'ACTIVE') return;
    const { label, phase } = GUIDED_SEQUENCE[this.stageIndex];
    if (phase !== 'RECORDING' || label === null) return;
    if (frame.landmarks.length === 0) {
      this.dropped++;
      this.droppedCounts[label]++;
      return;
    }

    // Copy primitives while the MediaPipe result is still alive; no result references escape.
    const snapshot = (points: PoseFrame['landmarks']) => points.map((point, index) => ({
      index, x: point.x, y: point.y, z: point.z, visibility: point.visibility ?? null,
    }));
    this.samples.push({
      label,
      timestamp: frame.timestamp,
      videoTime: frame.videoTime,
      landmarks: snapshot(frame.landmarks),
      worldLandmarks: snapshot(frame.worldLandmarks),
    });
    this.counts[label]++;
  }

  interrupt(): void {
    if (this.status === 'ACTIVE') {
      this.status = 'INTERRUPTED';
      this.remainingMs = 0;
    }
  }

  reset(): void {
    this.status = 'IDLE';
    this.metadata = null;
    this.samples = [];
    this.counts = emptyCounts();
    this.dropped = 0;
    this.droppedCounts = emptyCounts();
    this.stageIndex = 0;
    this.remainingMs = 0;
    this.startedAt = 0;
  }

  getView(now: number): RecorderView {
    this.advance(now);
    return {
      status: this.status,
      stageIndex: this.stageIndex,
      stage: this.status === 'ACTIVE' ? GUIDED_SEQUENCE[this.stageIndex] : null,
      remainingMs: this.remainingMs,
      sampleCounts: { ...this.counts },
      totalSamples: this.samples.length,
      droppedPoseFrameCount: this.dropped,
      droppedPoseFrameCounts: { ...this.droppedCounts },
      createdAt: this.metadata?.createdAt ?? null,
    };
  }

  exportJson(): string {
    if (!this.metadata || (this.status !== 'COMPLETED' && this.status !== 'INTERRUPTED')) {
      throw new Error('기록을 완료하거나 중단한 후 다운로드할 수 있습니다.');
    }
    const dataset: PoseDataset = {
      ...this.metadata,
      status: this.status,
      sampleCounts: { ...this.counts },
      droppedPoseFrameCount: this.dropped,
      droppedPoseFrameCounts: { ...this.droppedCounts },
      samples: this.samples,
    };
    return JSON.stringify(dataset, null, 2);
  }
}
