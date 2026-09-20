import { useCallback, useEffect, useRef, useState } from 'react';
import { PoseDatasetRecorder } from './poseDatasetRecorder';
import type { PoseFrame, PoseLabel, RecorderView, RecordingCameraContext } from './poseRecorderTypes';

const VOICE_LABELS: Record<PoseLabel, string> = {
  NEUTRAL: '기본 플랭크', TWIST_LEFT: '왼쪽 트위스트', TWIST_RIGHT: '오른쪽 트위스트',
  KNEE_LEFT: '왼쪽 니킥', KNEE_RIGHT: '오른쪽 니킥',
};

function cancelVoice() {
  try { window.speechSynthesis?.cancel(); } catch { /* Voice is optional. */ }
}

function announce(view: RecorderView) {
  try {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    let text = '';
    if (view.status === 'COMPLETED') text = '기록 완료';
    if (view.stage?.phase === 'PREPARE') text = '준비하세요';
    if (view.stage?.phase === 'STABILIZE') text = '자세 안정화 중';
    if (view.stage?.phase === 'RECORDING' && view.stage.label) text = VOICE_LABELS[view.stage.label];
    if (view.stage?.phase === 'TRANSITION' && view.stage.nextLabel) {
      text = `기본 자세를 거쳐 ${VOICE_LABELS[view.stage.nextLabel]}`;
    }
    cancelVoice();
    if (!text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    window.speechSynthesis.speak(utterance);
  } catch (cause) {
    console.warn('[Pose recorder] voice guidance unavailable', cause);
  }
}

export function usePoseRecorder() {
  const recorderRef = useRef<PoseDatasetRecorder | null>(null);
  if (recorderRef.current === null) recorderRef.current = new PoseDatasetRecorder();
  const recorder = recorderRef.current;
  const [view, setView] = useState(() => recorder.getView(performance.now()));
  const [error, setError] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);

  // No state updates in this callback: invoked synchronously for every inference result.
  const recordFrame = useCallback((frame: PoseFrame) => recorder.recordFrame(frame), [recorder]);
  const interrupt = useCallback(() => {
    recorder.interrupt();
    cancelVoice();
  }, [recorder]);

  useEffect(() => interrupt, [interrupt]);

  useEffect(() => {
    if (view.status !== 'ACTIVE') return;
    // Countdown and sample summaries refresh at 10 Hz, independent of inference FPS.
    const timer = window.setInterval(() => setView(recorder.getView(performance.now())), 100);
    return () => window.clearInterval(timer);
  }, [recorder, view.status]);

  useEffect(() => {
    if (voiceEnabled) announce(recorder.getView(performance.now()));
    else cancelVoice();
  }, [recorder, view.status, view.stageIndex, voiceEnabled]);

  function start(context: RecordingCameraContext | null, previewMirrored: boolean) {
    if (!context) {
      setError('Camera RUNNING 상태에서 Pose가 감지된 후 시작하세요.');
      return;
    }
    const now = performance.now();
    if (!recorder.start({
      ...context, version: 1, createdAt: new Date().toISOString(),
      model: 'pose_landmarker_full', previewMirrored, timeOrigin: performance.timeOrigin,
    }, now)) return;
    setError(null);
    setView(recorder.getView(now));
  }

  function reset() {
    cancelVoice();
    recorder.reset();
    setError(null);
    setView(recorder.getView(performance.now()));
  }

  function download() {
    let url: string | null = null;
    const link = document.createElement('a');
    try {
      const json = recorder.exportJson();
      url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      link.href = url;
      link.download = `plank-stork-pose-${view.createdAt!.replace(/[:.]/g, '-')}.json`;
      document.body.append(link);
      link.click();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      link.remove();
      if (url) {
        const objectUrl = url;
        // Give the browser time to start reading the download before releasing its URL.
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    }
  }

  return { view, error, voiceEnabled, setVoiceEnabled, recordFrame, interrupt, start, reset, download };
}
