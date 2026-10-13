import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isGameStateSnapshot } from '@plank-stork/protocol';
import { GameController } from './gameController';
import { GameTestPanel } from '../components/GameTestPanel';
import { testSocket } from '../remote/testSocket';
import { useGameRemote } from '../../../mobile/src/game/useGameRemote';
import { GamePanel } from '../../../mobile/src/game/GamePanel';

describe('SCRIPT demo React lifecycle and mobile failure UX', () => {
  let root: Root, host: HTMLDivElement, owner: GameController;
  let controller: ReturnType<typeof testSocket>, mobile: ReturnType<typeof testSocket>;
  let remote: ReturnType<typeof useGameRemote>;
  let visible = true, clockOffset = 0;
  const controllerPanel = () => host.querySelector('#controller')!;
  const mobilePanel = () => host.querySelector('#mobile')!;
  const click = (text: string, panel = controllerPanel()) => act(() => [...panel.querySelectorAll('button')].find((b) => b.textContent === text)!.click());
  const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
  function Mobile() { remote = useGameRemote(mobile.asSocket()); return <GamePanel remote={remote} />; }
  function render() {
    act(() => root.render(<StrictMode><div id="controller"><GameTestPanel owner={owner} socket={controller.asSocket()} /></div>
      <div id="mobile"><Mobile /></div></StrictMode>));
    act(() => remote.select(owner.instanceId));
  }
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(100000); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    visible = true; clockOffset = 0;
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible ? 'visible' : 'hidden');
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now() + clockOffset);
    owner = new GameController('script-controller', () => performance.now());
    controller = testSocket(); mobile = testSocket();
    // Two clients, existing event names. Actual NestJS coverage stays in gameRelay.test.ts.
    controller.emit.mockImplementation((name, payload) => {
      if (name === 'game:state:publish' && mobile.connected && isGameStateSnapshot(payload)) mobile.receive('game:state', payload);
    });
    mobile.emit.mockImplementation((name, payload) => {
      if (!controller.connected) return;
      if (name === 'game:sync:request') controller.receive('game:sync:requested', payload);
      if (name === 'game:command') controller.receive('game:command:requested', payload);
    });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); host.remove();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });
  it('runs hands-free through wrong feedback to 4/4 with SCRIPT provenance on both views', () => {
    render(); click('Start Scripted Demo');
    expect(controllerPanel().textContent).toContain('DEMO — SCRIPTED INPUT');
    expect(mobilePanel().textContent).toContain('DEMO — SCRIPTED INPUT');
    expect(mobilePanel().textContent).toContain('실제 운동 인식이 아닙니다');
    expect(remote.snapshot).toMatchObject({ phase: 'RUNNING', score: 0 });
    advance(2000); expect(remote.snapshot).toMatchObject({ score: 0, feedback: { outcome: 'WRONG' } });
    for (const score of [1, 2, 3, 4]) { advance(2000); expect(remote.snapshot?.score).toBe(score); }
    expect(controllerPanel().textContent).toContain('COMPLETED — DEMO — SCRIPTED INPUT');
    expect(mobilePanel().textContent).toContain('COMPLETED — TEST 결과');
    expect(owner.getView().state.history).toHaveLength(5);
    expect(host.querySelector('video')).toBeNull();
    expect(controller.emit.mock.calls.every(([event]) => event === 'game:state:publish')).toBe(true);
  });
  it('blocks keyboard, duplicate buttons and rerender restarts during SCRIPT; later KEYBOARD still works', () => {
    render(); click('Start Scripted Demo');
    const runId = owner.getView().snapshot.runId;
    click('Start Scripted Demo'); click('Start Game'); render();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft' })); });
    expect(owner.getView().state.history).toHaveLength(0); expect(owner.getView().snapshot.runId).toBe(runId);
    advance(2000); expect(owner.getView().state.lastAcceptedSequence).toBe(1);
    click('Reset Game'); click('Start Game');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft' })); });
    expect(remote.snapshot).toMatchObject({ score: 1, provenance: { kind: 'TEST', method: 'KEYBOARD' } });
  });
  it.each(['Stop Game', 'Reset Game'])('mobile %s interrupts, clears score and never displays COMPLETED', (button) => {
    render(); click('Start Scripted Demo'); advance(4000); expect(remote.snapshot?.score).toBe(1);
    click(button, mobilePanel());
    expect(remote.snapshot).toMatchObject({ phase: 'IDLE', score: 0, scriptStopReason: button === 'Stop Game' ? 'STOP' : 'RESET' });
    expect(mobilePanel().textContent).toContain('DEMO 중단');
    advance(20000); expect(mobilePanel().textContent).not.toContain('COMPLETED');
    expect(controllerPanel().textContent).not.toContain('COMPLETED');
  });
  it('hidden/foreground and pagehide abort immediately, discard backlog and require a new run', () => {
    render(); click('Start Scripted Demo'); advance(4000);
    const oldRun = remote.snapshot!.runId;
    act(() => { visible = false; document.dispatchEvent(new Event('visibilitychange')); });
    expect(remote.snapshot).toMatchObject({ phase: 'IDLE', score: 0, scriptStopReason: 'PAGE_HIDDEN' });
    advance(60000);
    act(() => { visible = true; document.dispatchEvent(new Event('visibilitychange')); });
    expect(remote.snapshot?.phase).toBe('IDLE');
    click('Start Scripted Demo'); expect(remote.snapshot?.runId).not.toBe(oldRun);
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(remote.snapshot?.scriptStopReason).toBe('PAGE_HIDDEN');
  });
  it('large clock delay aborts before any overdue input or false completion reaches either UI', () => {
    render(); click('Start Scripted Demo'); clockOffset = 5000; advance(2000);
    expect(remote.snapshot).toMatchObject({ phase: 'IDLE', score: 0, scriptStopReason: 'TIMER_DELAY' });
    expect(mobilePanel().textContent).toContain('DEMO 중단 — TIMER_DELAY');
    expect(owner.getView().state.history).toHaveLength(0);
  });
  it('Socket disconnect does not stop local SCRIPT; reconnect transmits only its latest completed snapshot', () => {
    render(); click('Start Scripted Demo'); advance(2000);
    act(() => { controller.connected = false; mobile.connected = false; controller.receive('disconnect'); mobile.receive('disconnect'); });
    controller.emit.mockClear(); advance(8000);
    expect(owner.getView().snapshot).toMatchObject({ phase: 'COMPLETED', score: 4 });
    expect(controller.emit).not.toHaveBeenCalled();
    expect(mobilePanel().textContent).toContain('LAST KNOWN'); expect(mobilePanel().textContent).not.toContain('COMPLETED');
    act(() => { mobile.connected = true; mobile.receive('connect'); });
    expect(mobilePanel().textContent).toContain('SYNCING');
    act(() => { controller.connected = true; controller.receive('connect'); });
    expect(controller.emit).toHaveBeenCalledTimes(1);
    expect(remote.snapshot).toMatchObject({ phase: 'COMPLETED', score: 4, provenance: { method: 'SCRIPT' } });
    expect(owner.getView().state.history).toHaveLength(5);
  });
  it('StrictMode unmount cancels the runner and visibility listeners; remount never auto-resumes', async () => {
    const removeDocument = vi.spyOn(document, 'removeEventListener'), removeWindow = vi.spyOn(window, 'removeEventListener');
    render(); click('Start Scripted Demo'); advance(2000);
    await act(async () => root.render(null));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(vi.getTimerCount()).toBe(0);
    expect(owner.getView().snapshot).toMatchObject({ phase: 'IDLE', scriptStopReason: 'UNMOUNT' });
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(removeWindow).toHaveBeenCalledWith('pagehide', expect.any(Function));
    const revision = owner.getView().snapshot.revision;
    advance(20000); render(); advance(20000);
    expect(owner.getView().snapshot.revision).toBe(revision);
    expect(controllerPanel().textContent).toContain('DEMO 중단 — UNMOUNT');
  });
});
