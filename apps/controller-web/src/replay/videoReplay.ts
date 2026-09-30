import { createPoseLandmarker, POSE_VIDEO_OPTIONS } from '../pose/createPoseLandmarker';
import { POSE_MODEL_URL } from '../pose/poseConstants';
import { copyPoseFrame, type ReplayPoseFrame, type ReplaySession } from './replayTypes';
import { decodeWebMFrames, replayAborted } from './decodedVideoSource';
import { VideoFrameAccounting } from './videoReplayMetrics';

/** Yield to Cancel/UI after each completed inference, without using this clock as a media timestamp. */
function yieldToBrowser(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(replayAborted()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 0);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

/** Pull one decoded frame, finish inference, then pull the next. No playing video or presentation callbacks. */
export async function inferReplayVideo(canvas: HTMLCanvasElement, file: File, session: ReplaySession, signal: AbortSignal,
  onProgress: (tMs: number, count: number) => void = () => {}) {
  if (session.pose.modelUrl !== POSE_MODEL_URL || Object.entries(POSE_VIDEO_OPTIONS).some(([key, value]) => session.pose.settings[key] !== value)) {
    throw new Error('이 Capture의 모델/설정이 현재 live 설정과 다릅니다. 동일한 코드 버전으로 재생하세요.');
  }
  if (signal.aborted) throw replayAborted();
  const { landmarker, delegate } = await createPoseLandmarker(session.pose.delegate);
  try {
    if (signal.aborted) throw replayAborted();
    if (delegate !== session.pose.delegate) throw new Error('녹화 당시 delegate를 초기화하지 못했습니다. 다른 delegate로 비교하지 않고 중단합니다.');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Replay frame을 그릴 canvas를 초기화하지 못했습니다.');
    const accounting = new VideoFrameAccounting(), frames: ReplayPoseFrame[] = [];
    let lastProgress = -Infinity;
    for await (const sample of decodeWebMFrames(file, signal)) {
      try {
        if (signal.aborted) throw replayAborted();
        const timestampMs = sample.timestamp * 1000; // Decoded presentation timestamp, not decode/inference completion time.
        if (accounting.accept(timestampMs)) {
          if (canvas.width !== sample.displayWidth) canvas.width = sample.displayWidth;
          if (canvas.height !== sample.displayHeight) canvas.height = sample.displayHeight;
          sample.draw(context, 0, 0); // Dedicated raw frame canvas: no mirror, overlay, UI, or live camera state.
          const result = await landmarker.detectForVideo(canvas, timestampMs);
          try {
            if (signal.aborted) throw replayAborted();
            frames.push(copyPoseFrame({ timestamp: timestampMs, videoTime: sample.timestamp, landmarks: result.landmarks[0] ?? [], worldLandmarks: result.worldLandmarks[0] ?? [] }, 0, frames.length + 1));
            accounting.recordProcessed(timestampMs);
          } finally { result.close(); }
          if (timestampMs - lastProgress >= 250) { lastProgress = timestampMs; onProgress(timestampMs, frames.length); }
        }
      } finally { sample.close(); }
      // Decoder prefetch is bounded and retained while inference/UI is slow; never discard queued source frames.
      await yieldToBrowser(signal);
    }
    if (signal.aborted) throw replayAborted();
    const nominal = session.video.nominalFrameRate;
    const expected = nominal && nominal > 0 ? Math.round(session.timing.durationMs * nominal / 1000) : null;
    return { frames, delegate, modelUrl: POSE_MODEL_URL, diagnostics: accounting.snapshot(expected) };
  } finally {
    landmarker.close(); canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }
}
