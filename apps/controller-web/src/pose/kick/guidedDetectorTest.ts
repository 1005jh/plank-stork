import type { DetectorTestExpected, DetectorTestSummary, KneeKickEvent, RemoteDetectorTestState } from '@plank-stork/protocol';
import { diagnosticConfig, summarizeKickDiagnostics, type KickDiagnosticDataset, type KickDiagnosticInput, type KickDiagnosticMetadata, type KickDetectorDiagnosticFrame } from './kneeKickDiagnostics';

export const DETECTOR_TEST_SEQUENCE: readonly { expected: DetectorTestExpected; durationMs: number }[] = [
  { expected: 'NEUTRAL', durationMs: 2000 },
  ...(['TWIST_LEFT', 'TWIST_RIGHT', 'KNEE_LEFT', 'KNEE_RIGHT'] as const).flatMap((expected) => [
    { expected, durationMs: 3000 }, { expected: 'NEUTRAL' as const, durationMs: 2000 },
  ]),
];
export interface DetectorStageTiming { stageIndex: number; expected: DetectorTestExpected; startedAt: number | null; endedAt: number | null; armedWaitMs: number }
export interface DetectorTestStage {
  expected: DetectorTestExpected;
  events: KneeKickEvent[];
  wrongEventCount: number;
  duplicateCount: number;
}

/** All events, including movement/return mistakes, belong to the stage active at their timestamp. */
export class GuidedDetectorTest {
  private startedAt: number | null = null;
  private status: RemoteDetectorTestState['status'] = 'IDLE';
  private stages: DetectorTestStage[] = [];
  private seen = new Set<number>();
  private currentStageIndex = 0;
  private timings: DetectorStageTiming[] = [];
  private lastAdvancedAt = 0;
  private diagnosticFrames: KickDetectorDiagnosticFrame[] = [];
  private diagnosticMetadata: KickDiagnosticMetadata | null = null;

  start(now: number, ready: boolean): boolean {
    if (!ready || this.status === 'ACTIVE') return false;
    this.reset(); this.startedAt = now; this.status = 'ACTIVE';
    this.stages = DETECTOR_TEST_SEQUENCE.map(({ expected }) => ({ expected, events: [], wrongEventCount: 0, duplicateCount: 0 }));
    this.timings = DETECTOR_TEST_SEQUENCE.map(({ expected }, stageIndex) => ({ stageIndex, expected, startedAt: stageIndex === 0 ? now : null, endedAt: null, armedWaitMs: 0 }));
    this.lastAdvancedAt = now;
    return true;
  }
  /** Called before processing a frame and by the controller UI clock; never by the phone. */
  advance(now: number, _canAdvanceNeutral: boolean): void {
    if (this.status !== 'ACTIVE' || now < this.lastAdvancedAt) return;
    this.lastAdvancedAt = now;
    while (this.status === 'ACTIVE') {
      const stage = DETECTOR_TEST_SEQUENCE[this.currentStageIndex];
      const timing = this.timings[this.currentStageIndex];
      const deadline = timing.startedAt! + stage.durationMs;
      if (now < deadline) return;
      // Measurement time never depends on detector readiness or pose availability.
      timing.endedAt = deadline;
      timing.armedWaitMs = 0;
      this.currentStageIndex += 1;
      if (this.currentStageIndex === DETECTOR_TEST_SEQUENCE.length) { this.status = 'COMPLETED'; return; }
      this.timings[this.currentStageIndex].startedAt = timing.endedAt;
    }
  }
  private stageAt(now: number): { index: number; remainingMs: number } | null {
    if (this.startedAt === null || now < this.startedAt) return null;
    const timing = this.timings.find((stage) => stage.startedAt !== null && now >= stage.startedAt && (stage.endedAt === null || now < stage.endedAt));
    if (!timing) return null;
    return { index: timing.stageIndex, remainingMs: Math.max(0, timing.startedAt! + DETECTOR_TEST_SEQUENCE[timing.stageIndex].durationMs - now) };
  }
  record(event: KneeKickEvent | null): void {
    if (!event || this.status !== 'ACTIVE' || this.seen.has(event.id)) return;
    const current = this.stageAt(event.timestamp);
    if (!current) return;
    this.seen.add(event.id);
    const stage = this.stages[current.index];
    stage.events.push({ ...event });
    if (event.direction !== stage.expected) stage.wrongEventCount += 1;
    stage.duplicateCount = Math.max(0, stage.events.length - 1);
  }
  beginDiagnostics(metadata: KickDiagnosticMetadata): void {
    if (this.status !== 'ACTIVE') return;
    // Detached start-time snapshots; no live baseline or camera object is retained.
    this.diagnosticMetadata = structuredClone(metadata);
  }
  recordDiagnosticFrame(frame: KickDiagnosticInput): void {
    if (this.status !== 'ACTIVE') return;
    const current = this.stageAt(frame.timestamp);
    if (!current) return;
    // Explicit primitive allow-list, including missing/stale frames and only NEW events.
    this.diagnosticFrames.push({
      timestamp: frame.timestamp, stageIndex: current.index, expected: this.stages[current.index].expected,
      poseFresh: frame.poseFresh, usableLeft: frame.usableLeft, usableRight: frame.usableRight,
      inferenceGapMs: frame.inferenceGapMs, neutralSmoothedValidNow: frame.neutralSmoothedValidNow,
      kickHipsUsable: frame.kickHipsUsable, kickLeftUsable: frame.kickLeftUsable, kickRightUsable: frame.kickRightUsable,
      kickValidityReasons: [...frame.kickValidityReasons],
      rawLeftHipVisibility: frame.rawLeftHipVisibility, rawRightHipVisibility: frame.rawRightHipVisibility,
      rawLeftKneeVisibility: frame.rawLeftKneeVisibility, rawRightKneeVisibility: frame.rawRightKneeVisibility,
      rawHipCenterX: frame.rawHipCenterX, rawLeftKneeX: frame.rawLeftKneeX, rawRightKneeX: frame.rawRightKneeX,
      rawLeftKneeCenterOffsetX: frame.rawLeftKneeCenterOffsetX, rawRightKneeCenterOffsetX: frame.rawRightKneeCenterOffsetX,
      rawLeftKneeHipDistance: frame.rawLeftKneeHipDistance, rawRightKneeHipDistance: frame.rawRightKneeHipDistance,
      stateBefore: frame.stateBefore, stateAfter: frame.stateAfter,
      hipCenterX: frame.hipCenterX, hipWidth: frame.hipWidth,
      leftKneeVisibility: frame.leftKneeVisibility, rightKneeVisibility: frame.rightKneeVisibility,
      normalizedLeft: frame.normalizedLeft, normalizedRight: frame.normalizedRight,
      dominantNormalizedDisplacement: frame.dominantNormalizedDisplacement,
      normalizedLeftVelocity: frame.normalizedLeftVelocity, normalizedRightVelocity: frame.normalizedRightVelocity,
      candidateId: frame.candidateId, candidateActive: frame.candidateActive, candidateStartedAt: frame.candidateStartedAt, candidateAgeMs: frame.candidateAgeMs,
      candidatePositivePeak: frame.candidatePositivePeak, candidateNegativePeak: frame.candidateNegativePeak, candidatePeakAbsVelocity: frame.candidatePeakAbsVelocity,
      candidateSawLeft: frame.candidateSawLeft, candidateSawRight: frame.candidateSawRight, candidateFrameCount: frame.candidateFrameCount,
      candidateStrongestMagnitude: frame.candidateStrongestMagnitude, candidateDirectionMargin: frame.candidateDirectionMargin,
      candidateOutcome: frame.candidateOutcome, candidateEndedAt: frame.candidateEndedAt, confirmationLatencyMs: frame.confirmationLatencyMs,
      event: frame.event ? { id: frame.event.id, direction: frame.event.direction, timestamp: frame.event.timestamp } : null,
    });
  }
  getDiagnosticSummary() {
    return this.status === 'COMPLETED' ? summarizeKickDiagnostics(this.diagnosticFrames, this.stages) : [];
  }
  exportDiagnosticsJson(): string {
    if (this.status !== 'COMPLETED' || !this.diagnosticMetadata) throw new Error('Guided Detector Test 완료 후 진단 JSON을 다운로드할 수 있습니다.');
    const dataset: KickDiagnosticDataset = {
      version: 3, ...this.diagnosticMetadata, detectorConfig: diagnosticConfig(),
      sequence: DETECTOR_TEST_SEQUENCE.map((stage) => ({ ...stage })), stageTimings: this.timings.map((stage) => ({ ...stage })), frames: this.diagnosticFrames,
      stageSummaries: this.getDiagnosticSummary(), existingGuidedSummary: this.summary(),
    };
    return JSON.stringify(dataset, null, 2);
  }
  private summary(): DetectorTestSummary {
    const count = (expected: DetectorTestExpected) => this.stages.filter((stage) => stage.expected === expected).flatMap((stage) => stage.events);
    const knee = (expected: 'KNEE_LEFT' | 'KNEE_RIGHT') => {
      const events = count(expected);
      return { detected: events.length > 0, directionCorrect: events.length ? events.every((event) => event.direction === expected) : null,
        wrongEventCount: events.filter((event) => event.direction !== expected).length, duplicateCount: Math.max(0, events.length - 1) };
    };
    return { TWIST_LEFT: { falseKickCount: count('TWIST_LEFT').length }, TWIST_RIGHT: { falseKickCount: count('TWIST_RIGHT').length },
      NEUTRAL: { falseKickCount: count('NEUTRAL').length }, KNEE_LEFT: knee('KNEE_LEFT'), KNEE_RIGHT: knee('KNEE_RIGHT') };
  }
  getView(now: number, _canAdvanceNeutral: boolean): RemoteDetectorTestState {
    this.advance(now, _canAdvanceNeutral);
    const current = this.status === 'ACTIVE' ? this.stageAt(now) : null;
    const expected = current ? this.stages[current.index].expected : null;
    return { status: this.status, expected, remainingMs: current?.remainingMs ?? 0,
      waitingForArmed: false,
      eventCount: this.seen.size, summary: this.status === 'COMPLETED' ? this.summary() : null };
  }
  getStages(): DetectorTestStage[] { return this.stages.map((stage) => ({ ...stage, events: stage.events.map((event) => ({ ...event })) })); }
  reset(): void {
    this.startedAt = null; this.status = 'IDLE'; this.stages = []; this.seen.clear();
    this.diagnosticFrames = []; this.diagnosticMetadata = null; this.timings = []; this.currentStageIndex = 0; this.lastAdvancedAt = 0;
  }
}
