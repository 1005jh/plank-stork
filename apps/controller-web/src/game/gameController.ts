import { gameSnapshotKey, isGameOperatorCommand, type GameCommandRejection, type GameCommandResult, type GameStateSnapshot,
  type GameTestProvenance, type GameScriptStopReason, type GameTestMethod } from '@plank-stork/protocol';
import { createInitialGameState, gameReducer } from './gameReducer';
import { GAME_TARGETS, KEYBOARD_TEST_PROVENANCE, SCRIPT_TEST_PROVENANCE, type GameState } from './gameTypes';
import { ScriptedGameInput, type ScriptRuntime } from './scriptedGameInput';

let pageInstanceId: string | undefined;
export function getPageControllerInstanceId(): string {
  // HTTP LAN may not expose randomUUID. These are collision-avoidance IDs, never credentials.
  return pageInstanceId ??= `controller-${globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`}`;
}

/** The ONE game owner. Synchronous transitions make back-to-back Socket commands atomic even
 * inside React batching. React and the publisher subscribe to this same state; neither scores.
 * Clock and IDs stay outside the pure STEP 4U reducer; its scoring rules are unchanged.
 */
export class GameController {
  private view: { state: GameState; snapshot: GameStateSnapshot };
  private runNumber = 0;
  private requests = new Set<string>(); // Page lifetime dedupe, also across RESET/STOP.
  private listeners = new Set<() => void>();
  private runner: ScriptedGameInput | null = null;
  private provenance: GameTestProvenance = KEYBOARD_TEST_PROVENANCE;
  private scriptStopReason: GameScriptStopReason | undefined;

  constructor(readonly instanceId: string, private now: () => number) {
    const state = createInitialGameState();
    this.view = { state, snapshot: this.snapshot(state, 0, null) };
  }
  getView = () => this.view;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  private snapshot(state: GameState, revision: number, commandResult: GameCommandResult | null): GameStateSnapshot {
    const last = state.history.at(-1);
    return { version: 1, controllerInstanceId: this.instanceId, runId: state.run?.runId ?? null, revision,
      phase: state.status, targetIndex: state.targetIndex, currentTarget: state.status === 'RUNNING' ? GAME_TARGETS[state.targetIndex] : null,
      score: state.score, totalTargets: 4, provenance: this.provenance,
      feedback: last ? { action: last.input.action, target: last.target, outcome: last.outcome } : null, commandResult,
      ...(this.scriptStopReason ? { scriptStopReason: this.scriptStopReason } : {}) };
  }
  private commit(state: GameState, result = this.view.snapshot.commandResult) {
    const previous = this.view.snapshot;
    let next = this.snapshot(state, previous.revision, result);
    if (gameSnapshotKey(next) === gameSnapshotKey(previous)) next = previous;
    else next = { ...next, revision: previous.revision + 1 };
    this.view = { state, snapshot: next };
    this.listeners.forEach((listener) => listener());
  }
  private startedState(method: GameTestMethod = 'KEYBOARD') {
    const state = gameReducer(this.view.state, { type: 'START', run: {
      runId: `${this.instanceId}/run-${++this.runNumber}`, sourceInstanceId: `${this.instanceId}/${method.toLowerCase()}`, startedAtMs: this.now(),
      ...(method === 'SCRIPT' ? { provenance: SCRIPT_TEST_PROVENANCE } : {}),
    } });
    if (state.run !== this.view.state.run) {
      this.provenance = method === 'SCRIPT' ? SCRIPT_TEST_PROVENANCE : KEYBOARD_TEST_PROVENANCE;
      this.scriptStopReason = undefined;
    }
    return state;
  }
  start = () => { this.commit(this.startedState()); };
  private cancelRunner() { this.runner?.cancel(); this.runner = null; }
  private resetState(reason: GameScriptStopReason) {
    if (this.view.state.status === 'RUNNING' && this.provenance.method === 'SCRIPT') this.scriptStopReason = reason;
    this.cancelRunner();
    return gameReducer(this.view.state, { type: 'RESET' });
  }
  reset = () => { this.commit(this.resetState('RESET')); };
  stop = () => { this.commit(this.resetState('STOP')); };
  private applyInput(input: unknown, adapter: GameTestMethod): boolean {
    const before = this.view.state;
    // Adapter method is owner-selected, never taken from the incoming payload to choose a route.
    const state = before.status === 'RUNNING' && (before.run?.provenance?.method ?? 'KEYBOARD') !== adapter
      ? { ...before, lastRejectReason: 'UNSUPPORTED_PROVENANCE' as const }
      : gameReducer(before, { type: 'INPUT', input });
    if (state.status === 'COMPLETED') this.cancelRunner();
    this.commit(state);
    return state.lastAcceptedSequence > before.lastAcceptedSequence;
  }
  input = (input: unknown) => { this.applyInput(input, 'KEYBOARD'); };
  interruptScript = (reason: GameScriptStopReason) => {
    if (this.view.state.status === 'RUNNING' && this.provenance.method === 'SCRIPT') this.commit(this.resetState(reason));
  };
  startScriptedDemo = (runtime: ScriptRuntime): boolean => {
    if (this.view.state.status === 'RUNNING' || this.runner) return false;
    const state = this.startedState('SCRIPT');
    const run = state.run;
    if (!run || state.status !== 'RUNNING') { this.commit(state); return false; }
    const runner: ScriptedGameInput = new ScriptedGameInput({ ...runtime, run, now: this.now,
      isCurrentRun: () => this.runner === runner && this.view.state.status === 'RUNNING' &&
        this.view.state.run?.runId === run.runId && this.view.state.run.sourceInstanceId === run.sourceInstanceId &&
        this.view.state.run.provenance?.method === 'SCRIPT',
      emit: (input) => this.applyInput(input, 'SCRIPT'),
      abort: (reason) => this.interruptScript(reason),
    });
    this.runner = runner;
    this.commit(state);
    runner.start();
    return true;
  };

  command = (payload: unknown) => {
    if (!isGameOperatorCommand(payload) || this.requests.has(payload.requestId)) return;
    this.requests.add(payload.requestId);
    const s = this.view.snapshot;
    const reason: GameCommandRejection | null = payload.controllerInstanceId !== this.instanceId ? 'WRONG_CONTROLLER'
      : payload.runId !== s.runId ? 'WRONG_RUN' : payload.expectedRevision !== s.revision ? 'WRONG_REVISION'
      : payload.command === 'START' && s.phase === 'RUNNING' ? 'ALREADY_RUNNING'
      : payload.command === 'STOP' && s.phase !== 'RUNNING' ? 'NOT_RUNNING' : null;
    const result: GameCommandResult = { requestId: payload.requestId, command: payload.command,
      status: reason ? 'REJECTED' : 'ACCEPTED', reason };
    const state = reason ? this.view.state : payload.command === 'START' ? this.startedState()
      // STOP explicitly discards score/history and returns IDLE, exactly like RESET.
      : this.resetState(payload.command);
    this.commit(state, result);
  };
}
