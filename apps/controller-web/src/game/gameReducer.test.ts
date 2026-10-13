// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createInitialGameState, gameReducer } from './gameReducer';
import { GAME_TARGETS, KEYBOARD_TEST_PROVENANCE, type GameEvent, type GameInput, type GameState } from './gameTypes';

const run = { runId: 'run-1', sourceInstanceId: 'keyboard-1', startedAtMs: 100 };
const start = (): GameState => gameReducer(createInitialGameState(), { type: 'START', run });
const input = (overrides: Partial<GameInput> = {}): GameInput => ({ ...run, sequence: 1, occurredAtMs: 100,
  action: 'LEFT_ACTION', provenance: KEYBOARD_TEST_PROVENANCE, ...overrides });
const send = (state: GameState, value: unknown): GameState => gameReducer(state, { type: 'INPUT', input: value });
const completed = () => GAME_TARGETS.reduce((state, action, i) => send(state, input({ action, sequence: i + 1, occurredAtMs: 100 + i })), start());
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

describe('local pure game core', () => {
  it('starts IDLE and rejects input without creating action history', () => {
    const before = createInitialGameState(), after = send(before, input());
    expect(before).toMatchObject({ status: 'IDLE', run: null, score: 0, targetIndex: 0, history: [] });
    expect(after).toEqual({ ...before, lastRejectReason: 'NOT_RUNNING' });
  });

  it('registers only the caller-provided source/run/clock and starts at LEFT', () => {
    const state = start();
    expect(state).toMatchObject({ status: 'RUNNING', run, score: 0, targetIndex: 0, history: [], usedRunIds: ['run-1'] });
    expect(state.run).not.toBe(run);
    expect(GAME_TARGETS).toEqual(['LEFT_ACTION', 'RIGHT_ACTION', 'LEFT_ACTION', 'RIGHT_ACTION']);
  });

  it('gives one point and advances exactly one target for a correct action', () => {
    const state = send(start(), input());
    expect(state).toMatchObject({ status: 'RUNNING', score: 1, targetIndex: 1, lastAcceptedSequence: 1, lastAcceptedAtMs: 100 });
    expect(state.history).toEqual([{ input: { runId: run.runId, sourceInstanceId: run.sourceInstanceId, sequence: 1,
      occurredAtMs: 100, action: 'LEFT_ACTION', provenance: KEYBOARD_TEST_PROVENANCE }, target: 'LEFT_ACTION', outcome: 'CORRECT' }]);
    expect(GAME_TARGETS[state.targetIndex]).toBe('RIGHT_ACTION');
  });

  it('records an admitted wrong answer without advancing score/target, consuming its sequence', () => {
    const wrong = input({ action: 'RIGHT_ACTION' }), state = send(start(), wrong);
    expect(state).toMatchObject({ score: 0, targetIndex: 0, lastAcceptedSequence: 1, lastAcceptedAtMs: 100 });
    expect(state.history[0]).toMatchObject({ target: 'LEFT_ACTION', outcome: 'WRONG' });
    expect(send(state, wrong)).toEqual({ ...state, lastRejectReason: 'SEQUENCE_NOT_INCREASING' });
    const correct = send(state, input({ sequence: 2, occurredAtMs: 110 }));
    expect(correct.score).toBe(1);
    expect(correct.history.map((r) => r.outcome)).toEqual(['WRONG', 'CORRECT']);
  });

  it('completes after four correct inputs and rejects all subsequent inputs', () => {
    const state = completed();
    expect(state).toMatchObject({ status: 'COMPLETED', score: 4, targetIndex: 4 });
    expect(state.history.map((r) => r.target)).toEqual(GAME_TARGETS);
    expect(send(state, input({ sequence: 5, occurredAtMs: 104 }))).toEqual({ ...state, lastRejectReason: 'NOT_RUNNING' });
  });

  it('refuses duplicate Start even after progress and accepts a new run after completion', () => {
    const state = send(start(), input());
    expect(gameReducer(state, { type: 'START', run: { ...run, runId: 'other' } })).toEqual({ ...state, lastRejectReason: 'ALREADY_RUNNING' });
    const next = gameReducer(completed(), { type: 'START', run: { ...run, runId: 'run-2', startedAtMs: 200 } });
    expect(next).toMatchObject({ status: 'RUNNING', score: 0, targetIndex: 0, history: [], lastAcceptedSequence: 0,
      run: { ...run, runId: 'run-2', startedAtMs: 200 } });
  });

  it('reset clears play/feedback/cursors but remembers retired IDs across later runs', () => {
    const first = send(start(), input());
    const reset = gameReducer(first, { type: 'RESET' });
    expect(reset).toEqual({ ...createInitialGameState(), usedRunIds: ['run-1'] });
    expect(send(reset, input({ sequence: 2 }))).toEqual({ ...reset, lastRejectReason: 'NOT_RUNNING' });
    expect(gameReducer(reset, { type: 'START', run }).lastRejectReason).toBe('REUSED_RUN_ID');
    const next = gameReducer(reset, { type: 'START', run: { ...run, runId: 'run-2' } });
    expect(send(next, input({ sequence: 99 }))).toEqual({ ...next, lastRejectReason: 'RUN_MISMATCH' });
    expect(send(next, input({ runId: 'run-2' })).score).toBe(1);
    const resetAgain = gameReducer(next, { type: 'RESET' });
    expect(gameReducer(resetAgain, { type: 'START', run }).lastRejectReason).toBe('REUSED_RUN_ID');
  });

  it.each([
    { ...run, runId: '' }, { ...run, runId: ' ' }, { ...run, sourceInstanceId: '' },
    { ...run, startedAtMs: NaN }, { ...run, startedAtMs: Infinity }, { ...run, startedAtMs: -1 },
  ])('rejects malformed local registration %j', (invalid) => {
    const before = createInitialGameState();
    expect(gameReducer(before, { type: 'START', run: invalid })).toEqual({ ...before, lastRejectReason: 'INVALID_START' });
  });

  it.each([
    ['old run', { runId: 'old-run' }, 'RUN_MISMATCH'],
    ['other source', { sourceInstanceId: 'external-source' }, 'UNREGISTERED_SOURCE'],
    ['missing source', { sourceInstanceId: undefined }, 'UNREGISTERED_SOURCE'],
    ['missing provenance', { provenance: undefined }, 'UNSUPPORTED_PROVENANCE'],
    ['string provenance', { provenance: 'TEST' }, 'UNSUPPORTED_PROVENANCE'],
    ['POSE', { provenance: { kind: 'POSE', method: 'KEYBOARD' } }, 'UNSUPPORTED_PROVENANCE'],
    ['SCRIPT', { provenance: { kind: 'TEST', method: 'SCRIPT' } }, 'UNSUPPORTED_PROVENANCE'],
    ['Socket test', { provenance: { kind: 'TEST', method: 'SOCKET_TEST' } }, 'UNSUPPORTED_PROVENANCE'],
    ['unknown action', { action: 'KNEE_LEFT' }, 'INVALID_ACTION'],
    ['zero sequence', { sequence: 0 }, 'INVALID_SEQUENCE'],
    ['negative sequence', { sequence: -1 }, 'INVALID_SEQUENCE'],
    ['fractional sequence', { sequence: 1.5 }, 'INVALID_SEQUENCE'],
    ['unsafe sequence', { sequence: Number.MAX_SAFE_INTEGER + 1 }, 'INVALID_SEQUENCE'],
    ['string sequence', { sequence: '1' }, 'INVALID_SEQUENCE'],
    ['NaN sequence', { sequence: NaN }, 'INVALID_SEQUENCE'],
    ['infinite sequence', { sequence: Infinity }, 'INVALID_SEQUENCE'],
    ['NaN timestamp', { occurredAtMs: NaN }, 'INVALID_TIMESTAMP'],
    ['infinite timestamp', { occurredAtMs: Infinity }, 'INVALID_TIMESTAMP'],
    ['negative timestamp', { occurredAtMs: -1 }, 'INVALID_TIMESTAMP'],
    ['string timestamp', { occurredAtMs: '100' }, 'INVALID_TIMESTAMP'],
    ['pre-start timestamp', { occurredAtMs: 99 }, 'TIMESTAMP_BEFORE_START'],
  ] as const)('rejects %s without changing score, target, history or admission cursors', (_name, overrides, reason) => {
    const before = start(), after = send(before, { ...input(), ...overrides });
    expect(after).toEqual({ ...before, lastRejectReason: reason });
    expect(after.history).toBe(before.history);
    expect(send(after, input()).score).toBe(1);
  });

  it.each([null, undefined, 42, 'LEFT_ACTION', []])('safely rejects malformed input %j', (value) => {
    const before = start();
    expect(send(before, value)).toEqual({ ...before, lastRejectReason: 'INVALID_INPUT' });
  });

  it('deduplicates and rejects old sequence while accepting gaps and equal clock ticks', () => {
    const first = send(start(), input({ sequence: 3 }));
    for (const sequence of [3, 2, 1]) {
      expect(send(first, input({ sequence, action: 'RIGHT_ACTION' }))).toEqual({ ...first, lastRejectReason: 'SEQUENCE_NOT_INCREASING' });
    }
    const second = send(first, input({ sequence: 7, action: 'RIGHT_ACTION', occurredAtMs: 100 }));
    expect(second.score).toBe(2);
    expect(second.history.map((r) => r.input.sequence)).toEqual([3, 7]);
  });

  it('rejects time reversal against admitted inputs and never consumes the rejected sequence', () => {
    const first = send(start(), input({ occurredAtMs: 150 }));
    const second = send(first, input({ sequence: 2, action: 'RIGHT_ACTION', occurredAtMs: 149 }));
    expect(second).toEqual({ ...first, lastRejectReason: 'TIME_REVERSAL' });
    expect(send(second, input({ sequence: 2, action: 'RIGHT_ACTION', occurredAtMs: 150 })).score).toBe(2);
  });

  it('accepts timestamp zero at a zero start and snapshots admitted primitive values only', () => {
    const registration = { ...run, startedAtMs: 0 };
    const before = gameReducer(createInitialGameState(), { type: 'START', run: registration });
    registration.sourceInstanceId = 'changed';
    const mutable = { ...input({ occurredAtMs: 0 }), provenance: { kind: 'TEST', method: 'KEYBOARD' }, extra: { unused: true } };
    const after = send(before, mutable);
    mutable.action = 'RIGHT_ACTION'; mutable.provenance.method = 'POSE';
    expect(after.history[0].input).toEqual({ runId: 'run-1', sourceInstanceId: 'keyboard-1', sequence: 1, occurredAtMs: 0,
      action: 'LEFT_ACTION', provenance: KEYBOARD_TEST_PROVENANCE });
    expect(after.history[0].input).not.toBe(mutable);
  });

  it('is deterministic for a frozen initial state/event list, without browser globals or mutations', () => {
    expect(typeof window).toBe('undefined');
    const initial = freeze(createInitialGameState());
    const events: readonly GameEvent[] = freeze([
      { type: 'START', run },
      { type: 'INPUT', input: input({ action: 'RIGHT_ACTION' }) },
      { type: 'INPUT', input: input({ sequence: 2 }) },
      { type: 'INPUT', input: input({ sequence: 2 }) },
      ...GAME_TARGETS.slice(1).map((action, i) => ({ type: 'INPUT' as const, input: input({ action, sequence: i + 3, occurredAtMs: 101 + i }) })),
      { type: 'RESET' }, { type: 'START', run: { ...run, runId: 'run-2', startedAtMs: 200 } },
      { type: 'INPUT', input: input({ runId: 'run-2', occurredAtMs: 200 }) },
    ]);
    const snapshot = JSON.stringify({ initial, events });
    const replay = () => events.reduce((state, event) => freeze(gameReducer(state, event)), initial);
    expect(replay()).toEqual(replay());
    expect(replay()).toMatchObject({ status: 'RUNNING', score: 1, targetIndex: 1, usedRunIds: ['run-1', 'run-2'] });
    expect(JSON.stringify({ initial, events })).toBe(snapshot);
  });
});
