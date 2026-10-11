// Reuse controller-web's existing React/jsdom runner; mobile adds no test dependencies.
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalibrationRemoteState } from '@plank-stork/protocol';
import { CalibrationPanel } from '../../../mobile/src/calibration/CalibrationPanel';
import { useCalibrationRemote, REMOTE_STATE_TIMEOUT_MS } from '../../../mobile/src/calibration/useCalibrationRemote';
import { testSocket } from './testSocket';
import { captureReadinessFixture } from './testCaptureReadiness';

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
    kneeKick: { ready: false, validNow: false, usableLeftNow: false, usableRightNow: false, state: 'NOT_READY', currentEvent: 'NONE', lastEvent: null, counts: { KNEE_LEFT: 0, KNEE_RIGHT: 0 } },
    detectorTest: { waitingForArmed: false, status: 'IDLE', expected: null, remainingMs: 0, eventCount: 0, summary: null },
    motionValidation: { status: 'IDLE', phase: 'IDLE', expectedMotion: null, remainingMs: 0, recordedFrames: 0 },
    captureReadiness: captureReadinessFixture(),
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
function kickReadySnapshot(capture = captureReadinessFixture()): CalibrationRemoteState {
  const state = initialSnapshot();
  state.neutral = completedSnapshot().neutral;
  state.kneeKick = { ...state.kneeKick, ready: true, validNow: true, usableLeftNow: true, usableRightNow: true, state: 'ARMED' };
  state.captureReadiness = capture;
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

  it.each([
    ['ARMED', false, 'READY · ARMED'],
    ['WAIT_RETURN', false, 'READY · WAIT_RETURN'],
    ['CANDIDATE', false, 'KICK 후보 확인 중'],
  ] as const)('shows %s with correct start gating and guidance', async (detectorState, disabled, message) => {
    const state = initialSnapshot(); state.neutral = { ...state.neutral, frozen: true, collectionState: 'FROZEN' };
    state.kneeKick = { ...state.kneeKick, ready: true, validNow: true, usableLeftNow: true, usableRightNow: true, state: detectorState };
    await receive(state);
    expect(button('Guided Detector Test 시작').disabled).toBe(disabled);
    expect(container.querySelector('[aria-labelledby="mobile-kick-title"]')!.textContent).toContain(message);
    if (disabled) {
      socket.emit.mockClear(); await act(async () => button('Guided Detector Test 시작').click()); expect(socket.emit).not.toHaveBeenCalled();
    }
  });

  it.each([
    [true, true, true, 'Tracking OK', false],
    [false, true, true, 'Tracking Weak', false],
    [true, false, true, 'Tracking Weak', false],
    [false, false, false, 'Tracking Weak', false],
  ] as const)('shows usable knees L=%s R=%s and actionable start guidance', async (left, right, valid, message, disabled) => {
    const state = initialSnapshot(); state.neutral = { ...state.neutral, frozen: true, collectionState: 'FROZEN' };
    state.kneeKick = { ...state.kneeKick, ready: true, validNow: valid, usableLeftNow: left, usableRightNow: right, state: 'ARMED' };
    await receive(state);
    const panel = container.querySelector('[aria-labelledby="mobile-kick-title"]')!;
    expect(panel.textContent).toContain(message);
    expect(button('Guided Detector Test 시작').disabled).toBe(disabled);
    const reason = panel.querySelector('#kick-start-reason')!.textContent;
    expect(reason).toContain('현재 인식 상태와 관계없이');
    socket.emit.mockClear(); await act(async () => button('Guided Detector Test 시작').click());
    if (disabled) expect(socket.emit).not.toHaveBeenCalled();
    else expect(socket.emit).toHaveBeenCalledWith('kick:test:start', expect.any(Object));
    // Geometry guidance remains visible within the auto-scrolled active test, too.
    state.detectorTest = { ...state.detectorTest, status: 'ACTIVE', expected: 'KNEE_LEFT', remainingMs: 1000 };
    await receive({ ...state });
    expect(panel.querySelector('.action-guide')!.textContent).toContain(message);
  });

  it('explains camera/Neutral prerequisites beside the disabled test button', async () => {
    const state = initialSnapshot(); state.controller.cameraRunning = false;
    await receive(state);
    expect(button('Guided Detector Test 시작').disabled).toBe(true);
    expect(container.querySelector('#kick-start-reason')!.textContent).toContain('카메라를 시작');
    state.controller.cameraRunning = true;
    await receive({ ...state });
    expect(button('Guided Detector Test 시작').disabled).toBe(true);
    expect(container.querySelector('#kick-start-reason')!.textContent).toContain('기본 자세 보정을 먼저 완료');
  });

  it('keeps a countdown visible regardless of detector return state', async () => {
    const state = initialSnapshot(); state.neutral = { ...state.neutral, frozen: true, collectionState: 'FROZEN' };
    state.kneeKick = { ...state.kneeKick, ready: true, validNow: true, usableLeftNow: true, usableRightNow: true, state: 'WAIT_RETURN' };
    state.detectorTest = { status: 'ACTIVE', expected: 'NEUTRAL', remainingMs: 0, waitingForArmed: true, eventCount: 1, summary: null };
    await receive(state);
    const guide = () => container.querySelector('[aria-labelledby="mobile-kick-title"] .action-guide')!;
    expect(guide().textContent).not.toContain('Detector ARMED 대기 중'); expect(guide().querySelector('.countdown')).not.toBeNull();
    await advance(500); expect(guide().textContent).toContain('기본 자세');
    await receive({ ...state, kneeKick: { ...state.kneeKick, state: 'ARMED' }, detectorTest: { ...state.detectorTest, expected: 'KNEE_RIGHT', remainingMs: 3000, waitingForArmed: false } });
    expect(guide().textContent).toContain('오른쪽 니킥'); expect(guide().querySelector('.countdown')!.textContent).toBe('3.0초');
    await receive({ ...state, kneeKick: { ...state.kneeKick, validNow: false }, lastCommandError: 'DETECTOR_NOT_ARMED' });
    expect(guide().textContent).toContain('타이머와 동작 안내는 계속');
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('새 테스트는 보정된 baseline으로 시작');
    expect(container.querySelector('[aria-labelledby="mobile-kick-title"]')!.textContent).not.toMatch(/ARMED 대기|인식까지 기다리|유지하고 기다리/);
  });

  it('shows compact kick events and guides a test without any Action prototypes', async () => {
    const state = initialSnapshot();
    await receive(state);
    expect(button('Guided Detector Test 시작').disabled).toBe(true);
    state.neutral = { ...state.neutral, frozen: true, collectionState: 'FROZEN' };
    state.kneeKick = { ...state.kneeKick, ready: true, validNow: true, usableLeftNow: true, usableRightNow: true, state: 'ARMED' };
    await receive({ ...state });
    expect(button('Guided Detector Test 시작').disabled).toBe(false);
    await act(async () => button('Guided Detector Test 시작').click());
    expect(socket.emit).toHaveBeenLastCalledWith('kick:test:start', expect.any(Object));
    state.kneeKick = { ...state.kneeKick, currentEvent: 'KNEE_LEFT', state: 'WAIT_RETURN', lastEvent: { id: 1, direction: 'KNEE_LEFT', timestamp: 123 }, counts: { KNEE_LEFT: 1, KNEE_RIGHT: 0 } };
    state.detectorTest = { waitingForArmed: false, status: 'ACTIVE', expected: 'KNEE_LEFT', remainingMs: 1800, eventCount: 1, summary: null };
    await receive({ ...state });
    const panel = () => container.querySelector('[aria-labelledby="mobile-kick-title"]')!;
    expect(panel().textContent).toContain('LEFT KICK');
    expect(panel().textContent).toContain('LEFT: 1 · RIGHT: 0');
    expect(panel().querySelector('.major-instruction')!.textContent).toBe('LEFT KICK');
    expect(panel().querySelector('.action-guide')!.textContent).toContain('왼쪽 니킥');
    await advance(500);
    expect(panel().querySelector('.countdown')!.textContent).toBe('1.8초');
    await act(async () => button('Detector Test 초기화').click());
    expect(socket.emit).toHaveBeenLastCalledWith('kick:test:reset', expect.any(Object));
    await advance(1000);
    expect(container.textContent).toContain('연결 대기');
    expect(container.textContent).not.toContain('LEFT KICK');
  });

  it('adds no estimator requirement to ordinary Guided tests when capture is idle or stopped', async () => {
    await receive(kickReadySnapshot());
    expect(container.querySelector('[aria-label="분석용 Neutral"]')).toBeNull();
    expect(button('Guided Detector Test 시작').disabled).toBe(false);
    await act(async () => button('Guided Detector Test 시작').click());
    expect(socket.emit).toHaveBeenLastCalledWith('kick:test:start', expect.any(Object));
    // A stopped capture may retain old rolling counts; NOT_REQUIRED must still remove the gate.
    await receive(kickReadySnapshot(captureReadinessFixture({ analysisReadyFrameCount: 2, missingJoints: ['LEFT_ANKLE'] })));
    expect(container.querySelector('[aria-label="분석용 Neutral"]')).toBeNull();
    expect(button('Guided Detector Test 시작').disabled).toBe(false);
  });

  it('asks for continued Neutral at 41/60 with good current pose, without camera movement advice', async () => {
    await receive(kickReadySnapshot(captureReadinessFixture({ captureRecording: true, estimatorNeutralStatus: 'COLLECTING',
      analysisReadyFrameCount: 41, allJointsReadyNow: true, guidedStartAllowed: false })));
    const panel = container.querySelector('[aria-label="분석용 Neutral"]')!;
    expect(panel.querySelector('.major-instruction')!.textContent).toBe('기본 자세를 계속 유지하세요');
    expect(panel.textContent).toContain('분석용 Neutral 수집 중');
    expect(panel.textContent).toContain('41 / 60');
    expect(panel.textContent).toContain('현재 자세는 잘 인식되고 있습니다. 조금만 더 유지하세요.');
    expect(panel.textContent).not.toContain('카메라');
    expect(button('Guided Detector Test 시작').disabled).toBe(true);
    expect(container.querySelector('#kick-start-reason')!.textContent).toBe('분석용 Neutral READY까지 기본 자세를 유지하세요.');
    socket.emit.mockClear(); await act(async () => button('Guided Detector Test 시작').click());
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('keeps production HIP/FINISHING guidance before FROZEN and shows NOT_STARTED for capture', async () => {
    const state = initialSnapshot();
    state.captureReadiness = captureReadinessFixture({ captureRecording: true, estimatorNeutralStatus: 'NOT_STARTED', guidedStartAllowed: false });
    await receive(state);
    expect(container.textContent).toContain('분석용 Neutral 수집 전');
    state.neutral = { ...state.neutral, collectionState: 'HIP', status: 'CALIBRATING' };
    state.captureReadiness.estimatorNeutralStatus = 'COLLECTING';
    await receive({ ...state });
    expect(container.querySelector('[aria-labelledby="neutral-title"]')!.textContent).toContain('기본 플랭크 자세를 유지하세요');
    expect(container.querySelector('[aria-label="분석용 Neutral"] .major-instruction')).toBeNull();
    state.neutral = { ...state.neutral, collectionState: 'FINISHING', kneeGraceRemainingMs: 600 };
    await receive({ ...state });
    expect(container.querySelector('[aria-labelledby="neutral-title"]')!.textContent).toContain('기본 자세를 조금만 더 유지하세요');
  });

  it('shows current missing joints in Korean and all eight exact counts in details', async () => {
    const capture = captureReadinessFixture({ captureRecording: true, estimatorNeutralStatus: 'COLLECTING',
      analysisReadyFrameCount: 42, missingJoints: ['RIGHT_KNEE', 'LEFT_ANKLE'], guidedStartAllowed: false,
      perJointUsableFrames: { LEFT_SHOULDER: 81, RIGHT_SHOULDER: 81, LEFT_HIP: 79, RIGHT_HIP: 80, LEFT_KNEE: 77, RIGHT_KNEE: 78, LEFT_ANKLE: 42, RIGHT_ANKLE: 76 } });
    await receive(kickReadySnapshot(capture));
    const panel = container.querySelector('[aria-label="분석용 Neutral"]')!;
    expect([...panel.querySelectorAll('[role="status"] li')].map((item) => item.textContent)).toEqual(['오른쪽 무릎', '왼쪽 발목']);
    expect(panel.textContent).not.toContain('현재 자세는 잘 인식되고 있습니다');
    expect([...panel.querySelectorAll('details li')].map((item) => item.textContent)).toEqual([
      'LEFT SHOULDER: 81 / 60', 'RIGHT SHOULDER: 81 / 60', 'LEFT HIP: 79 / 60', 'RIGHT HIP: 80 / 60',
      'LEFT KNEE: 77 / 60', 'RIGHT KNEE: 78 / 60', 'LEFT ANKLE: 42 / 60', 'RIGHT ANKLE: 76 / 60',
    ]);
  });

  it('enables READY even after current joint loss and zero rolling frames', async () => {
    await receive(kickReadySnapshot(captureReadinessFixture({ captureRecording: true, estimatorNeutralStatus: 'READY',
      analysisReadyFrameCount: 0, missingJoints: ['LEFT_ANKLE'], allJointsReadyNow: false })));
    const panel = container.querySelector('[aria-label="분석용 Neutral"]')!;
    expect(panel.textContent).toContain('분석용 Neutral READY ✓');
    expect(panel.textContent).toContain('Guided Detector Test를 시작할 수 있습니다.');
    expect(panel.textContent).not.toContain('계속 유지');
    expect(panel.querySelector('[role="status"]')!.textContent).not.toContain('현재 확인 필요');
    expect(panel.querySelector('details')!.textContent).toContain('왼쪽 발목');
    expect(button('Guided Detector Test 시작').disabled).toBe(false);
  });

  it.each(['READY', 'COLLECTING'] as const)('keeps camera, Neutral and detector prerequisites ahead of estimator %s', async (estimatorNeutralStatus) => {
    const state = kickReadySnapshot(captureReadinessFixture({ captureRecording: true, estimatorNeutralStatus, guidedStartAllowed: estimatorNeutralStatus === 'READY' }));
    state.controller.cameraRunning = false;
    await receive(state);
    expect(container.querySelector('#kick-start-reason')!.textContent).toContain('카메라를 시작');
    state.controller.cameraRunning = true; state.neutral.frozen = false;
    await receive({ ...state });
    expect(container.querySelector('#kick-start-reason')!.textContent).toContain('기본 자세 보정을 먼저 완료');
    state.neutral.frozen = true; state.kneeKick.ready = false;
    await receive({ ...state });
    expect(container.querySelector('#kick-start-reason')!.textContent).toContain('Detector READY를 확인');
    expect(button('Guided Detector Test 시작').disabled).toBe(true);
    expect(container.querySelector('[aria-label="분석용 Neutral"]')!.textContent).not.toContain('Test를 시작할 수 있습니다');
  });

  it('does not enable a new Guided test after the READY reference has already been consumed', async () => {
    await receive(kickReadySnapshot(captureReadinessFixture({ captureRecording: true, estimatorNeutralStatus: 'READY', guidedStartAllowed: false })));
    expect(button('Guided Detector Test 시작').disabled).toBe(true);
    expect(container.querySelector('#kick-start-reason')!.textContent).toContain('이미 테스트에 사용');
    expect(container.querySelector('[aria-label="분석용 Neutral"]')!.textContent).toContain('분석용 Neutral READY ✓');
    expect(container.textContent).not.toContain('Test를 시작할 수 있습니다');
  });

  it('translates the estimator-specific command error', async () => {
    await receive({ ...kickReadySnapshot(captureReadinessFixture({ captureRecording: true, estimatorNeutralStatus: 'COLLECTING', guidedStartAllowed: false })),
      lastCommandError: 'ESTIMATOR_NEUTRAL_NOT_READY' });
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('분석용 Neutral READY까지 기본 자세를 유지하세요.');
  });

  it.each(['ready', 'stopped', 'active'] as const)('removes outdated estimator rejection guidance when %s', async (next) => {
    const state = kickReadySnapshot(captureReadinessFixture({ captureRecording: true, estimatorNeutralStatus: 'COLLECTING', guidedStartAllowed: false }));
    state.lastCommandError = 'ESTIMATOR_NEUTRAL_NOT_READY';
    await receive(state);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    if (next === 'ready') state.captureReadiness = { ...state.captureReadiness, estimatorNeutralStatus: 'READY', guidedStartAllowed: true };
    if (next === 'stopped') state.captureReadiness = { ...state.captureReadiness, captureRecording: false, estimatorNeutralStatus: 'NOT_REQUIRED', guidedStartAllowed: true };
    if (next === 'active') state.detectorTest = { ...state.detectorTest, status: 'ACTIVE', expected: 'TWIST_LEFT', remainingMs: 3000 };
    await receive({ ...state });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain('분석용 Neutral READY까지 기본 자세를 유지하세요.');
  });

  it.each(['READY', 'COLLECTING', 'NOT_STARTED'] as const)('never asks for Neutral during ACTIVE Guided even with estimator %s and missing joints', async (estimatorNeutralStatus) => {
    const state = kickReadySnapshot(captureReadinessFixture({ captureRecording: true, estimatorNeutralStatus,
      missingJoints: ['LEFT_ANKLE'], allJointsReadyNow: false, guidedStartAllowed: false }));
    state.detectorTest = { ...state.detectorTest, status: 'ACTIVE', expected: 'KNEE_RIGHT', remainingMs: 1800 };
    state.kneeKick.validNow = false;
    await receive(state);
    const estimator = container.querySelector('[aria-label="분석용 Neutral"]')!;
    expect(estimator.querySelector('[role="status"]')!.textContent).not.toMatch(/유지하세요|보정을 시작|현재 확인 필요/);
    expect(estimator.textContent).toContain('타이머와 동작 안내는 계속');
    expect(container.querySelector('#kick-start-reason')!.textContent).toBe('Guided Detector Test가 진행 중입니다.');
    const guide = container.querySelector('[aria-labelledby="mobile-kick-title"] .action-guide')!;
    expect(guide.textContent).toContain('오른쪽 니킥');
    expect(guide.querySelector('.countdown')!.textContent).toBe('1.8초');
    await advance(500);
    expect(guide.querySelector('.countdown')!.textContent).toBe('1.8초'); // No phone-side timeline.
  });

});
