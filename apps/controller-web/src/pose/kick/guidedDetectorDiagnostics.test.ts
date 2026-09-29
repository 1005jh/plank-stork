// @vitest-environment node
import { emptyCandidate, frameValidity, advanceUnblockedTest } from './testFixtures';
import { describe, expect, it } from 'vitest';
import { DETECTOR_TEST_SEQUENCE, GuidedDetectorTest } from './guidedDetectorTest';
import type { KickDiagnosticDataset, KickDiagnosticInput, KickDiagnosticMetadata } from './kneeKickDiagnostics';

const input = (timestamp: number): KickDiagnosticInput => ({
  ...emptyCandidate(), ...frameValidity(false), timestamp, poseFresh: false, usableLeft: false, usableRight: false,
  stateBefore: 'WAIT_RETURN', stateAfter: 'WAIT_RETURN', hipCenterX: null, hipWidth: null, leftKneeVisibility: null, rightKneeVisibility: null,
  normalizedLeft: null, normalizedRight: null, dominantNormalizedDisplacement: null, normalizedLeftVelocity: null, normalizedRightVelocity: null, event: null,
});
const metadata = (): KickDiagnosticMetadata => ({ createdAt: '2026-09-26T00:00:00.000Z', startedAt: 0,
  baseline: { detector: { leftMedian: -0.15, rightMedian: 0.15, leftDistanceMedian: 0.3, rightDistanceMedian: 0.3, bodyScale: 0.3 }, diagnostics: null },
  testStart: { detectorState: 'WAIT_RETURN', ready: true, valid: true } });
const read = (test: GuidedDetectorTest) => JSON.parse(test.exportDiagnosticsJson()) as KickDiagnosticDataset;

describe('guided diagnostic frame storage and export', () => {
  it('only stores ACTIVE inference frames and attributes exact sequence boundaries with existing timing', () => {
    const test = new GuidedDetectorTest();
    test.recordDiagnosticFrame(input(0));
    expect(() => test.exportDiagnosticsJson()).toThrow();
    test.start(0, true); test.beginDiagnostics(metadata());
    test.recordDiagnosticFrame(input(-1));
    let now = 0;
    const expected: { timestamp: number; stageIndex: number; expected: string }[] = [];
    for (const [stageIndex, stage] of DETECTOR_TEST_SEQUENCE.entries()) {
      for (const timestamp of [now, now + stage.durationMs - 1]) {
        advanceUnblockedTest(test, timestamp); test.recordDiagnosticFrame(input(timestamp)); expected.push({ timestamp, stageIndex, expected: stage.expected });
      }
      now += stage.durationMs;
    }
    advanceUnblockedTest(test, now); test.recordDiagnosticFrame(input(now)); // End-exclusive, even before the UI tick completes the test.
    test.getView(now, true);
    test.recordDiagnosticFrame(input(now + 1));
    const dataset = read(test);
    expect(dataset.frames.map(({ timestamp, stageIndex, expected }) => ({ timestamp, stageIndex, expected }))).toEqual(expected);
    expect(dataset.frames).toHaveLength(18);
    expect(dataset.stageSummaries.every((stage) => stage.staleFrames === 2 && stage.totalFrames === 2)).toBe(true);
  });

  it('snapshots only allowed derived primitives and preserves the existing guided summary', () => {
    const test = new GuidedDetectorTest(); test.start(0, true);
    const context = metadata(); test.beginDiagnostics(context);
    context.baseline.detector!.bodyScale = 100; context.testStart.detectorState = 'ARMED';
    const event = { id: 5, direction: 'KNEE_LEFT' as const, timestamp: 12500 };
    const frame = { ...input(12500), event, landmarks: [{ x: 123 }], worldLandmarks: [{ z: 99 }], video: 'forbidden' };
    advanceUnblockedTest(test, 12500); test.recordDiagnosticFrame(frame); test.record(event);
    frame.timestamp = 999; event.id = 100; frame.kickValidityReasons.length = 0;
    const existing = advanceUnblockedTest(test, 22000).summary;
    const dataset = read(test);
    expect(dataset).toMatchObject({ version: 3, createdAt: '2026-09-26T00:00:00.000Z',
      detectorConfig: { enterDisplacement: 0.28, exitDisplacement: 0.15, returnDwellMs: 180, hipVisibility: 0.7, kneeVisibility: 0.5, staleMs: 400 },
      baseline: { detector: { bodyScale: 0.3 } }, testStart: { detectorState: 'WAIT_RETURN', ready: true, valid: true } });
    expect(dataset.frames[0]).toMatchObject({ timestamp: 12500, event: { id: 5 }, stageIndex: 5, expected: 'KNEE_LEFT' });
    expect(dataset.frames[0].kickValidityReasons).toContain('NO_LANDMARKS');
    expect(dataset.existingGuidedSummary).toEqual(existing);
    expect(test.exportDiagnosticsJson()).not.toMatch(/"(?:landmarks|worldLandmarks|video|image)"/i);
    function serializable(value: unknown): void {
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
      if (typeof value === 'number') { expect(Number.isFinite(value)).toBe(true); return; }
      expect(typeof value).toBe('object');
      Object.values(value as object).forEach(serializable);
    }
    serializable(dataset);
    dataset.frames[0].event!.id = 88;
    expect(read(test).frames[0].event!.id).toBe(5);
  });

  it('clears diagnostic frames/metadata on reset and successful restart; rejected starts preserve them', () => {
    const test = new GuidedDetectorTest(); test.start(0, true); test.beginDiagnostics(metadata());
    test.recordDiagnosticFrame(input(100));
    expect(test.start(500, true)).toBe(false);
    advanceUnblockedTest(test, 22000); expect(read(test).frames).toHaveLength(1);
    expect(test.start(23000, false)).toBe(false); expect(read(test).frames).toHaveLength(1);
    expect(test.start(23000, true)).toBe(true);
    test.beginDiagnostics({ ...metadata(), startedAt: 23000 });
    advanceUnblockedTest(test, 45000, 23000); expect(read(test).frames).toEqual([]);
    expect(read(test).stageSummaries.every((row) => row.stateAtStageStart === null)).toBe(true);
    test.reset(); expect(test.getDiagnosticSummary()).toEqual([]); expect(() => test.exportDiagnosticsJson()).toThrow();
  });
  it('exports fixed deadlines even with unavailable input and delayed ticks', () => {
    const test = new GuidedDetectorTest(); test.start(0, true); test.beginDiagnostics(metadata());
    test.advance(2500, false); test.recordDiagnosticFrame(input(2500));
    test.advance(3000, true); test.recordDiagnosticFrame(input(3000));
    test.record({ id: 1, direction: 'KNEE_LEFT', timestamp: 3000 });
    test.advance(6000, false); test.recordDiagnosticFrame(input(6000));
    test.advance(8000, false);
    for (const time of [9000, 12000, 14000, 17000, 19000, 22000]) test.advance(time, true);
    test.advance(24000, false); test.recordDiagnosticFrame(input(24000));
    expect(test.getView(24999, false).status).toBe('COMPLETED');
    test.advance(25000, true);
    const dataset = read(test);
    expect(dataset.frames.map((frame) => frame.stageIndex)).toEqual([1, 1, 2]);
    expect(dataset.stageTimings[0]).toMatchObject({ startedAt: 0, endedAt: 2000, armedWaitMs: 0 });
    expect(dataset.stageTimings[2]).toMatchObject({ startedAt: 5000, endedAt: 7000, armedWaitMs: 0 });
    expect(dataset.stageTimings[8]).toMatchObject({ startedAt: 20000, endedAt: 22000, armedWaitMs: 0 });
    expect(dataset.stageSummaries[1].eventDirections).toEqual(['KNEE_LEFT']);
  });
});
