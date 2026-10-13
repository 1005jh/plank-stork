import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { GameController, getPageControllerInstanceId } from '../game/gameController';
import { useGamePublisher, type GameSocket } from '../game/useGamePublisher';
import { GAME_TARGETS } from '../game/gameTypes';
import { useKeyboardGameInput } from '../game/useKeyboardGameInput';

/** One TEST owner; the optional publisher observes it and never creates another reducer. */
export function GameTestPanel({ socket = null, owner: pageOwner }: { socket?: GameSocket | null; owner?: GameController }) {
  const [owner] = useState(() => pageOwner ?? new GameController(getPageControllerInstanceId(), () => performance.now()));
  const { state, snapshot } = useSyncExternalStore(owner.subscribe, owner.getView);
  useGamePublisher(owner, socket);
  const instanceId = useId();
  const panel = useRef<HTMLElement>(null);
  useKeyboardGameInput(state.status === 'RUNNING' ? state.run : null, owner.input);
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

  return <section ref={panel} tabIndex={0} aria-labelledby={`${instanceId}-game-title`}
    style={{ border: '1px solid #b8c9d2', borderRadius: 8, padding: '1rem', marginBlock: '1rem' }}>
    <h2 id={`${instanceId}-game-title`}>Local Game Test</h2>
    <p><strong>TEST INPUT — KEYBOARD</strong></p>
    <p>로컬 키보드 테스트입니다. 실제 운동 기록이 아닙니다. 카메라·Socket 연결 없이 실행할 수 있습니다.</p>
    <p>Start Game 후 ArrowLeft / ArrowRight를 한 번씩 누르세요. 다른 UI 조작 후에는 이 패널을 클릭하거나 Tab으로 선택하세요.</p>
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
      {state.status === 'COMPLETED' && <p><strong>COMPLETED — TEST INPUT — KEYBOARD · 테스트 점수 {state.score} / {GAME_TARGETS.length}</strong></p>}
    </div>
    <button type="button" onClick={start} disabled={state.status === 'RUNNING'}>Start Game</button>{' '}
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
