// Reuse controller-web's existing React/jsdom runner; mobile adds no test dependencies.
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalibrationRemoteState } from '@plank-stork/protocol';
import { CalibrationPanel } from '../../../mobile/src/calibration/CalibrationPanel';
import { useCalibrationRemote, REMOTE_STATE_TIMEOUT_MS } from '../../../mobile/src/calibration/useCalibrationRemote';
import { testSocket } from './testSocket';

function initialSnapshot(): CalibrationRemoteState {
  return {
    timestamp: 9999999999999, // Deliberately different clock from the phone.
    controller: { cameraRunning: true, poseDetected: true },
    neutral: { status: 'NOT_CALIBRATED', collectionState: 'IDLE', hipSamples: 0, leftKneeSamples: 0, rightKneeSamples: 0,
      hipReady: false, leftKneeReady: false, rightKneeReady: false, kneeGraceRemainingMs: 0, frozen: false },
    actionCalibration: { status: 'IDLE', phase: 'IDLE', action: null, remainingMs: 0,
      readiness: { TWIST_LEFT: false, TWIST_RIGHT: false, KNEE_LEFT: false, KNEE_RIGHT: false } },
    classification: null, lastCommandError: null,
    validation: { status: 'IDLE', phase: 'IDLE', expectedAction: null, remainingMs: 0, recordedFrames: 0 },
    motionValidation: { status: 'IDLE', phase: 'IDLE', expectedMotion: null, remainingMs: 0, recordedFrames: 0 },
  };
}
function completedSnapshot(): CalibrationRemoteState {
  const state = initialSnapshot();
  state.neutral = { ...state.neutral, status: 'CALIBRATED', collectionState: 'FROZEN', hipReady: true, hipSamples: 20, frozen: true };
  state.actionCalibration = { ...state.actionCalibration, status: 'COMPLETED', phase: 'COMPLETED',
    readiness: { TWIST_LEFT: true, TWIST_RIGHT: true, KNEE_LEFT: true, KNEE_RIGHT: true } };
  state.classification = { rawAction: 'TWIST_LEFT', stableAction: 'TWIST_LEFT', confidence: 0.82, reason: 'OK',
    neutralMovementScore: 1.1, bestDistance: 0.2, secondBestDistance: 1.2,
    actionDistances: { TWIST_LEFT: 0.2, TWIST_RIGHT: 1.2, KNEE_LEFT: 2, KNEE_RIGHT: 2.1 } };
  return state;
}

describe('phone calibration remote UI and connection lifecycle', () => {
  let socket: ReturnType<typeof testSocket>; let root: Root; let container: HTMLDivElement; let now: number;
  const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === label)!;
  const receive = async (state: CalibrationRemoteState) => act(async () => socket.receive('calibration:state', state));
  async function advance(ms: number) { now += ms; await act(async () => vi.advanceTimersByTime(ms)); }
  function Phone() {
    const remote = useCalibrationRemote(socket.asSocket());
    return <CalibrationPanel connected={socket.connected} state={remote.state} send={remote.send} />;
  }

  beforeEach(async () => {
    vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now);
    socket = testSocket(); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(<StrictMode><Phone /></StrictMode>));
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it('requests sync when connected, waits for controller state, and sends typed start/reset requests', async () => {
    expect(socket.emit).toHaveBeenCalledWith('calibration:sync:request', expect.objectContaining({ requestId: expect.any(String), timestamp: expect.any(Number) }));
    expect(container.textContent).toContain('연결 대기');
    expect(button('Neutral 보정 시작').disabled).toBe(true);
    await receive(initialSnapshot());
    expect(button('Neutral 보정 시작').disabled).toBe(false);
    expect(button('동작 보정 시작').disabled).toBe(true);
    await act(async () => button('Neutral 보정 시작').click());
    expect(socket.emit).toHaveBeenLastCalledWith('calibration:neutral:start', expect.objectContaining({ requestId: expect.any(String) }));
    await receive(completedSnapshot());
    await act(async () => button('다시 보정').click());
    expect(socket.emit).toHaveBeenLastCalledWith('calibration:action:start', expect.any(Object));
    await act(async () => button('동작 보정 초기화').click());
    expect(socket.emit).toHaveBeenLastCalledWith('calibration:action:reset', expect.any(Object));
  });

  it.each([{ cameraRunning: false, poseDetected: false }, { cameraRunning: true, poseDetected: false }])('disables Neutral when %o', async (controller) => {
    await receive({ ...initialSnapshot(), controller });
    expect(button('Neutral 보정 시작').disabled).toBe(true);
    if (!controller.cameraRunning) expect(container.textContent).toContain('카메라 준비 필요');
    else expect(container.textContent).toContain('NOT DETECTED');
  });

  it('shows HIP progress, FINISHING countdown and FROZEN even with partial knees', async () => {
    const state = initialSnapshot();
    state.neutral = { ...state.neutral, collectionState: 'HIP', status: 'CALIBRATING', hipSamples: 18, leftKneeSamples: 12, rightKneeSamples: 20 };
    await receive(state);
    expect(container.textContent).toContain('기본 플랭크 자세를 유지하세요');
    expect(container.textContent).toContain('18 / 20');
    expect(button('Neutral 보정 시작').disabled).toBe(true);
    state.neutral = { ...state.neutral, status: 'CALIBRATED', collectionState: 'FINISHING', hipReady: true, hipSamples: 20, kneeGraceRemainingMs: 600 };
    await receive({ ...state });
    expect(container.textContent).toContain('기본 자세를 조금만 더 유지하세요');
    expect(container.textContent).toContain('0.6초');
    expect(button('동작 보정 시작').disabled).toBe(true);
    state.neutral = { ...state.neutral, collectionState: 'FROZEN', frozen: true, kneeGraceRemainingMs: 0 };
    await receive({ ...state });
    expect(container.textContent).toContain('기본 자세 보정 완료 ✓');
    expect(button('동작 보정 시작').disabled).toBe(false);
  });

  it.each([
    ['PREPARE', null, '기본 플랭크 자세를 유지하세요'],
    ['MOVE', 'TWIST_LEFT', '← 왼쪽 트위스트'],
    ['RECORD', 'KNEE_RIGHT', '그대로 유지하세요'],
    ['RETURN_NEUTRAL', null, '기본 플랭크 자세로 돌아오세요'],
  ] as const)('displays controller %s instructions/countdown without advancing a local sequence', async (phase, action, instruction) => {
    const state = completedSnapshot();
    state.actionCalibration = { ...state.actionCalibration, status: 'ACTIVE', phase, action, remainingMs: 620 };
    await receive(state);
    expect(container.querySelector('.action-guide')!.textContent).toContain(instruction);
    expect(container.querySelector('.countdown')!.textContent).toBe('0.6초');
    expect(button('동작 보정 시작').disabled).toBe(true);
    await advance(500);
    expect(container.querySelector('.countdown')!.textContent).toBe('0.6초');
    expect(container.querySelector('.phase')!.textContent).toContain(phase);
  });

  it('shows completed readiness and live stable/raw/confidence/distances; partial prototypes request retry', async () => {
    const state = completedSnapshot();
    await receive(state);
    expect(container.textContent).toContain('동작 보정 완료 ✓');
    const live = () => container.querySelector('[aria-labelledby="live-title"]')!;
    expect(live().querySelector('[role="status"]')!.textContent).toBe('TWIST LEFT');
    expect(live().textContent).toContain('Confidence0.82');
    expect(live().textContent).toContain('Best Distance0.200');
    state.classification = { ...state.classification!, rawAction: 'NONE', stableAction: 'NONE' };
    await receive({ ...state });
    expect(live().querySelector('[role="status"]')!.textContent).toBe('NEUTRAL');
    state.actionCalibration = { ...state.actionCalibration, readiness: { ...state.actionCalibration.readiness, KNEE_LEFT: false } };
    await receive({ ...state });
    expect(container.textContent).toContain('KNEE LEFT RETRY NEEDED');
    expect(live().textContent).toContain('동작 보정 필요');
  });

  it('masks an old action immediately on POSE_STALE and returns to calibration-needed after reset', async () => {
    const state = completedSnapshot();
    await receive(state);
    await receive({ ...state, classification: { ...state.classification!, reason: 'POSE_STALE' } });
    const live = container.querySelector('[aria-labelledby="live-title"]')!;
    expect(live.querySelector('[role="status"]')!.textContent).toContain('POSE STALE');
    expect(live.textContent).toContain('RawNONEStableNONE');
    await receive({ ...initialSnapshot(), neutral: state.neutral });
    expect(container.textContent).toContain('동작 보정 필요');
    expect(container.querySelector('[aria-labelledby="live-title"]')).toBeNull();
  });

  it('expires silent controller snapshots by local receipt time and resyncs on reconnect', async () => {
    await receive(completedSnapshot());
    await advance(REMOTE_STATE_TIMEOUT_MS - 250);
    expect(container.textContent).not.toContain('연결 대기');
    await advance(250);
    expect(container.textContent).toContain('연결 대기');
    expect(container.querySelector('[aria-labelledby="live-title"]')).toBeNull();
    await receive(completedSnapshot());
    socket.connected = false;
    await act(async () => socket.receive('disconnect'));
    expect(container.textContent).toContain('연결 대기');
    socket.emit.mockClear();
    await act(async () => button('Neutral 보정 시작').click());
    expect(socket.emit).not.toHaveBeenCalled();
    socket.connected = true;
    await act(async () => socket.receive('connect'));
    expect(socket.emit).toHaveBeenCalledWith('calibration:sync:request', expect.any(Object));
    expect(container.textContent).toContain('연결 대기');
    await receive(initialSnapshot());
    expect(container.textContent).not.toContain('연결 대기');
  });

  it('cleans listeners and watchdog on StrictMode unmount', async () => {
    for (const event of ['connect', 'disconnect', 'connect_error', 'calibration:state']) expect(socket.listenerCount(event)).toBe(1);
    await act(async () => root.unmount());
    for (const event of ['connect', 'disconnect', 'connect_error', 'calibration:state']) expect(socket.listenerCount(event)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('enables validation only after all prototypes are ready and sends start/reset requests', async () => {
    await receive(initialSnapshot());
    expect(button('동작 검증 시작').disabled).toBe(true);
    const state = completedSnapshot(); state.actionCalibration.readiness.KNEE_LEFT = false;
    await receive(state);
    expect(button('동작 검증 시작').disabled).toBe(true);
    state.actionCalibration.readiness.KNEE_LEFT = true;
    await receive({ ...state });
    expect(button('동작 검증 시작').disabled).toBe(false);
    await act(async () => button('동작 검증 시작').click());
    expect(socket.emit).toHaveBeenLastCalledWith('validation:start', expect.objectContaining({ requestId: expect.any(String) }));
    state.validation = { status: 'ACTIVE', phase: 'PREPARE', expectedAction: 'NONE', remainingMs: 2000, recordedFrames: 0 };
    await receive({ ...state });
    expect(button('동작 검증 시작').disabled).toBe(true);
    await act(async () => button('검증 초기화').click());
    expect(socket.emit).toHaveBeenLastCalledWith('validation:reset', expect.any(Object));
  });

  it.each([
    ['PREPARE', 'NONE', '동작 검증을 시작합니다'],
    ['RECORD_NEUTRAL', 'NONE', '기본 자세를 유지하세요'],
    ['MOVE', 'TWIST_LEFT', '← 왼쪽 트위스트'],
    ['RECORD_ACTION', 'KNEE_RIGHT', '그대로 유지하세요'],
    ['RETURN_NEUTRAL', 'NONE', '기본 플랭크 자세로 돌아오세요'],
  ] as const)('shows validation %s from the controller without advancing its countdown', async (phase, expectedAction, text) => {
    const state = completedSnapshot();
    state.validation = { status: 'ACTIVE', phase, expectedAction, remainingMs: 620, recordedFrames: 42 };
    await receive(state);
    const guide = container.querySelector('.validation-guide')!;
    expect(guide.textContent).toContain(text); expect(guide.textContent).toContain('42');
    expect(guide.querySelector('.countdown')!.textContent).toBe('0.6초');
    await advance(500);
    expect(guide.querySelector('.countdown')!.textContent).toBe('0.6초');
    await advance(1000);
    expect(container.querySelector('.validation-guide')).toBeNull();
    expect(container.textContent).toContain('연결 대기');
  });

  it('shows completed recording count and directs JSON download to the laptop', async () => {
    const state = completedSnapshot();
    state.validation = { status: 'COMPLETED', phase: 'COMPLETED', expectedAction: null, remainingMs: 0, recordedFrames: 345 };
    await receive(state);
    const panel = container.querySelector('[aria-labelledby="mobile-validation-title"]')!;
    expect(panel.textContent).toContain('동작 검증 기록 완료');
    expect(panel.textContent).toContain('345 frames');
    expect(panel.textContent).toContain('Laptop');
    expect(button('다시 검증').disabled).toBe(false);
  });

  it('enables Knee Motion with Neutral alone, without any Action prototype, and sends start/reset', async () => {
    await receive(initialSnapshot());
    expect(button('Knee Motion Validation 시작').disabled).toBe(true);
    const state = initialSnapshot(); state.neutral = completedSnapshot().neutral;
    await receive(state);
    expect(state.actionCalibration.status).toBe('IDLE');
    expect(button('Knee Motion Validation 시작').disabled).toBe(false);
    await act(async () => button('Knee Motion Validation 시작').click());
    expect(socket.emit).toHaveBeenLastCalledWith('motion:validation:start', expect.objectContaining({ requestId: expect.any(String) }));
    state.motionValidation = { status: 'ACTIVE', phase: 'MOVE', expectedMotion: 'KNEE_LEFT', remainingMs: 800, recordedFrames: 42 };
    await receive({ ...state });
    expect(button('Knee Motion Validation 시작').disabled).toBe(true);
    await act(async () => button('Motion 검증 초기화').click());
    expect(socket.emit).toHaveBeenLastCalledWith('motion:validation:reset', expect.any(Object));
  });

  it.each([
    ['PREPARE', 'NEUTRAL', '기본 자세를 유지하세요'], ['NEUTRAL', 'NEUTRAL', '기본 자세를 유지하세요'],
    ['MOVE', 'TWIST_LEFT', '← 왼쪽 트위스트'], ['HOLD', 'KNEE_RIGHT', '유지하세요'], ['RETURN', 'KNEE_LEFT', '기본 자세로 돌아오세요'],
  ] as const)('shows motion phase %s only from controller snapshots', async (phase, expectedMotion, text) => {
    const state = initialSnapshot(); state.neutral = completedSnapshot().neutral;
    state.motionValidation = { status: 'ACTIVE', phase, expectedMotion, remainingMs: 620, recordedFrames: 60 };
    await receive(state);
    const guide = container.querySelector('.knee-motion-guide')!;
    expect(guide.textContent).toContain(text); expect(guide.textContent).toContain('60');
    expect(guide.querySelector('.countdown')!.textContent).toBe('0.6초');
    await advance(500);
    expect(guide.querySelector('.countdown')!.textContent).toBe('0.6초');
    await advance(1000);
    expect(container.querySelector('.knee-motion-guide')).toBeNull();
    expect(container.textContent).toContain('연결 대기');
  });

  it('shows completed motion measurement without a KICK verdict', async () => {
    const state = initialSnapshot(); state.neutral = completedSnapshot().neutral;
    state.motionValidation = { status: 'COMPLETED', phase: 'COMPLETED', expectedMotion: null, remainingMs: 0, recordedFrames: 390 };
    await receive(state);
    const panel = container.querySelector('[aria-labelledby="mobile-motion-title"]')!;
    expect(panel.textContent).toContain('Motion 검증 기록 완료'); expect(panel.textContent).toContain('390 frames');
    expect(panel.textContent).toContain('Download Motion Validation JSON');
  });
});
