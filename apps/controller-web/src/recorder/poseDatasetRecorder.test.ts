// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GUIDED_SEQUENCE, PoseDatasetRecorder } from './poseDatasetRecorder';
import { POSE_LABELS, type DatasetMetadata, type PoseDataset, type PoseFrame } from './poseRecorderTypes';

const metadata: DatasetMetadata = {
  version: 1, createdAt: '2026-09-20T01:02:03.000Z', model: 'pose_landmarker_full',
  delegate: 'GPU', videoWidth: 1280, videoHeight: 720, previewMirrored: true, timeOrigin: 123456789,
};
const frame = (timestamp: number): PoseFrame => ({
  timestamp, videoTime: timestamp / 1000,
  landmarks: Array.from({ length: 33 }, (_, index) => ({ x: index / 33, y: -0.123456789, z: 0, visibility: 0.01 })),
  worldLandmarks: Array.from({ length: 33 }, (_, index) => ({ x: -index / 10, y: 0, z: 0.987654321 })),
});
const exported = (recorder: PoseDatasetRecorder) => JSON.parse(recorder.exportJson()) as PoseDataset;

describe('raw pose dataset recorder', () => {
  it('excludes both samples and missing poses throughout STABILIZE', () => {
    const recorder = new PoseDatasetRecorder();
    recorder.start(metadata, 0);
    for (const timestamp of [5000, 5500, 5999]) {
      recorder.recordFrame(frame(timestamp));
      recorder.recordFrame({ ...frame(timestamp), landmarks: [] });
    }
    expect(recorder.getView(5999)).toMatchObject({
      stage: { phase: 'STABILIZE' }, totalSamples: 0, droppedPoseFrameCount: 0,
    });
    expect(Object.values(recorder.getView(5999).droppedPoseFrameCounts)).toEqual([0, 0, 0, 0, 0]);
    recorder.recordFrame(frame(6000));
    expect(recorder.getView(6000).sampleCounts.NEUTRAL).toBe(1);
  });

  it('counts drops per active label and keeps their sum equal to the compatible total', () => {
    const recorder = new PoseDatasetRecorder();
    recorder.start(metadata, 0);
    for (const [labelIndex, start] of [6000, 12000, 18000, 24000, 30000].entries()) {
      recorder.recordFrame(frame(start));
      for (let index = 0; index <= labelIndex; index++) {
        recorder.recordFrame({ ...frame(start + 1 + index), landmarks: [] });
      }
      // Missing frames exactly at transition/end boundaries must not count.
      recorder.recordFrame({ ...frame(start + 3000), landmarks: [] });
    }
    const dataset = exported(recorder);
    expect(dataset.droppedPoseFrameCounts).toEqual({ NEUTRAL: 1, TWIST_LEFT: 2, TWIST_RIGHT: 3, KNEE_LEFT: 4, KNEE_RIGHT: 5 });
    expect(dataset.droppedPoseFrameCount).toBe(15);
    expect(Object.values(dataset.droppedPoseFrameCounts).reduce((sum, n) => sum + n, 0)).toBe(dataset.droppedPoseFrameCount);
    expect(Object.values(dataset.sampleCounts)).toEqual([1, 1, 1, 1, 1]);
    recorder.reset();
    expect(Object.values(recorder.getView(33000).droppedPoseFrameCounts)).toEqual([0, 0, 0, 0, 0]);
  });

  it('stores no frames while idle, preparing, transitioning, or finished', () => {
    const recorder = new PoseDatasetRecorder();
    recorder.recordFrame(frame(0));
    expect(recorder.getView(0).totalSamples).toBe(0);
    recorder.start(metadata, 0);
    for (const time of [0, 4999, 5000, 5999, 9000, 11999, 15000, 17999, 21000, 23999, 27000, 29999]) {
      recorder.recordFrame(frame(time));
    }
    expect(recorder.getView(30000).totalSamples).toBe(0);
    recorder.getView(33000);
    recorder.recordFrame(frame(34000));
    expect(exported(recorder).samples).toEqual([]);
  });

  it('records every inference frame and counts all five labels without UI polling', () => {
    const recorder = new PoseDatasetRecorder();
    recorder.start(metadata, 0);
    for (const start of [6000, 12000, 18000, 24000, 30000]) {
      for (let index = 0; index < 90; index++) recorder.recordFrame(frame(start + index * 1000 / 30));
    }
    expect(recorder.getView(33000).status).toBe('COMPLETED');
    const dataset = exported(recorder);
    expect(dataset.samples).toHaveLength(450);
    expect(dataset.sampleCounts).toEqual({ NEUTRAL: 90, TWIST_LEFT: 90, TWIST_RIGHT: 90, KNEE_LEFT: 90, KNEE_RIGHT: 90 });
    for (const [index, label] of POSE_LABELS.entries()) {
      expect(dataset.samples.slice(index * 90, (index + 1) * 90).every((sample) => sample.label === label)).toBe(true);
    }
    expect(dataset.droppedPoseFrameCount).toBe(0);
  });

  it('snapshots all raw primitives before the source is reused or closed, without filtering low visibility', () => {
    const recorder = new PoseDatasetRecorder();
    recorder.start(metadata, 0);
    const source = frame(6001);
    recorder.recordFrame(source);
    source.landmarks[0].x = 100;
    source.worldLandmarks[0].z = 100;
    source.landmarks.length = 0;
    source.worldLandmarks.length = 0;
    recorder.interrupt();
    const sample = exported(recorder).samples[0];
    expect(sample).toMatchObject({ label: 'NEUTRAL', timestamp: 6001, videoTime: 6.001 });
    expect(sample.landmarks).toHaveLength(33);
    expect(sample.worldLandmarks).toHaveLength(33);
    expect(sample.landmarks[0]).toEqual({ index: 0, x: 0, y: -0.123456789, z: 0, visibility: 0.01 });
    expect(sample.worldLandmarks[0]).toEqual({ index: 0, x: 0, y: 0, z: 0.987654321, visibility: null });
    expect(sample.landmarks[32].index).toBe(32);
  });

  it('keeps coordinates and body-side labels identical for either preview mirror setting', () => {
    const record = (previewMirrored: boolean) => {
      const recorder = new PoseDatasetRecorder();
      recorder.start({ ...metadata, previewMirrored }, 0);
      recorder.recordFrame(frame(12001));
      recorder.interrupt();
      return exported(recorder);
    };
    const mirrored = record(true);
    const unmirrored = record(false);
    expect(mirrored.samples).toEqual(unmirrored.samples);
    expect(mirrored.samples[0].label).toBe('TWIST_LEFT');
    expect(mirrored.previewMirrored).toBe(true);
    expect(unmirrored.previewMirrored).toBe(false);
  });

  it('counts missing poses only during recording, while retaining poses without world landmarks', () => {
    const recorder = new PoseDatasetRecorder();
    recorder.start(metadata, 0);
    const missing = (timestamp: number) => ({ timestamp, videoTime: 0, landmarks: [], worldLandmarks: [] });
    recorder.recordFrame(missing(1000));
    recorder.recordFrame(missing(6000));
    recorder.recordFrame(missing(7000));
    recorder.recordFrame(missing(9000));
    recorder.recordFrame({ ...frame(12000), worldLandmarks: [] });
    recorder.getView(33000);
    const dataset = exported(recorder);
    expect(dataset.droppedPoseFrameCount).toBe(2);
    expect(dataset.samples).toHaveLength(1);
    expect(dataset.samples[0].worldLandmarks).toEqual([]);
    expect(dataset.sampleCounts.TWIST_LEFT).toBe(1);
  });

  it('uses exact stage boundaries and completes after 33 seconds even if timer ticks are delayed', () => {
    expect(GUIDED_SEQUENCE.reduce((sum, stage) => sum + stage.durationMs, 0)).toBe(33000);
    const recorder = new PoseDatasetRecorder();
    recorder.start(metadata, 100);
    expect(recorder.getView(1100)).toMatchObject({ remainingMs: 4000, stage: { phase: 'PREPARE' } });
    expect(recorder.getView(5100)).toMatchObject({ remainingMs: 1000, stage: { phase: 'STABILIZE' } });
    expect(recorder.getView(6100)).toMatchObject({ remainingMs: 3000, stage: { label: 'NEUTRAL' } });
    expect(recorder.getView(9100)).toMatchObject({ remainingMs: 3000, stage: { phase: 'TRANSITION', nextLabel: 'TWIST_LEFT' } });
    expect(recorder.getView(12100)).toMatchObject({ remainingMs: 3000, stage: { label: 'TWIST_LEFT' } });
    expect(recorder.getView(40000)).toMatchObject({ status: 'COMPLETED', stage: null, remainingMs: 0 });
  });

  it('preserves partial data on interruption and exports explicit metadata and status', () => {
    const recorder = new PoseDatasetRecorder();
    expect(() => recorder.exportJson()).toThrow();
    recorder.start(metadata, 0);
    recorder.recordFrame(frame(6000));
    expect(() => recorder.exportJson()).toThrow();
    recorder.interrupt();
    recorder.recordFrame(frame(7000));
    expect(exported(recorder)).toMatchObject({
      ...metadata, status: 'INTERRUPTED', droppedPoseFrameCount: 0,
      sampleCounts: { NEUTRAL: 1, TWIST_LEFT: 0, TWIST_RIGHT: 0, KNEE_LEFT: 0, KNEE_RIGHT: 0 },
    });
    expect(exported(recorder).samples).toHaveLength(1);
    expect(recorder.start(metadata, 8000)).toBe(false);
  });

  it('resets samples, counts, phase, and metadata and allows a fresh sequence', () => {
    const recorder = new PoseDatasetRecorder();
    recorder.start(metadata, 0);
    recorder.recordFrame(frame(6000));
    recorder.recordFrame({ ...frame(6010), landmarks: [] });
    recorder.reset();
    recorder.recordFrame(frame(6500));
    expect(recorder.getView(6500)).toMatchObject({ status: 'IDLE', stage: null, totalSamples: 0, droppedPoseFrameCount: 0, createdAt: null });
    expect(Object.values(recorder.getView(6500).sampleCounts)).toEqual([0, 0, 0, 0, 0]);
    expect(() => recorder.exportJson()).toThrow();
    expect(recorder.start({ ...metadata, delegate: 'CPU' }, 7000)).toBe(true);
    expect(recorder.getView(7000).stage?.phase).toBe('PREPARE');
  });
});
