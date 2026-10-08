import { decodeWebMFrames, replayAborted } from '../replay/decodedVideoSource';
import { copyPoseFrame } from '../replay/replayTypes';
import { acceptTimestamp, frameSequence, verifyFrameSequence, type FramePlan, type EstimatorPoseFrame } from '../estimator/estimatorInference';
import { createEstimator, estimatorConfig } from '../estimator/estimatorConfig';

/** Unverified input is allowed only to produce forensic evidence, never a replay or 4O override. */
export async function inferForensicMedia(file: File, mediaId: string, plan: FramePlan, signal: AbortSignal,
  progress: (count: number) => void = () => {}) {
  const check = () => { if (signal.aborted) throw replayAborted(); };
  check();
  const canvas = document.createElement('canvas'), model = await createEstimator('FULL_VIDEO_CONTROL');
  try {
    check();
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Cannot create forensic frame canvas.');
    const frames: EstimatorPoseFrame[] = [], timestamps: number[] = [];
    for await (const frame of decodeWebMFrames(file, signal)) {
      try {
        check();
        const timestamp = frame.timestamp * 1000;
        acceptTimestamp(timestamps, timestamp);
        if (timestamp !== plan.timestamps[frames.length]) throw new Error('Forensic decoded PTS differs from packet inventory.');
        canvas.width = frame.displayWidth; canvas.height = frame.displayHeight;
        frame.draw(context, 0, 0); // Raw image; no preview/mirror transform.
        const before = performance.now();
        const result = model.detectForVideo(canvas, timestamp);
        try {
          const inferenceMs = performance.now() - before; check();
          const landmarks = result.landmarks[0] ?? [], worldLandmarks = result.worldLandmarks[0] ?? [];
          frames.push({ ...copyPoseFrame({ timestamp, videoTime: frame.timestamp, landmarks, worldLandmarks }, 0, frames.length + 1),
            posePresent: landmarks.length > 0, inferenceMs });
        } finally { result.close(); }
      } finally { frame.close(); }
      if (frames.length % 60 === 0) progress(frames.length);
      await new Promise<void>((resolve) => setTimeout(resolve, 0)); check();
    }
    verifyFrameSequence(plan, timestamps); check();
    const sequence = await frameSequence(timestamps); check();
    return { mediaId, inputStatus: 'UNVERIFIED_FORENSIC_INPUT' as const, config: estimatorConfig('FULL_VIDEO_CONTROL'),
      sequence, frames, frameSequenceParity: true as const, clock: 'decoded media PTS * 1000; offset 0; no fitted time shift' };
  } finally { model.close(); canvas.width = 0; canvas.height = 0; }
}
