// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GAME_STALE_MS } from '@plank-stork/protocol';
import { GameController } from './gameController';
import { GameRemoteState } from '../../../mobile/src/game/gameRemoteState';

function fixture() {
  const owner = new GameController('c', () => 0), remote = new GameRemoteState();
  remote.connection(true, 0); remote.receive(owner.getView().snapshot, 0); remote.select('c', 0);
  return { owner, remote };
}
describe('mobile full snapshot gate (no scoring authority)', () => {
  it('requires explicit selection and never automatically switches to a new/reloaded controller', () => {
    const { remote } = fixture();
    remote.receive(new GameController('new-page', () => 0).getView().snapshot, 1);
    expect(remote.getView()).toMatchObject({ selectedId: 'c', controllers: ['c', 'new-page'], snapshot: { controllerInstanceId: 'c' } });
    remote.select('new-page', 1); expect(remote.getView().snapshot?.controllerInstanceId).toBe('new-page');
    const empty = new GameRemoteState(); empty.connection(true, 0); empty.receive(new GameController('only', () => 0).getView().snapshot, 0);
    expect(empty.getView()).toMatchObject({ selectedId: null, snapshot: null, status: 'SELECT_CONTROLLER' });
  });
  it('ignores old revisions without refreshing freshness and identical heartbeats never add score', () => {
    const { remote, owner } = fixture(); const old = owner.getView().snapshot;
    owner.start(); const current = owner.getView().snapshot;
    remote.receive(current, 10); remote.receive(current, 1000);
    expect(remote.getView().snapshot).toEqual(current);
    remote.receive(old, 3999); remote.tick(4000);
    expect(remote.getView().status).toBe('STALE');
    expect(remote.getView().snapshot).toEqual(current);
    remote.receive(current, 4001); expect(remote.getView().status).toBe('LIVE');
  });
  it('quarantines same revision with different content until a newer coherent revision arrives', () => {
    const { remote, owner } = fixture(); owner.start(); remote.receive(owner.getView().snapshot, 0);
    const snapshot = owner.getView().snapshot;
    remote.receive({ ...snapshot, feedback: { action: 'RIGHT_ACTION', target: 'LEFT_ACTION', outcome: 'WRONG' } }, 1);
    expect(remote.getView()).toMatchObject({ status: 'STALE', error: 'REVISION_CONFLICT', snapshot });
    remote.receive(snapshot, 2); expect(remote.getView().status).toBe('STALE');
    owner.reset(); remote.receive(owner.getView().snapshot, 3); expect(remote.getView().status).toBe('LIVE');
  });
  it('rejects a retired run even with a higher revision, including after reset and reconnect', () => {
    const { remote, owner } = fixture(); owner.start(); const old = owner.getView().snapshot;
    remote.receive(old, 0); owner.reset(); remote.receive(owner.getView().snapshot, 1);
    owner.start(); const current = owner.getView().snapshot; remote.receive(current, 2);
    remote.connection(false, 3); remote.connection(true, 4);
    remote.receive({ ...old, revision: current.revision + 1 }, 5);
    expect(remote.getView()).toMatchObject({ error: 'RETIRED_RUN', snapshot: current });
  });
  it('rejects same-run progress reversal', () => {
    const { remote, owner } = fixture(); owner.start(); const before = owner.getView().snapshot;
    owner.input({ ...owner.getView().state.run, sequence: 1, occurredAtMs: 1, action: 'LEFT_ACTION', provenance: { kind: 'TEST', method: 'KEYBOARD' } });
    remote.receive(owner.getView().snapshot, 1);
    remote.receive({ ...before, revision: 99 }, 2);
    expect(remote.getView()).toMatchObject({ error: 'RUN_REGRESSION', snapshot: { score: 1 } });
  });
  it('does not recover on reconnect until a validated snapshot arrives in that connection', () => {
    const { remote, owner } = fixture();
    remote.connection(false, 1); expect(remote.getView().status).toBe('DISCONNECTED');
    remote.receive(owner.getView().snapshot, 2); expect(remote.getView().status).toBe('DISCONNECTED');
    remote.connection(true, 3); expect(remote.getView().status).toBe('SYNCING');
    expect(remote.request('START', 'offline', 3)).toBeNull();
    remote.receive(owner.getView().snapshot, 4); expect(remote.getView().status).toBe('LIVE');
  });
  it('guards the exact stale boundary synchronously, even before the watchdog ticks', () => {
    const { remote } = fixture();
    expect(remote.request('START', 'late', GAME_STALE_MS)).toBeNull();
    remote.tick(GAME_STALE_MS); expect(remote.getView().status).toBe('STALE');
  });
  it('waits for controller approval, forbids double send and shows rejection without optimistic score changes', () => {
    const { remote, owner } = fixture();
    const request = remote.request('START', 'request', 1)!;
    expect(remote.getView()).toMatchObject({ snapshot: { phase: 'IDLE', score: 0 }, pending: { requestId: 'request' } });
    expect(remote.request('START', 'again', 1)).toBeNull();
    owner.command({ ...request, expectedRevision: 10 }); remote.receive(owner.getView().snapshot, 2);
    expect(remote.getView()).toMatchObject({ pending: null, snapshot: { phase: 'IDLE' } });
    expect(remote.getView().commandMessage).toContain('REJECTED (WRONG_REVISION)');
  });
  it('times out without resending and cancels on disconnect, stale and selection change', () => {
    const { remote, owner } = fixture(); remote.request('START', 'a', 0);
    for (const now of [1000, 2000, 3000, 4000]) { remote.receive(owner.getView().snapshot, now); remote.tick(now); }
    expect(remote.getView()).toMatchObject({ pending: null, commandMessage: expect.stringContaining('TIMEOUT') });
    remote.request('START', 'b', 4000); remote.connection(false, 4001);
    expect(remote.getView().commandMessage).toContain('CANCELLED_DISCONNECT');
    remote.connection(true, 4002); remote.receive(owner.getView().snapshot, 4002);
    remote.request('START', 'c', 4002); remote.tick(7002);
    expect(remote.getView().commandMessage).toContain('CANCELLED_STALE');
    remote.receive(owner.getView().snapshot, 8000); remote.request('START', 'd', 8000);
    remote.receive(new GameController('other', () => 0).getView().snapshot, 8000); remote.select('other', 8001);
    expect(remote.getView().commandMessage).toContain('CANCELLED_SELECTION_CHANGE');
  });
  it('retains primitive snapshot ownership and rejects malformed/POSE payloads without exposing them', () => {
    const { remote, owner } = fixture(); const s = structuredClone(owner.getView().snapshot);
    remote.receive(s, 1); s.score = 100;
    expect(remote.getView().snapshot?.score).toBe(0);
    remote.receive({ ...s, provenance: { kind: 'POSE' } }, 2);
    expect(remote.getView()).toMatchObject({ error: 'INVALID_SNAPSHOT', snapshot: { score: 0 } });
  });
  it('does not carry an old controller approval into the newly selected controller view', () => {
    const { remote, owner } = fixture();
    owner.command(remote.request('START', 'accepted', 1));
    remote.receive(owner.getView().snapshot, 2);
    expect(remote.getView().commandMessage).toBe('START: ACCEPTED');
    remote.receive(new GameController('new-page', () => 0).getView().snapshot, 3);
    remote.select('new-page', 4);
    expect(remote.getView()).toMatchObject({ selectedId: 'new-page', commandMessage: null, snapshot: { phase: 'IDLE' } });
  });
  it.each(['KEYBOARD', 'SCRIPT'] as const)('blocks source changes within the same %s run, even at a newer revision', (method) => {
    const { remote, owner } = fixture();
    if (method === 'KEYBOARD') owner.start();
    else owner.startScriptedDemo({ isVisible: () => true, schedule: () => () => {} });
    const original = owner.getView().snapshot; remote.receive(original, 1);
    remote.receive({ ...original, revision: original.revision + 1,
      provenance: { kind: 'TEST', method: method === 'KEYBOARD' ? 'SCRIPT' : 'KEYBOARD' } }, 2);
    expect(remote.getView()).toMatchObject({ error: 'RUN_SOURCE_CHANGED', status: 'STALE', snapshot: original });
    owner.reset(); remote.receive(owner.getView().snapshot, 3);
    if (method === 'KEYBOARD') owner.startScriptedDemo({ isVisible: () => true, schedule: () => () => {} });
    else owner.start();
    remote.receive(owner.getView().snapshot, 4);
    expect(remote.getView().status).toBe('LIVE');
    expect(remote.getView().snapshot?.provenance.method).not.toBe(method);
  });
});
