import { PoseFeatureAnalysis } from '../pose/features/poseFeatureAnalysis';
import { KneeKickAnalysis, type KickDetectorMode } from '../pose/kick/kneeKickAnalysis';
import { motionFrame } from '../pose/motion/testFixtures';
import type { PoseFrame } from '../recorder/poseRecorderTypes';
import { ReplayCapture } from './replayCapture';
import type { CaptureCamera, ReplaySession } from './replayTypes';

export class MockMediaRecorder extends EventTarget {
  static instances: MockMediaRecorder[] = [];
  static supported = ['video/webm;codecs=vp8', 'video/webm'];
  static isTypeSupported(mime: string) { return this.supported.includes(mime); }
  state = 'inactive'; mimeType: string; videoBitsPerSecond: number;
  starts = 0; stops = 0;
  constructor(public stream: MediaStream, options: MediaRecorderOptions) {
    super(); this.mimeType = options.mimeType!; this.videoBitsPerSecond = options.videoBitsPerSecond!;
    MockMediaRecorder.instances.push(this);
  }
  start() { this.starts++; this.state = 'recording'; }
  chunk(blob = new Blob(['raw-webcam'])) { this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: blob })); }
  stop() { this.stops++; this.chunk(); this.state = 'inactive'; this.dispatchEvent(new Event('stop')); }
}
export const mockRecorder = MockMediaRecorder as unknown as typeof MediaRecorder;
export function captureCamera(): CaptureCamera {
  const track = { readyState: 'live', stop: () => {}, getSettings: () => ({ frameRate: 30 }) };
  return { stream: { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream,
    delegate: 'CPU', width: 1280, height: 720, videoTime: 3 };
}
export const ORIGIN = 100000.25;
export const TRIAL_AT = 1200;
export function liveHarness(captureEnabled = true, detectorMode: KickDetectorMode = 'LEGACY_X') {
  const capture = new ReplayCapture(), neutral = new PoseFeatureAnalysis(), kick = new KneeKickAnalysis(null, detectorMode);
  const context = captureCamera();
  if (captureEnabled) capture.start(context, true, ORIGIN, mockRecorder);
  neutral.startCalibration(ORIGIN + 100); capture.neutralStarted(ORIGIN + 100);
  function frame(frame: PoseFrame) {
    neutral.processFrame(frame.landmarks, frame.worldLandmarks, frame.timestamp);
    const features = neutral.getView(frame.timestamp);
    kick.processFrame(frame, features);
    capture.observe({ kind: 'FRAME', timestamp: frame.timestamp, frame, neutral: features }, () => kick.getReplaySnapshot());
  }
  for (let offset = 150; offset <= 1100; offset += 50) frame(motionFrame(ORIGIN + offset));
  const baseline = kick.getReplaySnapshot().detector.baseline!;
  if (!baseline) throw new Error('fixture baseline missing');
  kick.startTest(ORIGIN + TRIAL_AT);
  capture.observe({ kind: 'START', timestamp: ORIGIN + TRIAL_AT }, () => kick.getReplaySnapshot());
  function send(t: number, left = 0, right = 0, missing = false) {
    const f = motionFrame(ORIGIN + TRIAL_AT + t);
    f.landmarks[25].x += left * baseline.bodyScale; f.landmarks[26].x += right * baseline.bodyScale;
    if (missing) { f.landmarks = []; f.worldLandmarks = []; }
    frame(f); return f;
  }
  function clock(t: number) {
    kick.getView(ORIGIN + TRIAL_AT + t);
    capture.observe({ kind: 'CLOCK', timestamp: ORIGIN + TRIAL_AT + t }, () => kick.getReplaySnapshot());
  }
  async function finish(t = 22200): Promise<ReplaySession> {
    await capture.stop(ORIGIN + TRIAL_AT + t);
    return JSON.parse(capture.getFiles().json) as ReplaySession;
  }
  return { capture, neutral, kick, baseline, send, clock, finish, frame };
}
export async function fullTrial() {
  const live = liveHarness();
  for (let time = 20; time <= 22020; time += 40) {
    let left = 0, right = 0;
    if (time >= 12060 && time <= 12340) left = time === 12060 ? -0.32 : -0.64;
    if (time >= 17060 && time <= 17340) right = time === 17060 ? 0.32 : 0.64;
    // Low-amplitude Twist signal does not enter the kick candidate state.
    if (time >= 2020 && time < 5020) left = -0.1;
    if (time >= 7020 && time < 10020) right = 0.1;
    live.send(time, left, right);
    if (time % 160 === 20) live.clock(time + 8);
  }
  return { ...live, session: await live.finish() };
}

/** Live PRIMARY V3 fixture, including actual setup frames and a disagreeing X shadow. */
export async function fullV3Trial(captureEnabled = true) {
  const live = liveHarness(captureEnabled, 'Y_V3');
  for (let t = 20; t <= 22020; t += 40) {
    const f = motionFrame(ORIGIN + TRIAL_AT + t), scale = live.baseline.bodyScale;
    if (t >= 2020 && t <= 2300) f.landmarks[25].x -= (t === 2020 ? .32 : .64) * scale;
    if (t >= 12060 && t <= 12420) f.landmarks[25].y += .6 * scale;
    if (t >= 17060 && t <= 17420) f.landmarks[26].y += .5 * scale;
    if (t >= 6060 && t <= 6140) { f.landmarks = []; f.worldLandmarks = []; }
    live.frame(f);
    if (t % 160 === 20) live.clock(t + 8);
  }
  return { ...live, session: captureEnabled ? await live.finish() : null };
}
