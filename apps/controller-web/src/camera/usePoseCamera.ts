import { useCallback, useEffect, useRef, useState } from 'react';
import { DrawingUtils, PoseLandmarker, type Landmark, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { createPoseLandmarker, type PoseDelegate } from '../pose/createPoseLandmarker';
import { INFERENCE_SAMPLE_COUNT, KEY_LANDMARKS, METRICS_INTERVAL_MS, SIGNAL_LANDMARKS } from '../pose/poseConstants';

type CameraStatus = 'STOPPED' | 'STARTING' | 'RUNNING';
interface SignalLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
  worldX: number | null;
  worldY: number | null;
  worldZ: number | null;
}

interface PoseMetrics {
  cameraFps: number;
  renderFps: number;
  inferenceFps: number;
  averageInferenceMs: number | null;
  detected: boolean;
  visibility: (number | null)[];
  signalLandmarks: (SignalLandmark | null)[];
  width: number;
  height: number;
}

const emptyMetrics = (): PoseMetrics => ({
  cameraFps: 0,
  renderFps: 0,
  inferenceFps: 0,
  averageInferenceMs: null,
  detected: false,
  visibility: KEY_LANDMARKS.map(() => null),
  signalLandmarks: SIGNAL_LANDMARKS.map(() => null),
  width: 0,
  height: 0,
});

const emptyCounters = () => ({
  windowStarted: 0,
  renderFrames: 0,
  cameraFrames: 0,
  inferences: 0,
  inferenceTimes: [] as number[],
  landmarks: [] as NormalizedLandmark[],
  worldLandmarks: [] as Landmark[],
});

function cameraError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
        return '카메라 권한이 거부되었습니다. 브라우저의 카메라 권한을 허용한 뒤 다시 시작하세요.';
      case 'NotFoundError':
        return '사용 가능한 카메라가 없습니다. 웹캠 연결을 확인하세요.';
      case 'NotReadableError':
        return '카메라를 읽을 수 없습니다. 다른 앱의 카메라 사용 여부를 확인하세요.';
      case 'OverconstrainedError':
        return '카메라가 요청한 영상 설정을 지원하지 않습니다.';
    }
  }
  return '카메라 영상을 시작하지 못했습니다. 카메라 연결과 브라우저 권한을 확인하세요.';
}

export function usePoseCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const drawingRef = useRef<DrawingUtils | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const countersRef = useRef(emptyCounters());
  const generationRef = useRef(0);
  const activeRef = useRef(false);
  const [status, setStatus] = useState<CameraStatus>('STOPPED');
  const [error, setError] = useState<string | null>(null);
  const [delegate, setDelegate] = useState<PoseDelegate | null>(null);
  const [metrics, setMetrics] = useState(emptyMetrics);

  // Also used by unmount: release resources without scheduling React updates.
  const release = useCallback(() => {
    generationRef.current += 1;
    activeRef.current = false;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    streamRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    drawingRef.current?.close();
    drawingRef.current = null;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    lastVideoTimeRef.current = -1;
    countersRef.current = emptyCounters();
  }, []);

  const stop = useCallback(() => {
    release();
    setStatus('STOPPED');
    setError(null);
    setDelegate(null);
    setMetrics(emptyMetrics());
  }, [release]);

  useEffect(() => release, [release]);

  async function start() {
    // Guard rapid clicks even before React has disabled the button.
    if (activeRef.current) return;
    activeRef.current = true;
    const generation = ++generationRef.current;
    const isCurrent = () => generation === generationRef.current;
    const fail = (message: string) => {
      if (!isCurrent()) return;
      release();
      setStatus('STOPPED');
      setDelegate(null);
      setMetrics(emptyMetrics());
      setError(message);
    };
    setStatus('STARTING');
    setDelegate(null);
    setError(null);
    setMetrics(emptyMetrics());

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      fail('카메라는 localhost 또는 HTTPS에서 사용할 수 있습니다. 노트북의 http://localhost:5173에서 열어주세요.');
      return;
    }

    let initializingModel = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      // getUserMedia cannot be aborted; stop any stream returned after Stop/unmount.
      if (!isCurrent()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => fail('카메라 연결이 종료되었습니다. 연결을 확인한 뒤 다시 시작하세요.');
      });
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) throw new Error('Camera view unavailable');
      video.srcObject = stream;
      await video.play();
      if (!isCurrent()) return;

      initializingModel = true;
      const { landmarker, delegate: readyDelegate } = await createPoseLandmarker();
      // Model loading may also finish after Stop or after a newer start request.
      if (!isCurrent()) {
        landmarker.close();
        return;
      }
      landmarkerRef.current = landmarker;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D unavailable');
      const drawing = new DrawingUtils(context);
      drawingRef.current = drawing;
      countersRef.current.windowStarted = performance.now();
      setDelegate(readyDelegate);
      setStatus('RUNNING');

      const frame = () => {
        if (!isCurrent()) return;
        const counters = countersRef.current;
        counters.renderFrames += 1;
        try {
          if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0 &&
              video.currentTime !== lastVideoTimeRef.current) {
            lastVideoTimeRef.current = video.currentTime;
            counters.cameraFrames += 1;
            if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
            }
            const started = performance.now();
            const result = landmarker.detectForVideo(video, started);
            const inferenceMs = performance.now() - started;
            try {
              counters.inferences += 1;
              counters.inferenceTimes.push(inferenceMs);
              if (counters.inferenceTimes.length > INFERENCE_SAMPLE_COUNT) {
                counters.inferenceTimes.shift();
              }
              counters.landmarks = result.landmarks[0] ?? [];
              counters.worldLandmarks = result.worldLandmarks[0] ?? [];
              context.clearRect(0, 0, canvas.width, canvas.height);
              drawing.drawConnectors(counters.landmarks, PoseLandmarker.POSE_CONNECTIONS, {
                color: '#5eead4', lineWidth: 3,
              });
              drawing.drawLandmarks(counters.landmarks, {
                color: '#ffffff', fillColor: '#f97316', radius: 4, lineWidth: 1,
              });
            } finally {
              result.close();
            }
          }

          const now = performance.now();
          const elapsed = now - counters.windowStarted;
          if (elapsed >= METRICS_INTERVAL_MS) {
            const seconds = elapsed / 1000;
            const times = counters.inferenceTimes;
            setMetrics({
              cameraFps: counters.cameraFrames / seconds,
              renderFps: counters.renderFrames / seconds,
              inferenceFps: counters.inferences / seconds,
              averageInferenceMs: times.length
                ? times.reduce((sum, time) => sum + time, 0) / times.length : null,
              detected: counters.landmarks.length > 0,
              visibility: KEY_LANDMARKS.map(({ index }) => counters.landmarks[index]?.visibility ?? null),
              // Snapshot raw coordinates only at the UI interval; preview mirroring is CSS-only.
              signalLandmarks: SIGNAL_LANDMARKS.map(({ index }) => {
                const landmark = counters.landmarks[index];
                if (!landmark) return null;
                const world = counters.worldLandmarks[index];
                return {
                  x: landmark.x,
                  y: landmark.y,
                  z: landmark.z,
                  visibility: landmark.visibility,
                  worldX: world?.x ?? null,
                  worldY: world?.y ?? null,
                  worldZ: world?.z ?? null,
                };
              }),
              width: video.videoWidth,
              height: video.videoHeight,
            });
            counters.windowStarted = now;
            counters.renderFrames = 0;
            counters.cameraFrames = 0;
            counters.inferences = 0;
          }
          animationFrameRef.current = requestAnimationFrame(frame);
        } catch {
          fail('Pose 추론 또는 그리기에 실패했습니다. 카메라를 다시 시작해 주세요.');
        }
      };
      animationFrameRef.current = requestAnimationFrame(frame);
    } catch (cause) {
      if (initializingModel) {
        console.error('[Pose] initialization failed', cause);
        const message = cause instanceof Error ? cause.message : String(cause);
        fail(`Pose 모델을 초기화하지 못했습니다: ${message}`);
      } else {
        fail(cameraError(cause));
      }
    }
  }

  return { videoRef, canvasRef, status, error, delegate, metrics, start, stop };
}
