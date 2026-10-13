import type { useGameRemote } from './useGameRemote';

export function GamePanel({ remote }: { remote: ReturnType<typeof useGameRemote> }) {
  const { snapshot: s, status, pending } = remote;
  const current = status === 'LIVE';
  const enabled = current && !pending;
  const scripted = s?.provenance.method === 'SCRIPT';
  return <section className="game-panel" aria-labelledby="game-title">
    <h2 id="game-title">LAN Game Remote</h2>
    <p><strong>{scripted ? 'DEMO — SCRIPTED INPUT' : 'TEST INPUT — KEYBOARD'}</strong></p>
    <p>테스트 점수입니다. 실제 운동 기록이나 니킥 인식 횟수가 아닙니다.</p>
    <p role="status">Game connection: <strong>{status}</strong></p>
    <label>Controller 선택 <select aria-label="Game Controller" value={remote.selectedId ?? ''}
      onChange={(event) => remote.select(event.target.value)}>
      <option value="" disabled>Controller를 직접 선택하세요</option>
      {remote.controllers.map((id) => <option key={id} value={id}>{id}</option>)}
    </select></label>
    {remote.controllers.length > 1 && <p>여러 Controller가 관측됐습니다. 선택한 Controller만 표시합니다. 새로고침한 Controller는 직접 다시 선택하세요.</p>}
    {remote.error && <p role="alert">Game protocol error: {remote.error}</p>}
    {s ? <div className={current ? 'game-current' : 'game-last-known'}>
      <p><strong>{current ? '현재 Controller snapshot' : 'LAST KNOWN — 이전 수신값, 현재 점수 아님'}</strong></p>
      <p>Controller: <code>{s.controllerInstanceId}</code></p>
      <p>Run: <code>{s.runId ?? '—'}</code> · Revision: {s.revision}</p>
      <dl>
        <dt>Phase</dt><dd>{s.phase}</dd>
        <dt>{current ? 'Current target' : 'Last known target'}</dt><dd className="game-target">{s.currentTarget?.replace('_ACTION', '') ?? '—'}</dd>
        <dt>{current ? 'Test score' : 'Last known TEST score'}</dt><dd>{s.score} / {s.totalTargets}</dd>
        <dt>완료 target</dt><dd>{s.targetIndex} / {s.totalTargets}</dd>
        <dt>Feedback</dt><dd>{s.feedback ? `${s.feedback.outcome}: ${s.feedback.action.replace('_ACTION', '')}` : '—'}</dd>
      </dl>
      {s.phase === 'COMPLETED' && <p>{current ? 'COMPLETED — TEST 결과' : '이전 TEST 완료 결과'}</p>}
      {s.scriptStopReason && <p role="status">{current ? 'DEMO 중단' : '이전 DEMO 중단'} — {s.scriptStopReason} · 점수 초기화됨. 자동 재개하지 않습니다.</p>}
    </div> : <p>Controller 선택 및 최신 snapshot 수신 대기</p>}
    <p>{scripted ? '고정된 TEST 시나리오가 자동 진행됩니다. 반복 터치가 필요 없으며 실제 운동 인식이 아닙니다.'
      : '운동 전후 조작용입니다. 실제 TEST action은 노트북의 방향키로 입력하세요.'}</p>
    <p>Mobile Start Game은 KEYBOARD TEST를 시작합니다. SCRIPT 데모 시작·재시작은 Controller에서 선택하세요.</p>
    <div className="game-commands">
      <button disabled={!enabled || s?.phase === 'RUNNING'} onClick={() => remote.send('START')}>Start Game</button>
      <button disabled={!enabled} onClick={() => remote.send('RESET')}>Reset Game</button>
      <button disabled={!enabled || s?.phase !== 'RUNNING'} onClick={() => remote.send('STOP')}>Stop Game</button>
    </div>
    <p>Reset / Stop은 점수를 지우고 IDLE로 돌아갑니다.</p>
    {remote.commandMessage && <p role="status">{remote.commandMessage}</p>}
  </section>;
}
