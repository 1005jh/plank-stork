import type { DetectorTestExpected, DetectorTestSummary, KneeKickEvent, RemoteDetectorTestState } from '@plank-stork/protocol';

export const DETECTOR_TEST_SEQUENCE: readonly { expected: DetectorTestExpected; durationMs: number }[] = [
  { expected: 'NEUTRAL', durationMs: 2000 },
  ...(['TWIST_LEFT', 'TWIST_RIGHT', 'KNEE_LEFT', 'KNEE_RIGHT'] as const).flatMap((expected) => [
    { expected, durationMs: 3000 }, { expected: 'NEUTRAL' as const, durationMs: 2000 },
  ]),
];
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

  start(now: number, ready: boolean): boolean {
    if (!ready || this.status === 'ACTIVE') return false;
    this.reset(); this.startedAt = now; this.status = 'ACTIVE';
    this.stages = DETECTOR_TEST_SEQUENCE.map(({ expected }) => ({ expected, events: [], wrongEventCount: 0, duplicateCount: 0 }));
    return true;
  }
  private stageAt(now: number): { index: number; remainingMs: number } | null {
    if (this.startedAt === null || now < this.startedAt) return null;
    let elapsed = now - this.startedAt;
    for (const [index, stage] of DETECTOR_TEST_SEQUENCE.entries()) {
      if (elapsed < stage.durationMs) return { index, remainingMs: stage.durationMs - elapsed };
      elapsed -= stage.durationMs;
    }
    return null;
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
  getView(now: number): RemoteDetectorTestState {
    const current = this.status === 'ACTIVE' ? this.stageAt(now) : null;
    if (this.status === 'ACTIVE' && !current && this.startedAt !== null && now >= this.startedAt) this.status = 'COMPLETED';
    return { status: this.status, expected: current ? this.stages[current.index].expected : null, remainingMs: current?.remainingMs ?? 0,
      eventCount: this.seen.size, summary: this.status === 'COMPLETED' ? this.summary() : null };
  }
  getStages(): DetectorTestStage[] { return this.stages.map((stage) => ({ ...stage, events: stage.events.map((event) => ({ ...event })) })); }
  reset(): void { this.startedAt = null; this.status = 'IDLE'; this.stages = []; this.seen.clear(); }
}
