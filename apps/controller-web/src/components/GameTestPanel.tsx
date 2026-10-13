import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { GameController, getPageControllerInstanceId } from '../game/gameController';
import { useGamePublisher, type GameSocket } from '../game/useGamePublisher';
import { GAME_TARGETS } from '../game/gameTypes';
import { useKeyboardGameInput } from '../game/useKeyboardGameInput';
import { SCRIPT_MAX_LATENESS_MS } from '../game/scriptedGameInput';

/** One TEST owner; the optional publisher observes it and never creates another reducer. */
export function GameTestPanel({ socket = null, owner: pageOwner }: { socket?: GameSocket | null; owner?: GameController }) {
  const [owner] = useState(() => pageOwner ?? new GameController(getPageControllerInstanceId(), () => performance.now()));
  const { state, snapshot } = useSyncExternalStore(owner.subscribe, owner.getView);
  useGamePublisher(owner, socket);
  const instanceId = useId();
  const panel = useRef<HTMLElement>(null);
  const scripted = snapshot.provenance.method === 'SCRIPT';
  const inputLabel = scripted ? 'DEMO — SCRIPTED INPUT' : 'TEST INPUT — KEYBOARD';
  useKeyboardGameInput(state.status === 'RUNNING' && !scripted ? state.run : null, owner.input);
  useEffect(() => {
    const visibility = () => { if (document.visibilityState !== 'visible') owner.interruptScript('PAGE_HIDDEN'); };
    const pagehide = () => owner.interruptScript('PAGE_HIDDEN');
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pagehide);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pagehide);
      owner.interruptScript('UNMOUNT');
    };
  }, [owner]);
  const target = state.status === 'RUNNING' ? GAME_TARGETS[state.targetIndex] : null;
  const lastAction = state.history.at(-1);

  function start() {
    if (state.status === 'RUNNING') return;
    owner.start();
    // Keep arrows away from the Start button's focus/navigation semantics.
    panel.current?.focus();
  }
  function reset() {
    owner.reset();
    panel.current?.focus();
  }
  function startScript() {
    owner.startScriptedDemo({ isVisible: () => document.visibilityState === 'visible',
      schedule: (callback, delay) => { const timer = window.setTimeout(callback, delay); return () => window.clearTimeout(timer); },
    });
    panel.current?.focus();
  }

  return <section ref={panel} tabIndex={0} aria-labelledby={`${instanceId}-game-title`}
    style={{ border: '1px solid #b8c9d2', borderRadius: 8, padding: '1rem', marginBlock: '1rem' }}>
    <h2 id={`${instanceId}-game-title`}>Local Game Test</h2>
    <p><strong>{inputLabel}</strong></p>
    <p>로컬 TEST 게임입니다. 실제 운동 기록이 아닙니다. 실제 운동 인식 데모가 아닙니다. 카메라·Socket 연결 없이 실행할 수 있습니다.</p>
    {!scripted && <p>Start Game 후 ArrowLeft / ArrowRight를 한 번씩 누르세요. 다른 UI 조작 후에는 이 패널을 클릭하거나 Tab으로 선택하세요.</p>}
    <p>Start Scripted Demo: 2·4·6·8·10초에 RIGHT → LEFT → RIGHT → LEFT → RIGHT 자동 입력 (첫 입력은 의도적 오답).</p>
    <p>데모 중에는 이 페이지를 보이는 상태로 유지하세요. 숨김 또는 {SCRIPT_MAX_LATENESS_MS}ms 초과 지연 시 중단·점수 초기화하며, 새 run으로만 재시작합니다.</p>
    <p>고정 순서: LEFT → RIGHT → LEFT → RIGHT · 정답 1점, 오답은 현재 target 유지</p>
    <div role="status" aria-live="polite">
      <dl>
        <dt>Game status</dt><dd aria-label="Game status">{state.status}</dd>
        <dt>Current target</dt><dd aria-label="Current target">{target?.replace('_ACTION', '') ?? '—'}</dd>
        <dt>Test score</dt><dd aria-label="Test score">{state.score} / {GAME_TARGETS.length}</dd>
        <dt>Progress</dt><dd aria-label="Game progress">{state.status === 'RUNNING' ? state.targetIndex + 1 : state.targetIndex} / {GAME_TARGETS.length}</dd>
        <dt>Last feedback</dt><dd aria-label="Game feedback">{lastAction
          ? `${lastAction.outcome === 'CORRECT' ? 'CORRECT · 정답' : 'WRONG · 오답'}: ${lastAction.input.action.replace('_ACTION', '')} (target ${lastAction.target.replace('_ACTION', '')})`
          : '—'}</dd>
      </dl>
      {state.status === 'COMPLETED' && <p><strong>COMPLETED — {inputLabel} · 테스트 점수 {state.score} / {GAME_TARGETS.length}</strong></p>}
      {snapshot.scriptStopReason && <p role="alert">DEMO 중단 — {snapshot.scriptStopReason} · 점수가 초기화되었습니다. 자동 재개하지 않습니다.</p>}
    </div>
    <button type="button" onClick={start} disabled={state.status === 'RUNNING'}>Start Game</button>{' '}
    <button type="button" onClick={startScript} disabled={state.status === 'RUNNING'}>Start Scripted Demo</button>{' '}
    <button type="button" onClick={owner.stop} disabled={state.status !== 'RUNNING'}>Stop Game</button>{' '}
    <button type="button" onClick={reset}>Reset Game</button>
    <details>
      <summary>Game input diagnostics</summary>
      <p>Run: {state.run?.runId ?? '—'}</p>
      <p>Controller: {snapshot.controllerInstanceId} · Revision: {snapshot.revision}</p>
      <p>Mobile STOP은 점수를 지우고 IDLE로 돌아갑니다. 연결 해제 중에도 로컬 게임은 계속됩니다.</p>
      <p>Accepted actions: {state.history.length} · Last sequence: {state.lastAcceptedSequence}</p>
      <p>Last rejection: {state.lastRejectReason ?? '—'}</p>
    </details>
  </section>;
}
