// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { gameSnapshotKey, isGameOperatorCommand, isGameStateSnapshot, isGameSyncRequest, type GameStateSnapshot } from '@plank-stork/protocol';

const idle: GameStateSnapshot = { version: 1, controllerInstanceId: 'controller-1', runId: null, revision: 0,
  phase: 'IDLE', targetIndex: 0, currentTarget: null, score: 0, totalTargets: 4,
  provenance: { kind: 'TEST', method: 'KEYBOARD' }, feedback: null, commandResult: null };
describe('game wire runtime boundary', () => {
  it('accepts compact IDLE, RUNNING, wrong feedback and COMPLETED snapshots', () => {
    expect(isGameStateSnapshot(idle)).toBe(true);
    const running = { ...idle, runId: 'run-1', phase: 'RUNNING', currentTarget: 'LEFT_ACTION' };
    expect(isGameStateSnapshot(running)).toBe(true);
    expect(isGameStateSnapshot({ ...running, feedback: { action: 'RIGHT_ACTION', target: 'LEFT_ACTION', outcome: 'WRONG' } })).toBe(true);
    expect(isGameStateSnapshot({ ...idle, runId: 'run-1', phase: 'COMPLETED', score: 4, targetIndex: 4,
      feedback: { action: 'RIGHT_ACTION', target: 'RIGHT_ACTION', outcome: 'CORRECT' } })).toBe(true);
  });
  it.each([
    null, [], new Date(), Object.assign(new (class Snapshot {})(), idle),
    { ...idle, version: 2 }, { ...idle, controllerInstanceId: '' }, { ...idle, controllerInstanceId: 'with spaces' },
    { ...idle, revision: -1 }, { ...idle, revision: 1.5 }, { ...idle, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...idle, score: NaN }, { ...idle, score: Infinity }, { ...idle, targetIndex: 5, score: 5 },
    { ...idle, phase: 'STOPPED' }, { ...idle, phase: 'RUNNING' }, { ...idle, runId: 'run-1' },
    { ...idle, phase: 'COMPLETED', runId: 'run-1' },
    { ...idle, phase: 'RUNNING', runId: 'run-1', currentTarget: 'RIGHT_ACTION' },
    { ...idle, provenance: { kind: 'POSE', method: 'KEYBOARD' } }, { ...idle, provenance: { kind: 'TEST', method: 'SCRIPT' } },
    { ...idle, history: [] }, { ...idle, landmarks: [] }, { ...idle, baseline: {} },
    { ...idle, commandResult: { requestId: 'r', command: 'START', status: 'ACCEPTED', reason: 'WRONG_RUN' } },
    { ...idle, feedback: { action: 'RIGHT_ACTION', target: 'LEFT_ACTION', outcome: 'WRONG' } },
  ])('rejects malformed snapshot %#', (payload) => { expect(isGameStateSnapshot(payload)).toBe(false); });
  it('validates only sync/operator DTOs, never remote game INPUT', () => {
    const sync = { version: 1, requestId: 'sync-1', controllerInstanceId: null };
    expect(isGameSyncRequest(sync)).toBe(true);
    expect(isGameSyncRequest({ ...sync, timestamp: 0 })).toBe(false);
    const request = { ...sync, controllerInstanceId: 'controller-1', expectedRevision: 0, runId: null, command: 'START' };
    expect(isGameOperatorCommand(request)).toBe(true);
    for (const patch of [{ command: 'INPUT' }, { action: 'LEFT_ACTION' }, { expectedRevision: -1 }, { expectedRevision: Infinity }, { requestId: '' }, { version: 0 }]) {
      expect(isGameOperatorCommand({ ...request, ...patch })).toBe(false);
    }
  });
  it('compares semantic content independent of property order', () => {
    const reordered = Object.fromEntries(Object.entries(idle).reverse()) as unknown as GameStateSnapshot;
    expect(gameSnapshotKey(reordered)).toBe(gameSnapshotKey(idle));
    expect(gameSnapshotKey({ ...idle, revision: 1 })).not.toBe(gameSnapshotKey(idle));
  });
});
