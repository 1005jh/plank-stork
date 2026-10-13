// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isGameStateSnapshot, type GameScriptStopReason } from '@plank-stork/protocol';
import { GameController } from './gameController';
import { createInitialGameState, gameReducer } from './gameReducer';
import { KEYBOARD_TEST_PROVENANCE, SCRIPT_TEST_PROVENANCE, type GameInput } from './gameTypes';
import { ScriptedGameInput, SCRIPTED_SCENARIO, SCRIPT_MAX_LATENESS_MS, type ScriptRuntime } from './scriptedGameInput';

class TestClock {
  now = 100;
  visible = true;
  jobs: { at: number; callback: () => void; cancelled: boolean }[] = [];
  runtime: ScriptRuntime = { isVisible: () => this.visible, schedule: (callback, delay) => {
    const job = { at: this.now + delay, callback, cancelled: false }; this.jobs.push(job);
    return () => { job.cancelled = true; };
  } };
  pending() { return this.jobs.filter((j) => !j.cancelled); }
  fire(late = 0) {
    const job = this.pending()[0]; expect(job).toBeDefined();
    this.now = job.at + late; job.cancelled = true; job.callback();
  }
}
const setup = () => { const clock = new TestClock(); const owner = new GameController('c', () => clock.now); return { clock, owner }; };
const command = (owner: GameController, type: 'RESET' | 'STOP' | 'START') => ({ version: 1, requestId: type,
  controllerInstanceId: owner.instanceId, expectedRevision: owner.getView().snapshot.revision,
  runId: owner.getView().snapshot.runId, command: type });

describe('SCRIPT TEST registration and deterministic scenario', () => {
  it('admits only the registered method/source while keeping the existing sequence/time/run gate', () => {
    const run = { runId: 's', sourceInstanceId: 'script-1', startedAtMs: 0, provenance: SCRIPT_TEST_PROVENANCE };
    const initial = gameReducer(createInitialGameState(), { type: 'START', run });
    const input: GameInput = { runId: 's', sourceInstanceId: 'script-1', sequence: 1, occurredAtMs: 1,
      action: 'LEFT_ACTION', provenance: SCRIPT_TEST_PROVENANCE };
    const send = (value: unknown) => gameReducer(initial, { type: 'INPUT', input: value });
    expect(send(input).score).toBe(1);
    for (const provenance of [KEYBOARD_TEST_PROVENANCE, { kind: 'POSE', method: 'SCRIPT' }, { kind: 'TEST', method: 'UNKNOWN' }]) {
      expect(send({ ...input, provenance })).toEqual({ ...initial, lastRejectReason: 'UNSUPPORTED_PROVENANCE' });
    }
    expect(send({ ...input, sourceInstanceId: 'other' }).lastRejectReason).toBe('UNREGISTERED_SOURCE');
    expect(send({ ...input, runId: 'old' }).lastRejectReason).toBe('RUN_MISMATCH');
    const accepted = send(input);
    expect(gameReducer(accepted, { type: 'INPUT', input }).lastRejectReason).toBe('SEQUENCE_NOT_INCREASING');
    expect(gameReducer(accepted, { type: 'INPUT', input: { ...input, sequence: 2, occurredAtMs: 0 } }).lastRejectReason).toBe('TIME_REVERSAL');
    const keyboard = gameReducer(createInitialGameState(), { type: 'START', run: { ...run, provenance: KEYBOARD_TEST_PROVENANCE } });
    expect(gameReducer(keyboard, { type: 'INPUT', input }).lastRejectReason).toBe('UNSUPPORTED_PROVENANCE');
    expect(gameReducer(createInitialGameState(), { type: 'START', run: { ...run, provenance: { kind: 'POSE' } as never } }).lastRejectReason).toBe('INVALID_START');
  });
  it('has a frozen, preregistered scenario with no target/keyboard/detector API dependency', () => {
    expect(SCRIPTED_SCENARIO).toEqual([
      { atMs: 2000, action: 'RIGHT_ACTION' }, { atMs: 4000, action: 'LEFT_ACTION' },
      { atMs: 6000, action: 'RIGHT_ACTION' }, { atMs: 8000, action: 'LEFT_ACTION' }, { atMs: 10000, action: 'RIGHT_ACTION' },
    ]);
    expect(Object.isFrozen(SCRIPTED_SCENARIO)).toBe(true);
    expect(SCRIPTED_SCENARIO.every(Object.isFrozen)).toBe(true);
    // Architecture guard: a future refactor must not generate inputs from Core targets or DOM events.
    const source = readFileSync(new URL('./scriptedGameInput.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bGAME_TARGETS\b|\.targetIndex|\bKeyboardEvent\b|\.getView\(|from ['"].*(pose|detector|gameReducer)/);
  });
  it('keeps score zero for the first wrong input, then completes 4/4 with SCRIPT history only', () => {
    const { owner, clock } = setup(); expect(owner.startScriptedDemo(clock.runtime)).toBe(true);
    expect(owner.getView().snapshot.provenance).toEqual(SCRIPT_TEST_PROVENANCE);
    clock.fire(); expect(owner.getView().snapshot).toMatchObject({ score: 0, feedback: { outcome: 'WRONG' }, phase: 'RUNNING' });
    for (const score of [1, 2, 3, 4]) { clock.fire(); expect(owner.getView().snapshot.score).toBe(score); }
    expect(owner.getView().snapshot).toMatchObject({ phase: 'COMPLETED', score: 4 });
    expect(isGameStateSnapshot(owner.getView().snapshot)).toBe(true);
    expect(owner.getView().state.history.map((h) => [h.input.sequence, h.input.occurredAtMs, h.input.provenance])).toEqual(
      SCRIPTED_SCENARIO.map((s, i) => [i + 1, 100 + s.atMs, SCRIPT_TEST_PROVENANCE]));
    expect(clock.pending()).toHaveLength(0);
  });
  it('replays the same scenario/clock deterministically and gives each new run an independent cursor', () => {
    const replay = () => { const { owner, clock } = setup(); owner.startScriptedDemo(clock.runtime);
      for (let i = 0; i < 5; i++) clock.fire(); return owner.getView(); };
    expect(replay()).toEqual(replay());
    const { owner, clock } = setup(); owner.startScriptedDemo(clock.runtime); clock.fire();
    const first = owner.getView().snapshot.runId; owner.reset(); owner.startScriptedDemo(clock.runtime); clock.fire();
    expect(owner.getView().snapshot.runId).not.toBe(first);
    expect(owner.getView().state.history).toHaveLength(1);
    expect(owner.getView().state.lastAcceptedSequence).toBe(1);
  });
  it('blocks duplicate Demo/Keyboard starts and all keyboard routing while SCRIPT owns the run', () => {
    const { owner, clock } = setup(); owner.startScriptedDemo(clock.runtime);
    const run = owner.getView().state.run!;
    expect(owner.startScriptedDemo(clock.runtime)).toBe(false); owner.start();
    expect(owner.getView().state.run).toBe(run); expect(clock.pending()).toHaveLength(1);
    for (const provenance of [KEYBOARD_TEST_PROVENANCE, SCRIPT_TEST_PROVENANCE]) {
      owner.input({ ...run, sequence: 1, occurredAtMs: clock.now, action: 'LEFT_ACTION', provenance });
      expect(owner.getView().state.history).toHaveLength(0);
    }
    clock.fire(); expect(owner.getView().state.history[0].outcome).toBe('WRONG');
  });
  it('mobile START remains KEYBOARD and cannot switch a running SCRIPT source', () => {
    const { owner, clock } = setup(); owner.startScriptedDemo(clock.runtime);
    owner.command(command(owner, 'START'));
    expect(owner.getView().snapshot.commandResult?.reason).toBe('ALREADY_RUNNING');
    expect(owner.getView().snapshot.provenance.method).toBe('SCRIPT');
    owner.reset(); owner.command({ ...command(owner, 'START'), requestId: 'new-start' });
    expect(owner.getView().snapshot).toMatchObject({ phase: 'RUNNING', provenance: KEYBOARD_TEST_PROVENANCE });
    expect(owner.getView().snapshot.scriptStopReason).toBeUndefined();
    expect(clock.pending()).toHaveLength(0);
  });
});

describe('one-timer SCRIPT cancellation and delay safety', () => {
  it.each(['RESET', 'STOP'] as const)('%s cancels timers, discards score and ignores late callbacks even after a new run', (reason) => {
    const { owner, clock } = setup(); owner.startScriptedDemo(clock.runtime); clock.fire(); clock.fire();
    const late = clock.pending()[0].callback;
    owner.command(command(owner, reason));
    expect(clock.pending()).toHaveLength(0);
    expect(owner.getView().snapshot).toMatchObject({ phase: 'IDLE', score: 0, runId: null, scriptStopReason: reason });
    expect(isGameStateSnapshot(owner.getView().snapshot)).toBe(true);
    owner.startScriptedDemo(clock.runtime); const current = owner.getView(); late();
    expect(owner.getView()).toBe(current); expect(clock.pending()).toHaveLength(1);
    clock.fire(); expect(owner.getView().state.lastAcceptedSequence).toBe(1);
  });
  it('ignores a duplicate old timer callback within the same run without scheduling another timer', () => {
    const { owner, clock } = setup(); owner.startScriptedDemo(clock.runtime);
    const old = clock.pending()[0].callback; clock.fire(); old(); old();
    expect(owner.getView().state.history).toHaveLength(1); expect(clock.pending()).toHaveLength(1);
  });
  it('accepts up to 250ms of lateness and keeps later deadlines fixed, without drift', () => {
    const { owner, clock } = setup(); owner.startScriptedDemo(clock.runtime);
    clock.fire(SCRIPT_MAX_LATENESS_MS);
    expect(owner.getView().state.lastAcceptedAtMs).toBe(2350);
    expect(clock.pending()[0].at).toBe(4100);
    clock.fire(); expect(owner.getView().snapshot.score).toBe(1);
  });
  it.each([251, 8000, 60000])('aborts for %dms lateness instead of catching up or completing', (lateMs) => {
    const { owner, clock } = setup(); owner.startScriptedDemo(clock.runtime);
    clock.fire(lateMs);
    expect(owner.getView().snapshot).toMatchObject({ phase: 'IDLE', score: 0, scriptStopReason: 'TIMER_DELAY' });
    expect(owner.getView().state.history).toHaveLength(0); expect(clock.pending()).toHaveLength(0);
    clock.jobs.forEach((job) => job.callback());
    expect(owner.getView().snapshot.phase).toBe('IDLE');
  });
  it('checks visibility immediately before input and never resumes after returning to foreground', () => {
    const { owner, clock } = setup(); owner.startScriptedDemo(clock.runtime); clock.visible = false; clock.fire();
    expect(owner.getView().snapshot).toMatchObject({ phase: 'IDLE', scriptStopReason: 'PAGE_HIDDEN' });
    clock.visible = true; clock.jobs.forEach((job) => job.callback());
    expect(owner.getView().state.history).toHaveLength(0); expect(clock.pending()).toHaveLength(0);
    expect(owner.startScriptedDemo(clock.runtime)).toBe(true); clock.fire(); expect(owner.getView().state.history).toHaveLength(1);
  });
  it.each(['UNMOUNT', 'PAGE_HIDDEN'] as const)('explicit %s interruption cancels immediately without affecting a later KEYBOARD run', (reason) => {
    const { owner, clock } = setup(); owner.startScriptedDemo(clock.runtime); clock.fire();
    owner.interruptScript(reason); owner.start(); const before = owner.getView();
    clock.jobs.forEach((job) => job.callback());
    expect(owner.getView()).toBe(before); expect(owner.getView().snapshot.provenance.method).toBe('KEYBOARD');
  });
  it.each([NaN, -1])('aborts safely on invalid/backwards clock %s', (now) => {
    const { owner, clock } = setup(); owner.startScriptedDemo(clock.runtime);
    clock.now = now; clock.pending()[0].callback();
    expect(owner.getView().snapshot.scriptStopReason).toBe('CLOCK_INVALID');
    expect(owner.getView().snapshot.phase).toBe('IDLE');
  });
  it('rechecks identity before every callback and treats a rejected emission as failure, never completion', () => {
    const clock = new TestClock(); let current = true; const reasons: GameScriptStopReason[] = []; const inputs: GameInput[] = [];
    const make = () => new ScriptedGameInput({ ...clock.runtime, run: { runId: 's', sourceInstanceId: 'script', startedAtMs: clock.now, provenance: SCRIPT_TEST_PROVENANCE },
      now: () => clock.now, isCurrentRun: () => current, emit: (input) => { inputs.push(input); return false; }, abort: (reason) => reasons.push(reason) });
    const old = make(); old.start(); current = false; clock.fire(); expect(inputs).toEqual([]); expect(reasons).toEqual([]);
    current = true; const runner = make(); runner.start(); runner.start(); expect(clock.pending()).toHaveLength(1);
    clock.fire(); expect(reasons).toEqual(['INPUT_REJECTED']); expect(clock.pending()).toHaveLength(0);
  });
});
