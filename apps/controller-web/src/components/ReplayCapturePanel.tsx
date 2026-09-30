import type { useReplayCapture } from '../replay/useReplayCapture';
export function ReplayCapturePanel({ capture, canStart, onStart }: {
  capture: ReturnType<typeof useReplayCapture>; canStart: boolean; onStart: () => void;
}) {
  const { view } = capture;
  return <section aria-label="STEP 4F Replay Capture">
    <h3>STEP 4F — Replay Capture</h3>
    <p>원본 웹캠 WebM + inference별 Pose JSON. 파일은 다운로드할 때만 로컬에 저장됩니다.</p>
    <p>Capture 시작 → Neutral 재보정 → Guided Detector Test 완료 → Capture 중지 순서로 실행하세요.</p>
    <button onClick={onStart} disabled={!canStart || view.status === 'RECORDING'}>Start Replay Capture</button>{' '}
    <button onClick={() => void capture.stop()} disabled={view.status !== 'RECORDING' || view.stopping}>Stop Replay Capture</button>
    <p>Capture: {view.status}{view.stopping ? ' (finalizing)' : ''} · Duration: {(view.durationMs / 1000).toFixed(1)}s · Video: {(view.size / 1024 / 1024).toFixed(2)} MB · Pose frames: {view.poseFrameCount} · MIME: {view.mimeType}</p>
    {view.error && <p role="alert">{view.error}</p>}
    <button disabled={!view.downloadable} onClick={() => capture.download('video')}>Download Replay WebM</button>{' '}
    <button disabled={!view.downloadable} onClick={() => capture.download('json')}>Download Replay JSON</button>
  </section>;
}
