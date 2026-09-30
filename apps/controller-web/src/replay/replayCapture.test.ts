// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplayCapture, captureMime, CAPTURE_BITS_PER_SECOND } from './replayCapture';
import { captureCamera, fullTrial, liveHarness, MockMediaRecorder, mockRecorder, ORIGIN, TRIAL_AT } from './testFixtures';
import type { ReplaySession } from './replayTypes';
import { motionFrame, motionContext } from '../pose/motion/testFixtures';
import { KneeKickAnalysis } from '../pose/kick/kneeKickAnalysis';

beforeEach(() => { MockMediaRecorder.instances = []; MockMediaRecorder.supported = ['video/webm;codecs=vp8', 'video/webm']; });
afterEach(() => vi.restoreAllMocks());
describe('raw webcam capture passive observer', () => {
  it('rejects missing/stopped camera and unsupported WebM without acquiring a camera', () => {
    const capture = new ReplayCapture();
    expect(capture.start(null, true, 0, mockRecorder)).toBe(false);
    expect(capture.getView(0).error).toContain('RUNNING');
    const context = captureCamera(); Object.defineProperty(context.stream.getVideoTracks()[0], 'readyState', { value: 'ended' });
    expect(capture.start(context, true, 0, mockRecorder)).toBe(false);
    MockMediaRecorder.supported = [];
    expect(capture.start(captureCamera(), true, 0, mockRecorder)).toBe(false);
    expect(MockMediaRecorder.instances).toHaveLength(0);
  });
  it('passes the exact same MediaStream, probes MIME priority and uses actual encoder metadata', async () => {
    expect(captureMime(mockRecorder)).toBe('video/webm;codecs=vp8');
    MockMediaRecorder.supported = ['video/webm'];
    expect(captureMime(mockRecorder)).toBe('video/webm');
    const capture = new ReplayCapture(), context = captureCamera();
    const stopTrack = vi.spyOn(context.stream.getVideoTracks()[0], 'stop');
    expect(capture.start(context, true, 30, mockRecorder)).toBe(true);
    const recorder = MockMediaRecorder.instances[0];
    expect(recorder.stream).toBe(context.stream); expect(recorder.videoBitsPerSecond).toBe(CAPTURE_BITS_PER_SECOND);
    expect(capture.start(context, false, 40, mockRecorder)).toBe(false);
    expect(MockMediaRecorder.instances).toHaveLength(1);
    await capture.stop(90); await capture.stop(100);
    expect(recorder.stops).toBe(1); expect(stopTrack).not.toHaveBeenCalled();
    expect(JSON.parse(capture.getFiles().json).video).toMatchObject({ mimeType: 'video/webm', videoBitsPerSecond: 4000000, nominalFrameRate: 30 });
  });
  it('collects chunks only, finalizes bytes and matching local filenames, removes listeners and can restart', async () => {
    const capture = new ReplayCapture(); capture.start(captureCamera(), false, 0, mockRecorder);
    const recorder = MockMediaRecorder.instances[0], remove = vi.spyOn(recorder, 'removeEventListener');
    recorder.chunk(new Blob(['a'])); recorder.chunk(new Blob(['b']));
    expect(() => capture.getFiles()).toThrow('Stop');
    expect(capture.getView(100)).toMatchObject({ status: 'RECORDING', size: 2, durationMs: 100 });
    await capture.stop(100);
    const saved = capture.getFiles();
    expect(await saved.video.text()).toBe('abraw-webcam');
    expect(saved.filename.replace('.webm', '.json')).toBe(saved.jsonFilename);
    expect(remove.mock.calls.map(([name]) => name).sort()).toEqual(['dataavailable', 'error', 'stop']);
    expect(capture.getView(200)).toMatchObject({ status: 'RECORDED', durationMs: 100, downloadable: true });
    expect(capture.start(captureCamera(), true, 200, mockRecorder)).toBe(true);
    expect(capture.getView(210)).toMatchObject({ poseFrameCount: 0, size: 0 }); await capture.stop(220);
  });
  it('waits for the final chunk when the browser has already made the recorder inactive', async () => {
    const capture = new ReplayCapture(); capture.start(captureCamera(), false, 0, mockRecorder);
    const recorder = MockMediaRecorder.instances[0]; recorder.state = 'inactive';
    const stopped = capture.stop(100);
    expect(capture.getView(101).downloadable).toBe(false);
    recorder.chunk(new Blob(['final chunk'])); recorder.dispatchEvent(new Event('stop'));
    await stopped;
    expect(await capture.getFiles().video.text()).toBe('final chunk');
    expect(capture.getView(200).durationMs).toBe(100);
    expect(recorder.stops).toBe(0);
  });
  it('freezes duration and emits CAPTURE_STOP if the stream ends without an explicit stop', () => {
    const capture = new ReplayCapture(); capture.start(captureCamera(), false, 0, mockRecorder);
    vi.spyOn(performance, 'now').mockReturnValue(150);
    MockMediaRecorder.instances[0].stop();
    const saved = JSON.parse(capture.getFiles().json);
    expect(saved.timing.durationMs).toBe(150);
    expect(saved.markers.at(-1)).toMatchObject({ type: 'CAPTURE_STOP', tMs: 150 });
    expect(capture.getView(200).durationMs).toBe(150);
  });
  it('records the MIME and bitrate actually reported by the encoder', async () => {
    class SelectedRecorder extends MockMediaRecorder {
      constructor(stream: MediaStream, options: MediaRecorderOptions) { super(stream, options); this.mimeType = 'video/webm'; this.videoBitsPerSecond = 3500000; }
    }
    const capture = new ReplayCapture();
    capture.start(captureCamera(), false, 0, SelectedRecorder as unknown as typeof MediaRecorder);
    await capture.stop(100);
    expect(JSON.parse(capture.getFiles().json).video).toMatchObject({ mimeType: 'video/webm', videoBitsPerSecond: 3500000 });
  });

  it('does no snapshot work when OFF and records deep primitive copies before result.close/mutation', async () => {
    const capture = new ReplayCapture(), analysis = new KneeKickAnalysis(), frame = motionFrame(1020);
    const read = vi.fn(() => analysis.getReplaySnapshot());
    const observation = { kind: 'FRAME' as const, frame, timestamp: 1020, neutral: motionContext().neutral };
    capture.observe(observation, read); expect(read).not.toHaveBeenCalled();
    capture.start(captureCamera(), true, 1000, mockRecorder);
    capture.observe(observation, read);
    frame.landmarks[0].x = 999; frame.worldLandmarks[0].x = 888;
    // Equivalent to a MediaPipe close() invalidating its output objects.
    frame.landmarks.length = 0; frame.worldLandmarks.length = 0;
    await capture.stop(1030);
    const saved = JSON.parse(capture.getFiles().json) as ReplaySession;
    expect(saved.poseFrames[0].tMs).toBe(20);
    expect(saved.poseFrames[0].landmarks[0].x).toBe(0.5);
    expect(saved.poseFrames[0].worldLandmarks[0].x).toBe(1);
    expect(saved.poseFrames[0].landmarks).toHaveLength(33);
    expect(saved.poseFrames[0].worldLandmarks[0].visibility).toBeNull();
  });
  it('ignores duplicate/backward frame times and Mirror changes metadata only', async () => {
    const snapshots = [];
    for (const mirrored of [true, false]) {
      const capture = new ReplayCapture(), analysis = new KneeKickAnalysis();
      capture.start(captureCamera(), mirrored, 1000, mockRecorder);
      for (const timestamp of [1020, 1020, 1010, 1040]) {
        const frame = motionFrame(timestamp);
        capture.observe({ kind: 'FRAME', timestamp, frame, neutral: motionContext().neutral }, () => analysis.getReplaySnapshot());
      }
      await capture.stop(1060); snapshots.push(JSON.parse(capture.getFiles().json) as ReplaySession);
    }
    expect(snapshots[0].poseFrames.map((frame) => frame.tMs)).toEqual([20, 40]);
    expect(snapshots[0].poseFrames).toEqual(snapshots[1].poseFrames);
    expect(snapshots.map((session) => session.display.mirrorEnabled)).toEqual([true, false]);
  });
  it('records ordered, deduplicated calibration and guided stage lifecycle markers', async () => {
    const { session } = await fullTrial();
    const types = session.markers.map((marker) => marker.type);
    expect(types[0]).toBe('CAPTURE_START'); expect(types.at(-1)).toBe('CAPTURE_STOP');
    for (const type of ['NEUTRAL_CALIBRATION_START', 'NEUTRAL_FROZEN', 'GUIDED_TEST_START', 'GUIDED_TEST_COMPLETE']) {
      expect(types.filter((entry) => entry === type)).toHaveLength(1);
    }
    const stages = session.markers.filter((marker) => marker.type === 'GUIDED_STAGE_CHANGE');
    expect(stages.map((marker) => marker.stageIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(stages.map((marker) => marker.tMs)).toEqual([0, 2000, 5000, 7000, 10000, 12000, 15000, 17000, 20000].map((offset) => TRIAL_AT + offset));
    expect(session.poseFrames.every((frame, index) => index === 0 || frame.tMs > session.poseFrames[index - 1].tMs)).toBe(true);
    expect(session.markers.every((marker, index) => index === 0 || marker.tMs >= session.markers[index - 1].tMs)).toBe(true);
    expect(session.liveResult.events.map((event) => event.direction)).toEqual(['KNEE_LEFT', 'KNEE_RIGHT']);
  });
  it('freezes a trial on camera/reset interruption and ignores subsequent observations after stop', async () => {
    const live = liveHarness(); live.send(20);
    live.capture.observe({ kind: 'RESET', timestamp: ORIGIN + TRIAL_AT + 100, reason: 'CAMERA_STOP' }, () => live.kick.getReplaySnapshot());
    const session = await live.finish(110);
    live.send(200);
    expect(JSON.parse(live.capture.getFiles().json)).toEqual(session);
    expect(session.liveResult.trials[0].endMs).toBe(TRIAL_AT + 100);
  });
});
