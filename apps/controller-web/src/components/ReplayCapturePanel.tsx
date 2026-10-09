import type { useReplayCapture } from '../replay/useReplayCapture';
export function ReplayCapturePanel({ capture, canStart, onStart }: {
  capture: ReturnType<typeof useReplayCapture>; canStart: boolean; onStart: () => void;
}) {
  const { view } = capture;
  return <section aria-label="STEP 4F Replay Capture">
    <h3>STEP 4F — Replay Capture</h3>
    <p>원본 웹캠 WebM + inference별 Pose JSON. 파일은 다운로드할 때만 로컬에 저장됩니다.</p>
    <p>Capture 시작 → Neutral 재보정 → Guided Detector Test 완료 → Capture 중지 순서로 실행하세요.</p>
    <button onClick={onStart} disabled={!canStart || view.status === 'RECORDING' || view.finalizing}>Start Replay Capture</button>{' '}
    <button onClick={() => void capture.stop()} disabled={view.status !== 'RECORDING' || view.stopping}>Stop Replay Capture</button>
    <p>Capture: {view.status}{view.stopping ? ' (finalizing)' : ''} · Duration: {(view.durationMs / 1000).toFixed(1)}s · Video: {(view.size / 1024 / 1024).toFixed(2)} MB · Pose frames: {view.poseFrameCount} · MIME: {view.mimeType}</p>
    <p>Media artifact: {view.artifactState} {view.artifactState === 'ARTIFACT_FAILED' && '— NOT VALIDATION READY'}</p>
    <button disabled={!view.finalizing} onClick={capture.cancelFinalization}>Cancel Media Finalization</button>
    <p>Estimator Neutral reference: {view.readiness.status}</p>
    <p>Analysis-ready frames: {view.readiness.analysisReadyFrameCount} / 60 (rolling 3000ms)</p>
    <p>CURRENT FRAME: {view.readiness.allReadyNow ? 'READY' : `MISSING: ${view.readiness.current.filter((j) => !j.usable).map((j) => j.name).join(', ')}`}</p>
    <ul>{view.readiness.current.map((j) => <li key={j.name}>{j.name}: {view.readiness.perJointUsableFrames[j.name]} / 60 — {j.usable ? 'READY' : 'MISSING'}</li>)}</ul>
    {view.readiness.status === 'COLLECTING' && <p>Neutral calibration은 FROZEN 되었어도 estimator validation을 위해 자세를 유지하세요.</p>}
    {view.readiness.status === 'READY' && <p>{view.readiness.consumed ? 'Reference used. 새 trial에는 Neutral을 다시 보정하세요.' : 'Estimator neutral reference READY. Guided Test를 시작할 수 있습니다.'}</p>}
    {view.validation && <p>Capture quality: {view.validation.status} (실험 PASS 판정과 별개)</p>}
    {view.error && <p role="alert">{view.error}</p>}
    <button disabled={!view.downloadable} onClick={() => capture.download('video')}>Download Replay WebM</button>{' '}
    <button disabled={!view.downloadable} onClick={() => capture.download('json')}>Download Replay JSON</button>
  </section>;
}
