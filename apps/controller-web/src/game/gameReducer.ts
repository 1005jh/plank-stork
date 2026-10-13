import {
  GAME_TARGETS, KEYBOARD_TEST_PROVENANCE, SCRIPT_TEST_PROVENANCE,
  type GameEvent, type GameInput, type GameRejectReason, type GameState,
} from './gameTypes';

export function createInitialGameState(): GameState {
  return { status: 'IDLE', run: null, score: 0, targetIndex: 0, history: [],
    lastAcceptedSequence: 0, lastAcceptedAtMs: null, lastRejectReason: null, usedRunIds: [] };
}

const reject = (state: GameState, reason: GameRejectReason): GameState => ({ ...state, lastRejectReason: reason });
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Pure local authority: no DOM, clock/ID generation, transport, camera or detector dependencies.
 * Admission precedes scoring. Valid WRONG actions consume sequence/time and create history too;
 * rejected inputs change only diagnostics and cannot poison the admitted sequence/clock cursor.
 */
export function gameReducer(state: GameState, event: GameEvent): GameState {
  if (event.type === 'RESET') return { ...createInitialGameState(), usedRunIds: state.usedRunIds };
  if (event.type === 'START') {
    if (state.status === 'RUNNING') return reject(state, 'ALREADY_RUNNING');
    const run = event.run;
    if (!run || !validId(run.runId) || !validId(run.sourceInstanceId) || !validTime(run.startedAtMs)) return reject(state, 'INVALID_START');
    if (run.provenance !== undefined && (!isObject(run.provenance) || run.provenance.kind !== 'TEST' ||
        (run.provenance.method !== 'KEYBOARD' && run.provenance.method !== 'SCRIPT'))) return reject(state, 'INVALID_START');
    if (state.usedRunIds.includes(run.runId)) return reject(state, 'REUSED_RUN_ID');
    return { ...createInitialGameState(), status: 'RUNNING',
      run: { runId: run.runId, sourceInstanceId: run.sourceInstanceId, startedAtMs: run.startedAtMs,
        ...(run.provenance ? { provenance: run.provenance.method === 'SCRIPT' ? SCRIPT_TEST_PROVENANCE : KEYBOARD_TEST_PROVENANCE } : {}) },
      usedRunIds: [...state.usedRunIds, run.runId] };
  }

  if (state.status !== 'RUNNING' || !state.run) return reject(state, 'NOT_RUNNING');
  const input = event.input;
  if (!isObject(input)) return reject(state, 'INVALID_INPUT');
  if (input.runId !== state.run.runId) return reject(state, 'RUN_MISMATCH');
  if (input.sourceInstanceId !== state.run.sourceInstanceId) return reject(state, 'UNREGISTERED_SOURCE');
  const provenance = input.provenance;
  const registered = state.run.provenance ?? KEYBOARD_TEST_PROVENANCE;
  if (!isObject(provenance) || provenance.kind !== 'TEST' || provenance.method !== registered.method) return reject(state, 'UNSUPPORTED_PROVENANCE');
  if (input.action !== 'LEFT_ACTION' && input.action !== 'RIGHT_ACTION') return reject(state, 'INVALID_ACTION');
  if (typeof input.sequence !== 'number' || !Number.isSafeInteger(input.sequence) || input.sequence <= 0) return reject(state, 'INVALID_SEQUENCE');
  if (input.sequence <= state.lastAcceptedSequence) return reject(state, 'SEQUENCE_NOT_INCREASING');
  if (!validTime(input.occurredAtMs)) return reject(state, 'INVALID_TIMESTAMP');
  if (input.occurredAtMs < state.run.startedAtMs) return reject(state, 'TIMESTAMP_BEFORE_START');
  if (state.lastAcceptedAtMs !== null && input.occurredAtMs < state.lastAcceptedAtMs) return reject(state, 'TIME_REVERSAL');

  // Snapshot only admitted primitives; never retain the caller's mutable object/extra fields.
  const admitted: GameInput = { runId: input.runId, sourceInstanceId: input.sourceInstanceId,
    sequence: input.sequence, occurredAtMs: input.occurredAtMs, action: input.action,
    provenance: registered };
  const target = GAME_TARGETS[state.targetIndex], correct = admitted.action === target;
  const targetIndex = state.targetIndex + (correct ? 1 : 0);
  return { ...state, status: targetIndex === GAME_TARGETS.length ? 'COMPLETED' : 'RUNNING',
    score: state.score + (correct ? 1 : 0), targetIndex,
    history: [...state.history, { input: admitted, target, outcome: correct ? 'CORRECT' : 'WRONG' }],
    lastAcceptedSequence: admitted.sequence, lastAcceptedAtMs: admitted.occurredAtMs, lastRejectReason: null };
}
