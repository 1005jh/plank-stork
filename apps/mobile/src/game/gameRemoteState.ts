import { GAME_COMMAND_TIMEOUT_MS, GAME_STALE_MS, gameSnapshotKey, isGameStateSnapshot,
  type GameCommandType, type GameOperatorCommand, type GameStateSnapshot } from '@plank-stork/protocol';

type Entry = { snapshot: GameStateSnapshot; receivedAt: number | null; retiredRuns: Set<string>; error: string | null };
export interface GameRemoteView {
  controllers: readonly string[];
  selectedId: string | null;
  snapshot: GameStateSnapshot | null;
  status: 'DISCONNECTED' | 'SELECT_CONTROLLER' | 'SYNCING' | 'LIVE' | 'STALE';
  error: string | null;
  pending: { requestId: string; command: GameCommandType; startedAt: number } | null;
  commandMessage: string | null;
}

/** Snapshot admission/display state only: no game reducer, score calculation or Pose input.
 * Every time is measured by this mobile's local monotonic clock, never a controller clock.
 */
export class GameRemoteState {
  private entries = new Map<string, Entry>();
  private connected = false;
  private selectedId: string | null = null;
  private pending: GameRemoteView['pending'] = null;
  private commandMessage: string | null = null;
  private error: string | null = null;
  private listeners = new Set<() => void>();
  private view: GameRemoteView = { controllers: [], selectedId: null, snapshot: null, status: 'DISCONNECTED', error: null, pending: null, commandMessage: null };
  getView = () => this.view;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  private status(now: number): GameRemoteView['status'] {
    if (!this.connected) return 'DISCONNECTED';
    if (!this.selectedId) return 'SELECT_CONTROLLER';
    const entry = this.entries.get(this.selectedId);
    if (!entry || entry.receivedAt === null) return 'SYNCING';
    return now - entry.receivedAt >= GAME_STALE_MS || entry.error ? 'STALE' : 'LIVE';
  }
  private update(now: number) {
    const status = this.status(now);
    if (this.pending && status !== 'LIVE') this.cancel(`CANCELLED_${status}`);
    const entry = this.selectedId ? this.entries.get(this.selectedId) : null;
    this.view = { controllers: [...this.entries.keys()], selectedId: this.selectedId, snapshot: entry?.snapshot ?? null,
      status, error: entry?.error ?? this.error, pending: this.pending, commandMessage: this.commandMessage };
    this.listeners.forEach((listener) => listener());
  }
  private cancel(reason: string) {
    if (this.pending) this.commandMessage = `${this.pending.command}: ${reason} — 처리 여부 미확인, 자동 재전송 없음`;
    this.pending = null;
  }
  connection(connected: boolean, now: number) {
    this.connected = connected;
    // Even on reconnect, a previous snapshot stays last known until received in this connection.
    this.entries.forEach((entry) => { entry.receivedAt = null; });
    this.cancel(connected ? 'CANCELLED_RECONNECT' : 'CANCELLED_DISCONNECT');
    this.update(now);
  }
  select(id: string, now: number) {
    if (!this.entries.has(id)) return;
    if (id !== this.selectedId) {
      const wasPending = this.pending !== null;
      this.cancel('CANCELLED_SELECTION_CHANGE');
      // An approval from the old controller must not look like this controller's result.
      if (!wasPending) this.commandMessage = null;
    }
    this.selectedId = id;
    this.error = null;
    this.update(now);
  }
  receive(payload: unknown, now: number) {
    if (!this.connected) return;
    if (!isGameStateSnapshot(payload)) { this.error = 'INVALID_SNAPSHOT'; this.update(now); return; }
    const entry = this.entries.get(payload.controllerInstanceId);
    if (entry) {
      const previous = entry.snapshot;
      if (payload.revision < previous.revision) return; // Old messages cannot keep a dead controller fresh.
      let error: string | null = null;
      if (payload.revision === previous.revision && gameSnapshotKey(payload) !== gameSnapshotKey(previous)) error = 'REVISION_CONFLICT';
      if (payload.revision > previous.revision) {
        if (payload.runId !== null && payload.runId === previous.runId && payload.provenance.method !== previous.provenance.method) error = 'RUN_SOURCE_CHANGED';
        if (payload.runId !== null && entry.retiredRuns.has(payload.runId)) error = 'RETIRED_RUN';
        if (payload.runId !== null && payload.runId === previous.runId &&
            (payload.targetIndex < previous.targetIndex || (previous.phase === 'COMPLETED' && payload.phase !== 'COMPLETED'))) error = 'RUN_REGRESSION';
      }
      if (error) { entry.error = error; this.update(now); return; }
      // A conflicting revision is quarantined; only a newer coherent revision can recover it.
      if (payload.revision === previous.revision && entry.error) return;
      if (previous.runId !== null && previous.runId !== payload.runId) entry.retiredRuns.add(previous.runId);
      entry.snapshot = structuredClone(payload);
      entry.receivedAt = now;
      entry.error = null;
    } else {
      this.entries.set(payload.controllerInstanceId, { snapshot: structuredClone(payload), receivedAt: now, retiredRuns: new Set(), error: null });
    }
    this.error = null;
    if (payload.controllerInstanceId === this.selectedId && this.pending && payload.commandResult && this.pending.requestId === payload.commandResult.requestId) {
      const result = payload.commandResult;
      this.commandMessage = `${result.command}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
      this.pending = null;
    }
    this.update(now);
  }
  request(command: GameCommandType, requestId: string, now: number): GameOperatorCommand | null {
    if (this.status(now) !== 'LIVE' || this.pending || !this.selectedId) return null;
    const s = this.entries.get(this.selectedId)!.snapshot;
    if ((command === 'START' && s.phase === 'RUNNING') || (command === 'STOP' && s.phase !== 'RUNNING')) return null;
    this.pending = { requestId, command, startedAt: now };
    this.commandMessage = `${command}: 승인 대기`;
    this.update(now);
    return { version: 1, requestId, controllerInstanceId: this.selectedId, expectedRevision: s.revision, runId: s.runId, command };
  }
  tick(now: number) {
    if (this.pending && now - this.pending.startedAt >= GAME_COMMAND_TIMEOUT_MS) this.cancel('TIMEOUT');
    if (this.view.status !== this.status(now) || this.view.pending !== this.pending) this.update(now);
  }
}
