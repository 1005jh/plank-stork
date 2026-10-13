import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_HEARTBEAT_MS, GAME_STALE_MS, type GameOperatorCommand, type GameStateSnapshot } from '@plank-stork/protocol';
import { testSocket } from '../remote/testSocket';
import { GameController } from './gameController';
import { GameTestPanel } from '../components/GameTestPanel';
import { useGameRemote } from '../../../mobile/src/game/useGameRemote';
import { GamePanel } from '../../../mobile/src/game/GamePanel';

describe('game React publisher and mobile lifecycle', () => {
  let root: Root, container: HTMLDivElement, now: number;
  let socket: ReturnType<typeof testSocket>, owner: GameController;
  let remote: ReturnType<typeof useGameRemote>;
  function Mobile({ source = socket }: { source?: ReturnType<typeof testSocket> }) {
    remote = useGameRemote(source.asSocket()); return <GamePanel remote={remote} />;
  }
  const renderController = (source = socket) => act(() => root.render(<StrictMode><GameTestPanel owner={owner} socket={source.asSocket()} /></StrictMode>));
  const renderMobile = (source = socket) => act(() => root.render(<StrictMode><Mobile source={source} /></StrictMode>));
  const emitted = () => socket.emit.mock.calls.filter(([name]) => name === 'game:state:publish').map(([, s]) => s as GameStateSnapshot);
  const click = (label: string) => act(() => [...container.querySelectorAll('button')].find((b) => b.textContent === label)!.click());
  const press = (key: string) => act(() => {
    now += 1;
    window.dispatchEvent(new KeyboardEvent('keydown', { key, code: key }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key, code: key }));
  });
  beforeEach(() => {
    vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    now = 10; vi.spyOn(performance, 'now').mockImplementation(() => now);
    socket = testSocket(); owner = new GameController('controller-test', () => now);
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => {
    act(() => root.unmount()); container.remove();
    // Flush due React/jsdom tasks; do not advance a heartbeat/watchdog interval.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });
  it('publishes keyboard score and wrong feedback; heartbeat repeats exactly the same revision/payload', () => {
    renderController(); click('Start Game'); press('ArrowRight');
    expect(emitted().at(-1)).toMatchObject({ score: 0, feedback: { outcome: 'WRONG' } });
    press('ArrowLeft'); const latest = emitted().at(-1)!;
    expect(latest).toMatchObject({ score: 1, targetIndex: 1 });
    act(() => { vi.advanceTimersByTime(GAME_HEARTBEAT_MS); });
    expect(emitted().at(-1)).toEqual(latest);
    expect(owner.getView().state.history).toHaveLength(2);
    act(() => owner.input(owner.getView().state.history[1].input));
    expect(emitted().at(-1)).toEqual(latest);
  });
  it('keeps offline keyboard game running, reconnect/sync publish latest full snapshot only', () => {
    socket.connected = false; renderController(); click('Start Game'); press('ArrowLeft'); press('ArrowRight');
    expect(socket.emit).not.toHaveBeenCalled();
    act(() => { socket.connected = true; socket.receive('connect'); });
    expect(emitted()).toHaveLength(1); expect(emitted()[0]).toMatchObject({ score: 2 });
    act(() => socket.receive('game:sync:requested', { version: 1, requestId: 'sync', controllerInstanceId: 'controller-test' }));
    expect(emitted()).toHaveLength(2); expect(emitted()[1]).toEqual(emitted()[0]);
    act(() => socket.receive('game:sync:requested', { version: 1, requestId: 'other', controllerInstanceId: 'other-controller' }));
    expect(emitted()).toHaveLength(2);
    expect(socket.emit.mock.calls.every(([name]) => name === 'game:state:publish')).toBe(true);
  });
  it('handles operator START/STOP once and rejects stale/reset commands without camera or Pose', () => {
    renderController();
    const start: GameOperatorCommand = { version: 1, requestId: 'start', controllerInstanceId: owner.instanceId,
      runId: null, expectedRevision: 0, command: 'START' };
    act(() => { socket.receive('game:command:requested', start); socket.receive('game:command:requested', start); });
    expect(owner.getView().state.usedRunIds).toHaveLength(1);
    expect(owner.getView().snapshot.revision).toBe(1);
    const stop = { ...start, requestId: 'stop', expectedRevision: 1, runId: owner.getView().snapshot.runId, command: 'STOP' };
    act(() => socket.receive('game:command:requested', stop));
    expect(owner.getView().snapshot).toMatchObject({ phase: 'IDLE', score: 0, revision: 2, commandResult: { status: 'ACCEPTED' } });
    act(() => socket.receive('game:command:requested', { ...stop, requestId: 'old-reset', command: 'RESET' }));
    expect(owner.getView().snapshot.commandResult).toMatchObject({ status: 'REJECTED', reason: 'WRONG_RUN' });
  });
  it('cleans publisher timers/listeners on socket replacement and StrictMode unmount; owner survives view remount', async () => {
    renderController(); click('Start Game'); press('ArrowLeft');
    const revision = owner.getView().snapshot.revision;
    expect(socket.listenerCount('game:command:requested')).toBe(1);
    const replacement = testSocket(); renderController(replacement);
    expect(socket.listenerCount('game:command:requested')).toBe(0);
    expect(socket.listenerCount('connect')).toBe(0);
    expect(replacement.listenerCount('game:command:requested')).toBe(1);
    act(() => root.render(null));
    expect(replacement.listenerCount('game:sync:requested')).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(vi.getTimerCount()).toBe(0);
    renderController(replacement);
    expect(owner.getView().snapshot.revision).toBe(revision);
    expect(owner.getView().snapshot.score).toBe(1);
  });
  it('requires selection, labels TEST score, waits for approval and exposes STOP score reset meaning', () => {
    renderMobile();
    expect(socket.emit).toHaveBeenCalledWith('game:sync:request', expect.objectContaining({ controllerInstanceId: null }));
    act(() => socket.receive('game:state', owner.getView().snapshot));
    expect(container.textContent).toContain('SELECT_CONTROLLER');
    act(() => remote.select(owner.instanceId));
    expect(container.textContent).toContain('LIVE');
    expect(container.textContent).toContain('TEST INPUT — KEYBOARD');
    expect(container.textContent).toContain('실제 운동 기록이나 니킥 인식 횟수가 아닙니다');
    expect(container.textContent).toContain('Reset / Stop은 점수를 지우고 IDLE로 돌아갑니다');
    click('Start Game');
    expect(remote.snapshot?.phase).toBe('IDLE'); expect(remote.pending?.command).toBe('START');
    const request = socket.emit.mock.calls.find(([name]) => name === 'game:command')![1];
    owner.command(request); act(() => socket.receive('game:state', owner.getView().snapshot));
    expect(remote.snapshot?.phase).toBe('RUNNING'); expect(remote.pending).toBeNull();
    expect(container.textContent).toContain('START: ACCEPTED');
    expect(container.querySelector('video')).toBeNull();
  });
  it('shows last known values and disables operator commands on stale/disconnect/reconnect until new state', () => {
    renderMobile(); act(() => { socket.receive('game:state', owner.getView().snapshot); remote.select(owner.instanceId); });
    act(() => { now += GAME_STALE_MS; vi.advanceTimersByTime(250); });
    expect(container.textContent).toContain('STALE');
    expect(container.textContent).toContain('LAST KNOWN');
    expect([...container.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
    socket.emit.mockClear(); act(() => remote.send('START')); expect(socket.emit).not.toHaveBeenCalled();
    act(() => { socket.connected = false; socket.receive('disconnect'); });
    expect(container.textContent).toContain('DISCONNECTED');
    act(() => { socket.connected = true; socket.receive('connect'); });
    expect(container.textContent).toContain('SYNCING');
    expect(container.textContent).toContain('LAST KNOWN');
    expect(socket.emit).toHaveBeenCalledWith('game:sync:request', expect.objectContaining({ controllerInstanceId: owner.instanceId }));
    act(() => socket.receive('game:state', owner.getView().snapshot));
    expect(container.textContent).not.toContain('LAST KNOWN');
    expect(container.textContent).toContain('LIVE');
  });
  it('keeps selected controller on conflict and quarantines conflicting revision in the visible UI', () => {
    renderMobile(); act(() => { socket.receive('game:state', owner.getView().snapshot); remote.select(owner.instanceId); });
    owner.start(); act(() => socket.receive('game:state', owner.getView().snapshot));
    act(() => socket.receive('game:state', new GameController('other', () => 0).getView().snapshot));
    expect(container.textContent).toContain('여러 Controller');
    expect(remote.selectedId).toBe(owner.instanceId);
    act(() => socket.receive('game:state', { ...owner.getView().snapshot, feedback: { action: 'RIGHT_ACTION', target: 'LEFT_ACTION', outcome: 'WRONG' } }));
    expect(container.textContent).toContain('REVISION_CONFLICT');
    expect(container.textContent).toContain('LAST KNOWN');
  });
  it('cancels pending and all listeners/watchdog on socket replacement and unmount', () => {
    renderMobile(); act(() => { socket.receive('game:state', owner.getView().snapshot); remote.select(owner.instanceId); remote.send('START'); });
    expect(remote.pending).not.toBeNull();
    expect(socket.listenerCount('game:state')).toBe(1);
    const replacement = testSocket(); renderMobile(replacement);
    expect(socket.listenerCount('game:state')).toBe(0);
    expect(socket.listenerCount('disconnect')).toBe(0);
    expect(remote.pending).toBeNull(); expect(remote.status).toBe('SYNCING');
    act(() => root.render(null));
    expect(replacement.listenerCount('game:state')).toBe(0);
    expect(replacement.listenerCount('connect')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const before = replacement.emit.mock.calls.length;
    act(() => { replacement.receive('connect'); replacement.receive('game:state', owner.getView().snapshot); vi.advanceTimersByTime(10000); });
    expect(replacement.emit).toHaveBeenCalledTimes(before);
  });
});
