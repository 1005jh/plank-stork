import type { GameScriptStopReason } from '@plank-stork/protocol';
import { SCRIPT_TEST_PROVENANCE, type GameAction, type GameInput, type GameRun } from './gameTypes';

// Preregistered TEST data. Never derived from a target, score, detector or keyboard event.
export const SCRIPTED_SCENARIO: readonly { readonly atMs: number; readonly action: GameAction }[] = Object.freeze([
  Object.freeze({ atMs: 2000, action: 'RIGHT_ACTION' as const }), // Intentional wrong input.
  Object.freeze({ atMs: 4000, action: 'LEFT_ACTION' as const }),
  Object.freeze({ atMs: 6000, action: 'RIGHT_ACTION' as const }),
  Object.freeze({ atMs: 8000, action: 'LEFT_ACTION' as const }),
  Object.freeze({ atMs: 10000, action: 'RIGHT_ACTION' as const }),
]);
// Independent of Socket heartbeat/staleness. No catch-up loop or offline action queue.
export const SCRIPT_MAX_LATENESS_MS = 250;
export interface ScriptRuntime {
  isVisible: () => boolean;
  schedule: (callback: () => void, delayMs: number) => () => void;
}
interface ScriptOptions extends ScriptRuntime {
  run: GameRun;
  now: () => number;
  isCurrentRun: () => boolean;
  emit: (input: GameInput) => boolean;
  abort: (reason: GameScriptStopReason) => void;
}

/** Single-use runner with one pending timer. Time/scheduling injection keeps replay deterministic.
 * It knows only run identity and the fixed scenario; Core alone decides wrong/correct/completed.
 */
export class ScriptedGameInput {
  private active = true;
  private started = false;
  private cursor = 0;
  private lastTime: number;
  private cancelTimer: (() => void) | null = null;
  private timerToken = 0;
  constructor(private options: ScriptOptions) { this.lastTime = options.run.startedAtMs; }

  start() {
    if (this.started) return;
    this.started = true;
    this.scheduleNext();
  }
  cancel = () => { this.active = false; this.started = true; this.timerToken++; this.cancelTimer?.(); this.cancelTimer = null; };
  private abort(reason: GameScriptStopReason) { this.cancel(); this.options.abort(reason); }
  private checkedTime(): number | null {
    if (!this.active || !this.options.isCurrentRun()) { this.cancel(); return null; }
    if (!this.options.isVisible()) { this.abort('PAGE_HIDDEN'); return null; }
    const now = this.options.now();
    if (!Number.isFinite(now) || now < this.lastTime) { this.abort('CLOCK_INVALID'); return null; }
    this.lastTime = now;
    return now;
  }
  private scheduleNext() {
    const now = this.checkedTime();
    if (now === null) return;
    if (this.cursor === SCRIPTED_SCENARIO.length) { this.cancel(); return; }
    const deadline = this.options.run.startedAtMs + SCRIPTED_SCENARIO[this.cursor].atMs;
    const token = ++this.timerToken;
    this.cancelTimer = this.options.schedule(() => {
      if (!this.active || token !== this.timerToken) return;
      this.timerToken++;
      this.tick();
    }, Math.max(0, deadline - now));
  }
  private tick = () => {
    this.cancelTimer = null;
    const now = this.checkedTime();
    if (now === null) return;
    const step = SCRIPTED_SCENARIO[this.cursor];
    const late = now - (this.options.run.startedAtMs + step.atMs);
    if (late < 0) { this.scheduleNext(); return; }
    if (late > SCRIPT_MAX_LATENESS_MS) { this.abort('TIMER_DELAY'); return; }
    const accepted = this.options.emit({ runId: this.options.run.runId, sourceInstanceId: this.options.run.sourceInstanceId,
      sequence: this.cursor + 1, occurredAtMs: now, action: step.action, provenance: SCRIPT_TEST_PROVENANCE });
    if (!accepted) { if (this.active && this.options.isCurrentRun()) this.abort('INPUT_REJECTED'); else this.cancel(); return; }
    this.cursor++;
    this.scheduleNext();
  };
}
