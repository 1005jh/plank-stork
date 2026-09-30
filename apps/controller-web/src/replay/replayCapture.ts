import { diagnosticConfig } from '../pose/kick/kneeKickDiagnostics';
import { extractKneeMotionFeatures } from '../pose/motion/kneeMotionFeatures';
import { usableKnees } from '../pose/kick/kneeKickDetector';
import { POSE_MODEL_URL } from '../pose/poseConstants';
import { POSE_VIDEO_OPTIONS } from '../pose/createPoseLandmarker';
import { copyPoseFrame, type CaptureCamera, type KickObservation, type KickSnapshot, type ReplayMarker, type ReplaySession, type ReplayTrial } from './replayTypes';

export const CAPTURE_BITS_PER_SECOND = 4_000_000; // Experimental 720p development capture.
export function captureMime(recorder: typeof MediaRecorder): string {
  const mime = ['video/webm;codecs=vp8', 'video/webm'].find((value) => recorder.isTypeSupported(value));
  if (!mime) throw new Error('이 브라우저는 WebM MediaRecorder를 지원하지 않습니다. Chrome에서 실행하세요.');
  return mime;
}

/** Passive observer. No camera acquisition, canvas capture, detector clock reads or per-frame React updates. */
export class ReplayCapture {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private session: ReplaySession | null = null;
  private blob: Blob | null = null;
  private stopping: Promise<void> | null = null;
  private resolveStop: (() => void) | null = null;
  private stopped = true;
  private stopAt: number | null = null;
  private order = 0;
  private trial: ReplayTrial | null = null;
  private seenMarkers = new Set<string>();
  private frozen = false;
  private lastEventKey = '';
  private error: string | null = null;

  start(camera: CaptureCamera | null, mirrored: boolean, now: number, Recorder = globalThis.MediaRecorder): boolean {
    if (this.recorder) return false;
    try {
      if (!camera || !camera.stream.getVideoTracks().some((track) => track.readyState === 'live')) throw new Error('Camera RUNNING 상태에서 시작하세요.');
      if (!Recorder) throw new Error('MediaRecorder를 지원하지 않는 브라우저입니다.');
      const recorder = new Recorder(camera.stream, { mimeType: captureMime(Recorder), videoBitsPerSecond: CAPTURE_BITS_PER_SECOND });
      const createdAt = new Date().toISOString();
      const captureId = `plank-stork-replay-${createdAt.replace(/[:.]/g, '-')}`;
      this.session = {
        version: 1, captureId, createdAt,
        video: { filename: `${captureId}.webm`, mimeType: recorder.mimeType, videoBitsPerSecond: recorder.videoBitsPerSecond,
          width: camera.width, height: camera.height, nominalFrameRate: camera.stream.getVideoTracks()[0].getSettings().frameRate ?? null,
          sourceVideoTimeAtStart: camera.videoTime },
        pose: { model: 'pose_landmarker_full', modelUrl: POSE_MODEL_URL, delegate: camera.delegate, settings: { ...POSE_VIDEO_OPTIONS } },
        display: { mirrorEnabled: mirrored }, timing: { durationMs: 0, captureStartPerformanceMs: now },
        poseFrames: [], markers: [], clockSamples: [],
        liveResult: { neutralBaseline: null, kickBaseline: null, detectorConfig: diagnosticConfig(), guidedSummary: null, events: [], trials: [] },
      };
      this.chunks = []; this.blob = null; this.error = null; this.order = 0; this.trial = null;
      this.seenMarkers.clear(); this.frozen = false; this.lastEventKey = ''; this.stopAt = null; this.stopped = false;
      this.stopping = null; this.recorder = recorder;
      recorder.addEventListener('dataavailable', this.onData);
      recorder.addEventListener('stop', this.onStop);
      recorder.addEventListener('error', this.onError);
      recorder.start(1000);
      this.marker('CAPTURE_START', now, 'capture-start');
      return true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.detach(); this.session = null; this.blob = null; this.chunks = []; this.stopped = true; return false;
    }
  }
  private onData = (event: BlobEvent) => { if (event.data.size) this.chunks.push(event.data); };
  private onError = () => { this.error = 'WebM 녹화 중 오류가 발생했습니다. 저장된 부분을 확인하세요.'; void this.stop(performance.now()); };
  private onStop = () => {
    if (this.session && this.recorder) {
      this.session.video.mimeType = this.recorder.mimeType;
      this.session.video.videoBitsPerSecond = this.recorder.videoBitsPerSecond;
    }
    // Track end may stop MediaRecorder independently; retain its final dataavailable event.
    if (this.stopAt === null && this.session) {
      this.stopAt = performance.now(); this.finishTrial(this.stopAt);
      this.marker('CAPTURE_STOP', this.stopAt, 'capture-stop');
      this.session.timing.durationMs = Math.max(0, this.stopAt - this.session.timing.captureStartPerformanceMs);
    }
    this.blob = new Blob(this.chunks, { type: this.session?.video.mimeType });
    this.chunks = []; this.stopped = true; this.detach(); this.resolveStop?.(); this.resolveStop = null;
  };
  private detach() {
    this.recorder?.removeEventListener('dataavailable', this.onData);
    this.recorder?.removeEventListener('stop', this.onStop);
    this.recorder?.removeEventListener('error', this.onError);
    this.recorder = null;
  }
  private marker(type: ReplayMarker['type'], timestamp: number, key: string, extra: Partial<ReplayMarker> = {}) {
    if (!this.session || this.seenMarkers.has(key)) return;
    const tMs = timestamp - this.session.timing.captureStartPerformanceMs;
    if (tMs < 0) return;
    this.seenMarkers.add(key); this.session.markers.push({ type, tMs, order: ++this.order, ...extra });
  }
  neutralStarted = (timestamp: number) => {
    if (!this.recorder || this.stopAt !== null) return;
    this.frozen = false;
    this.marker('NEUTRAL_CALIBRATION_START', timestamp, `neutral-${timestamp}`);
  };
  observe = (event: KickObservation, read: () => KickSnapshot) => {
    if (!this.recorder || this.stopAt !== null || !this.session) return;
    try {
      const session = this.session, origin = session.timing.captureStartPerformanceMs, tMs = event.timestamp - origin;
      if (tMs < 0) return;
      const snapshot = read(); // A read-only snapshot, never getView().
      const order = ++this.order;
      if (event.kind === 'START' && snapshot.detector.baseline) {
        this.finishTrial(event.timestamp);
        const id = session.liveResult.trials.length + 1;
        this.trial = { id, startMs: tMs, startOrder: order, endMs: null, endOrder: null, baseline: { ...snapshot.detector.baseline }, neutralBaseline: session.liveResult.neutralBaseline ? { ...session.liveResult.neutralBaseline } : null,
          result: { poseFrameCount: 0, poseUsableFrameCount: 0, events: [], finalState: snapshot.detector.state, guidedSummary: snapshot.guided.summary } };
        session.liveResult.trials.push(this.trial); this.lastEventKey = '';
        this.marker('GUIDED_TEST_START', event.timestamp, `start-${id}`, { trialId: id });
      }
      if (event.kind === 'FRAME') {
        const previous = session.poseFrames.at(-1);
        if (previous && tMs <= previous.tMs) return;
        session.poseFrames.push(copyPoseFrame(event.frame, origin, order));
        if (event.neutral.collectionState === 'FROZEN') {
          session.liveResult.neutralBaseline = event.neutral.baseline ? { ...event.neutral.baseline } : null;
          if (!this.frozen) { this.marker('NEUTRAL_FROZEN', event.timestamp, `frozen-${order}`); this.frozen = true; }
        }
        if (this.trial && this.trial.endMs === null) {
          this.trial.result.poseFrameCount++;
          const usable = usableKnees(extractKneeMotionFeatures(event.frame.landmarks));
          if (usable.left || usable.right) this.trial.result.poseUsableFrameCount++;
        }
      }
      session.liveResult.kickBaseline = snapshot.detector.baseline ? { ...snapshot.detector.baseline } : session.liveResult.kickBaseline;
      const trial = this.trial;
      if (event.kind === 'CLOCK' && trial && trial.endMs === null) session.clockSamples.push({ tMs, order, trialId: trial.id });
      const last = snapshot.detector.eventsLast;
      if (last && `${trial?.id}:${last.id}:${last.timestamp}` !== this.lastEventKey && event.kind !== 'START') {
        this.lastEventKey = `${trial?.id}:${last.id}:${last.timestamp}`;
        const recorded = { id: last.id, direction: last.direction, tMs: last.timestamp - origin };
        if (recorded.tMs >= 0) {
          session.liveResult.events.push({ ...recorded, trialId: trial?.id ?? null });
          if (trial && trial.endMs === null && recorded.tMs >= trial.startMs && recorded.tMs < trial.startMs + 22000) trial.result.events.push(recorded);
        }
      }
      if (trial && trial.endMs === null && event.kind !== 'RESET') {
        trial.result.finalState = snapshot.detector.state; trial.result.guidedSummary = snapshot.guided.summary;
        session.liveResult.guidedSummary = snapshot.guided.summary;
        for (const stage of snapshot.guided.timings) if (stage.startedAt !== null) {
          this.marker('GUIDED_STAGE_CHANGE', stage.startedAt, `stage-${trial.id}-${stage.stageIndex}`, { trialId: trial.id, stageIndex: stage.stageIndex, expected: stage.expected });
        }
        if (snapshot.guided.status === 'COMPLETED') {
          this.marker('GUIDED_TEST_COMPLETE', origin + trial.startMs + 22000, `complete-${trial.id}`, { trialId: trial.id });
          this.finishTrial(event.timestamp);
        }
      }
      if (event.kind === 'RESET') this.finishTrial(event.timestamp);
    } catch (error) {
      console.warn('[Replay capture] observation failed', error);
      this.error = error instanceof Error ? error.message : String(error);
      void this.stop(event.timestamp); // Capture errors never stop live inference.
    }
  };
  private finishTrial(timestamp: number) {
    if (!this.session || !this.trial || this.trial.endMs !== null) return;
    this.trial.endMs = timestamp - this.session.timing.captureStartPerformanceMs; this.trial.endOrder = this.order;
    this.marker('GUIDED_TEST_STOP', timestamp, `end-${this.trial.id}`, { trialId: this.trial.id });
  }
  stop(now: number): Promise<void> {
    if (!this.recorder) return Promise.resolve();
    if (this.stopping) return this.stopping;
    this.stopAt = now; this.finishTrial(now);
    this.marker('CAPTURE_STOP', now, 'capture-stop');
    if (this.session) this.session.timing.durationMs = Math.max(0, now - this.session.timing.captureStartPerformanceMs);
    this.stopping = new Promise((resolve) => { this.resolveStop = resolve; });
    // If already inactive, the browser still queues final dataavailable + stop; wait for them.
    try { if (this.recorder.state !== 'inactive') this.recorder.stop(); }
    catch (error) { console.warn('[Replay capture] stop failed', error); this.onStop(); }
    return this.stopping;
  }
  getView(now: number) {
    return { status: !this.session ? 'IDLE' : this.stopped ? 'RECORDED' : 'RECORDING', stopping: this.stopAt !== null && !this.stopped,
      durationMs: this.session ? (this.stopAt ?? now) - this.session.timing.captureStartPerformanceMs : 0,
      size: this.blob?.size ?? this.chunks.reduce((sum, chunk) => sum + chunk.size, 0), poseFrameCount: this.session?.poseFrames.length ?? 0,
      mimeType: this.session?.video.mimeType ?? '-', error: this.error, downloadable: this.stopped && this.blob !== null };
  }
  getFiles() {
    if (!this.session || !this.blob || !this.stopped) throw new Error('Stop Replay Capture 후 다운로드하세요.');
    const session = { ...this.session, markers: [...this.session.markers].sort((a, b) => a.tMs - b.tMs || a.order - b.order) };
    return { video: this.blob, filename: session.video.filename, jsonFilename: `${session.captureId}.json`, json: JSON.stringify(session, null, 2) };
  }
}
