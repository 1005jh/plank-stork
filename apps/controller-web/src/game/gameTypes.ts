import type { ControlDirection, GameTestProvenance } from '@plank-stork/protocol';

// Reuse the shared direction vocabulary without changing its Socket test contract.
export type GameAction = `${ControlDirection}_ACTION`;
export type GameStatus = 'IDLE' | 'RUNNING' | 'COMPLETED';
export const GAME_TARGETS: readonly GameAction[] = Object.freeze([
  'LEFT_ACTION', 'RIGHT_ACTION', 'LEFT_ACTION', 'RIGHT_ACTION',
]);
export const KEYBOARD_TEST_PROVENANCE = Object.freeze({ kind: 'TEST', method: 'KEYBOARD' } as const);
export const SCRIPT_TEST_PROVENANCE = Object.freeze({ kind: 'TEST', method: 'SCRIPT' } as const);

export interface GameInput {
  readonly runId: string;
  readonly sourceInstanceId: string;
  /** Positive safe integer; strictly greater than the last admitted sequence. Gaps are allowed. */
  readonly sequence: number;
  /** Caller-owned monotonic clock, same domain as GameRun.startedAtMs. Finite and >= 0.
   * Equal timestamps are allowed (clock resolution); sequence breaks ties. No time reversal.
   */
  readonly occurredAtMs: number;
  readonly action: GameAction;
  readonly provenance: GameTestProvenance;
}

/** Only the local game owner can register a run/source. This is not a wire/authentication API. */
export interface GameRun {
  readonly runId: string;
  readonly sourceInstanceId: string;
  readonly startedAtMs: number;
  /** Omitted only for existing STEP 4U KEYBOARD registrations. Fixed for the entire run. */
  readonly provenance?: GameTestProvenance;
}

export interface GameActionRecord {
  readonly input: GameInput;
  readonly target: GameAction;
  readonly outcome: 'CORRECT' | 'WRONG';
}

export type GameRejectReason =
  | 'ALREADY_RUNNING' | 'INVALID_START' | 'REUSED_RUN_ID'
  | 'NOT_RUNNING' | 'INVALID_INPUT' | 'RUN_MISMATCH' | 'UNREGISTERED_SOURCE'
  | 'UNSUPPORTED_PROVENANCE' | 'INVALID_ACTION' | 'INVALID_SEQUENCE'
  | 'SEQUENCE_NOT_INCREASING' | 'INVALID_TIMESTAMP' | 'TIMESTAMP_BEFORE_START' | 'TIME_REVERSAL';

export interface GameState {
  readonly status: GameStatus;
  readonly run: GameRun | null;
  readonly score: number;
  readonly targetIndex: number;
  readonly history: readonly GameActionRecord[];
  readonly lastAcceptedSequence: number;
  readonly lastAcceptedAtMs: number | null;
  readonly lastRejectReason: GameRejectReason | null;
  /** Page-local retired IDs survive Reset, so an old run cannot be registered again. */
  readonly usedRunIds: readonly string[];
}

export type GameEvent =
  | { readonly type: 'START'; readonly run: GameRun }
  | { readonly type: 'RESET' }
  // Validate both local TEST adapters at the same pure core boundary.
  | { readonly type: 'INPUT'; readonly input: unknown };
