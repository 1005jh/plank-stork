/** Compact debug/test snapshots only; these are not game input events. */
export type KneeKickDirection = 'KNEE_LEFT' | 'KNEE_RIGHT';
export type KneeKickState = 'NOT_READY' | 'ARMED' | 'CANDIDATE' | 'TRIGGERED_LEFT' | 'TRIGGERED_RIGHT' | 'WAIT_RETURN' | 'WAIT_CLEAR';
export interface KneeKickEvent { id: number; direction: KneeKickDirection; timestamp: number }
export interface RemoteKneeKickState {
  ready: boolean;
  /** A frame arrived within 400ms and at least one knee has usable Kick geometry/visibility. */
  validNow: boolean;
  usableLeftNow: boolean;
  usableRightNow: boolean;
  state: KneeKickState;
  currentEvent: KneeKickDirection | 'NONE';
  lastEvent: KneeKickEvent | null;
  counts: Record<KneeKickDirection, number>;
}
export type DetectorTestExpected = 'NEUTRAL' | 'TWIST_LEFT' | 'TWIST_RIGHT' | KneeKickDirection;
export interface DetectorTestSummary {
  TWIST_LEFT: { falseKickCount: number };
  TWIST_RIGHT: { falseKickCount: number };
  NEUTRAL: { falseKickCount: number };
  KNEE_LEFT: { detected: boolean; directionCorrect: boolean | null; wrongEventCount: number; duplicateCount: number };
  KNEE_RIGHT: { detected: boolean; directionCorrect: boolean | null; wrongEventCount: number; duplicateCount: number };
}
export interface RemoteDetectorTestState {
  status: 'IDLE' | 'ACTIVE' | 'COMPLETED' | 'INTERRUPTED';
  expected: DetectorTestExpected | null;
  remainingMs: number;
  waitingForArmed: boolean;
  eventCount: number;
  summary: DetectorTestSummary | null;
}
