// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isGameStateSnapshot, type GameOperatorCommand } from '@plank-stork/protocol';
import { GameController } from './gameController';
const command = (owner: GameController, requestId: string, kind: GameOperatorCommand['command']): GameOperatorCommand => {
  const s = owner.getView().snapshot;
  return { version: 1, requestId, command: kind, controllerInstanceId: s.controllerInstanceId, runId: s.runId, expectedRevision: s.revision };
};
function input(owner: GameController, sequence: number, action = 'LEFT_ACTION') {
  const run = owner.getView().state.run!;
  return { ...run, sequence, occurredAtMs: 100 + sequence, action, provenance: { kind: 'TEST', method: 'KEYBOARD' } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
describe('single controller game authority', () => {
  it('publishes derived compact snapshots; wrong, duplicate and rejected inputs never add score', () => {
    const owner = new GameController('c', () => 100);
    owner.start(); owner.input(input(owner, 1, 'RIGHT_ACTION'));
    expect(owner.getView().snapshot).toMatchObject({ revision: 2, score: 0, feedback: { outcome: 'WRONG' } });
    const correct = input(owner, 2);
    owner.input(correct);
    const before = owner.getView().snapshot;
    owner.input(correct);
    owner.input({ ...correct, sequence: 3, provenance: { kind: 'POSE', method: 'KEYBOARD' } });
    expect(owner.getView().snapshot).toBe(before);
    expect(before.score).toBe(1);
    expect(owner.getView().state.history).toHaveLength(2);
    expect(Object.keys(before)).not.toContain('history');
    expect(isGameStateSnapshot(before)).toBe(true);
  });
  it('START/RESET/STOP advance revisions atomically and duplicate requestIds never execute again', () => {
    const owner = new GameController('c', () => 100);
    const start = command(owner, 'first', 'START');
    owner.command(start);
    const first = owner.getView().snapshot;
    expect(first).toMatchObject({ revision: 1, phase: 'RUNNING', commandResult: { status: 'ACCEPTED' } });
    owner.command(start); expect(owner.getView().snapshot).toBe(first);
    owner.input(input(owner, 1));
    owner.command(command(owner, 'stop', 'STOP'));
    expect(owner.getView().snapshot).toMatchObject({ revision: 3, phase: 'IDLE', score: 0, runId: null });
    owner.command(start); expect(owner.getView().snapshot.revision).toBe(3);
    owner.command(command(owner, 'second', 'START'));
    expect(owner.getView().snapshot.runId).not.toBe(first.runId);
    owner.command(command(owner, 'reset', 'RESET'));
    expect(owner.getView().snapshot).toMatchObject({ revision: 5, phase: 'IDLE', score: 0 });
  });
  it.each([
    [{ controllerInstanceId: 'other' }, 'WRONG_CONTROLLER'], [{ runId: 'old' }, 'WRONG_RUN'],
    [{ expectedRevision: 8 }, 'WRONG_REVISION'],
  ] as const)('rejects command mismatch %j without touching Core state', (patch, reason) => {
    const owner = new GameController('c', () => 100);
    const state = owner.getView().state;
    owner.command({ ...command(owner, 'r', 'START'), ...patch });
    expect(owner.getView().state).toBe(state);
    expect(owner.getView().snapshot.commandResult).toMatchObject({ status: 'REJECTED', reason });
  });
  it('gates back-to-back commands by the latest synchronous revision, not a React render closure', () => {
    const owner = new GameController('c', () => 100);
    const first = command(owner, 'a', 'START'), second = command(owner, 'b', 'START');
    owner.command(first); owner.command(second);
    expect(owner.getView().state.usedRunIds).toHaveLength(1);
    expect(owner.getView().snapshot.commandResult?.reason).toBe('WRONG_RUN');
    owner.command(command(owner, 'c', 'START'));
    expect(owner.getView().snapshot.commandResult?.reason).toBe('ALREADY_RUNNING');
    owner.reset(); owner.command(command(owner, 'd', 'STOP'));
    expect(owner.getView().snapshot.commandResult?.reason).toBe('NOT_RUNNING');
  });
  it('ignores malformed commands and uses the supplied local clock/source only', () => {
    const owner = new GameController('c', () => 42);
    const initial = owner.getView();
    owner.command({ command: 'INPUT', action: 'LEFT_ACTION' }); expect(owner.getView()).toBe(initial);
    owner.start(); expect(owner.getView().state.run).toEqual({ runId: 'c/run-1', sourceInstanceId: 'c/keyboard', startedAtMs: 42 });
  });
  it('retains one page instance with a working HTTP LAN fallback; a new page gets a new ID', async () => {
    vi.stubGlobal('crypto', {});
    const page = await import('./gameController');
    const id = page.getPageControllerInstanceId();
    expect(page.getPageControllerInstanceId()).toBe(id);
    expect(id).toMatch(/^controller-/);
    vi.resetModules();
    expect((await import('./gameController')).getPageControllerInstanceId()).not.toBe(id);
  });
});
