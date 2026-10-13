import { gameSnapshotKey, isGameOperatorCommand, type GameCommandRejection, type GameCommandResult, type GameStateSnapshot } from '@plank-stork/protocol';
import { createInitialGameState, gameReducer } from './gameReducer';
import { GAME_TARGETS, type GameState } from './gameTypes';

let pageInstanceId: string | undefined;
export function getPageControllerInstanceId(): string {
  // HTTP LAN may not expose randomUUID. These are collision-avoidance IDs, never credentials.
  return pageInstanceId ??= `controller-${globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`}`;
}

/** The ONE game owner. Synchronous transitions make back-to-back Socket commands atomic even
 * inside React batching. React and the publisher subscribe to this same state; neither scores.
 * Clock and IDs stay outside the unchanged pure STEP 4U reducer.
 */
export class GameController {
  private view: { state: GameState; snapshot: GameStateSnapshot };
  private runNumber = 0;
  private requests = new Set<string>(); // Page lifetime dedupe, also across RESET/STOP.
  private listeners = new Set<() => void>();

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
      score: state.score, totalTargets: 4, provenance: { kind: 'TEST', method: 'KEYBOARD' },
      feedback: last ? { action: last.input.action, target: last.target, outcome: last.outcome } : null, commandResult };
  }
  private commit(state: GameState, result = this.view.snapshot.commandResult) {
    const previous = this.view.snapshot;
    let next = this.snapshot(state, previous.revision, result);
    if (gameSnapshotKey(next) === gameSnapshotKey(previous)) next = previous;
    else next = { ...next, revision: previous.revision + 1 };
    this.view = { state, snapshot: next };
    this.listeners.forEach((listener) => listener());
  }
  private startedState() {
    return gameReducer(this.view.state, { type: 'START', run: {
      runId: `${this.instanceId}/run-${++this.runNumber}`, sourceInstanceId: `${this.instanceId}/keyboard`, startedAtMs: this.now(),
    } });
  }
  start = () => { this.commit(this.startedState()); };
  reset = () => { this.commit(gameReducer(this.view.state, { type: 'RESET' })); };
  input = (input: unknown) => { this.commit(gameReducer(this.view.state, { type: 'INPUT', input })); };

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
      : gameReducer(this.view.state, { type: 'RESET' });
    this.commit(state, result);
  };
}
