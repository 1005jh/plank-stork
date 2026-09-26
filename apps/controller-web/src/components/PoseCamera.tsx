import { useKneeKick } from '../pose/kick/useKneeKick';
import { KneeKickDetectorPanel } from './KneeKickDetector';
import { useState } from 'react';
import { usePoseCamera } from '../camera/usePoseCamera';
import { DEFAULT_MIRROR_PREVIEW, KEY_LANDMARKS, SIGNAL_LANDMARKS } from '../pose/poseConstants';
import './PoseCamera.css';
import { usePoseRecorder } from '../recorder/usePoseRecorder';
import { PoseRecorder } from './PoseRecorder';
import { usePoseFeatures } from '../pose/features/usePoseFeatures';
import { PoseFeatures } from './PoseFeatures';
import { usePoseActions } from '../pose/actions/usePoseActions';
import { PoseActions } from './PoseActions';
import { useCalibrationRemote, type CalibrationSocket } from '../remote/useCalibrationRemote';
import { useActionValidation } from '../pose/validation/useActionValidation';
import { validationReady } from '../pose/validation/actionValidation';
import { PoseValidation } from './PoseValidation';
import { useKneeMotionValidation } from '../pose/motion/useKneeMotionValidation';
import { kneeMotionReady } from '../pose/motion/kneeMotionValidation';
import { KneeMotionValidationPanel } from './KneeMotionValidation';

const SIGNAL_FIELDS = ['x', 'y', 'z', 'visibility', 'worldX', 'worldY', 'worldZ'] as const;

export function PoseCamera({ socket }: { socket?: CalibrationSocket | null }) {
  const recorder = usePoseRecorder();
  const features = usePoseFeatures();
  const actions = usePoseActions(features.getCurrent);
  const validation = useActionValidation();
  const motion = useKneeMotionValidation();
  const kick = useKneeKick();
  const { videoRef, canvasRef, status, error, delegate, metrics, start, stop, getRecordingContext } = usePoseCamera({
    onFrame: (frame) => {
      recorder.recordFrame(frame);
      const currentFeatures = features.processFrame(frame.landmarks, frame.worldLandmarks, frame.timestamp);
      const currentActions = actions.processFrame(currentFeatures, frame.timestamp);
      validation.recordFrame(frame, currentFeatures, currentActions);
      motion.recordFrame(frame, currentFeatures);
      kick.processFrame(frame, currentFeatures);
    },
    onCameraStopped: () => {
      recorder.interrupt();
      features.reset();
      actions.reset();
      validation.reset();
      motion.reset();
      kick.reset();
      remote.publishStopped();
    },
  });
  const [mirrored, setMirrored] = useState(DEFAULT_MIRROR_PREVIEW);
  function calibrateNeutral() {
    if (status !== 'RUNNING' || getRecordingContext() === null) return;
    validation.reset();
    motion.reset();
    kick.reset();
    actions.resetCalibration();
    features.calibrate(true);
  }
  function startAction() {
    // Do not invalidate an existing dataset for a rejected/duplicate start.
    if (actions.start()) validation.reset();
  }
  function resetAction() { validation.reset(); actions.resetCalibration(); }
  function startValidation() {
    return validation.start({
      cameraRunning: status === 'RUNNING', delegate,
      videoWidth: videoRef.current?.videoWidth || metrics.width,
      videoHeight: videoRef.current?.videoHeight || metrics.height,
      previewMirrored: mirrored, features: features.getCurrent(), actions: actions.getCurrent(),
      timeOrigin: performance.timeOrigin, createdAt: new Date().toISOString(),
    });
  }
  function startMotion() {
    return motion.start({
      cameraRunning: status === 'RUNNING', poseDetected: getRecordingContext() !== null,
      neutral: features.getCurrent(), delegate,
      videoWidth: videoRef.current?.videoWidth || metrics.width, videoHeight: videoRef.current?.videoHeight || metrics.height,
      previewMirrored: mirrored, createdAt: new Date().toISOString(), timeOrigin: performance.timeOrigin,
    });
  }
  function startDetectorTest() {
    return status === 'RUNNING' && getRecordingContext() !== null && features.getCurrent().collectionState === 'FROZEN' && kick.startTest();
  }
  const remote = useCalibrationRemote(socket, {
    getCamera: () => ({ cameraRunning: status === 'RUNNING', poseDetected: status === 'RUNNING' && getRecordingContext() !== null }),
    getNeutral: features.getCurrent,
    getActions: actions.getCurrent,
    startNeutral: calibrateNeutral,
    startAction,
    resetAction,
    getValidation: validation.getCurrent,
    startValidation,
    resetValidation: validation.resetValidation,
    getMotion: motion.getCurrent,
    startMotion,
    resetMotion: motion.resetMotion,
    getKick: kick.getCurrent,
    startDetectorTest,
    resetDetectorTest: kick.resetTest,
  });

  return (
    <section className="pose-panel" aria-labelledby="pose-title">
      <h2 id="pose-title">Pose Landmark POC</h2>
      <p>Pose Landmarker Full · Delegate: {delegate ?? '-'} · Preview {mirrored ? 'mirrored' : 'unmirrored'}</p>
      <div className="camera-controls">
        <button type="button" onClick={() => void start()} disabled={status !== 'STOPPED'}>
          Start Camera
        </button>
        <button type="button" onClick={stop} disabled={status === 'STOPPED'}>
          Stop Camera
        </button>
        <button type="button" aria-pressed={mirrored} onClick={() => setMirrored((value) => !value)}>
          Mirror {mirrored ? 'ON' : 'OFF'}
        </button>
        <span role="status">Camera: {status}</span>
      </div>
      {status === 'STARTING' && <p>카메라 권한을 확인하고 모델을 불러오는 중입니다…</p>}
      {error && <p className="camera-error" role="alert">{error}</p>}
      <PoseRecorder
        recorder={recorder}
        canStart={status === 'RUNNING' && metrics.detected}
        onStart={() => recorder.start(getRecordingContext(), mirrored)}
      />
      <div className="pose-layout">
        <div>
          <div className={`pose-preview${mirrored ? ' is-mirrored' : ''}`}>
            <video ref={videoRef} muted playsInline aria-label="Webcam preview" />
            <canvas ref={canvasRef} aria-label="Pose landmark overlay" />
          </div>
          <p>Pose: <strong>{metrics.detected ? 'DETECTED' : 'NOT DETECTED'}</strong></p>
          <dl className="pose-metrics">
            <div>
              <dt>Camera / Render FPS</dt>
              <dd>{metrics.cameraFps.toFixed(1)} / {metrics.renderFps.toFixed(1)}</dd>
            </div>
            <div>
              <dt>Pose inference FPS</dt>
              <dd>{metrics.inferenceFps.toFixed(1)}</dd>
            </div>
            <div>
              <dt>Average inference time (ms)</dt>
              <dd>{metrics.averageInferenceMs?.toFixed(1) ?? '-'}</dd>
            </div>
          </dl>
          <p className="pose-note">
            UI: 500ms 주기 · 추론 시간: 최근 30회 평균 · 영상 크기:{' '}
            {metrics.width ? `${metrics.width} × ${metrics.height}` : '-'}
          </p>
        </div>
        <div>
          <h3>Key landmark visibility</h3>
          <table className="visibility-table">
            <thead><tr><th scope="col">Landmark</th><th scope="col">Visibility</th></tr></thead>
            <tbody>
              {KEY_LANDMARKS.map(({ index, name }, row) => (
                <tr key={index}>
                  <th scope="row">{index} {name}</th>
                  <td>{metrics.visibility[row]?.toFixed(2) ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <section aria-labelledby="pose-signal-title">
        <h3 id="pose-signal-title">Pose Signal Analysis — Hip / Knee</h3>
        <p className="pose-note">
          500ms마다 원본 좌표를 표시합니다. Mirror는 영상·overlay 표시만 바꾸며 좌표와 신체 기준 LEFT/RIGHT는 유지됩니다.
        </p>
        <div className="signal-table-scroll" role="region" aria-labelledby="pose-signal-title" tabIndex={0}>
          <table className="visibility-table signal-table" aria-label="Hip and knee landmark values">
            <thead>
              <tr>
                <th scope="col">Landmark</th>
                {SIGNAL_FIELDS.map((field) => <th scope="col" key={field}>{field}</th>)}
              </tr>
            </thead>
            <tbody>
              {SIGNAL_LANDMARKS.map(({ index, name }, row) => (
                <tr key={index}>
                  <th scope="row">{index} {name}</th>
                  {SIGNAL_FIELDS.map((field) => (
                    <td key={field}>{metrics.signalLandmarks[row]?.[field]?.toFixed(3) ?? '-'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <PoseFeatures
        features={features}
        canCalibrate={status === 'RUNNING' && metrics.detected}
        onCalibrate={calibrateNeutral}
      />
      <PoseActions actions={actions} onStart={startAction} onReset={resetAction} />
      <PoseValidation validation={validation} canStart={validationReady(status === 'RUNNING', features.view, actions.view)} onStart={startValidation} />
      <KneeKickDetectorPanel kick={kick} canStart={status === 'RUNNING' && kick.view.detector.ready && kick.view.detector.validNow} onStart={startDetectorTest} />
      <KneeMotionValidationPanel motion={motion} canStart={kneeMotionReady(status === 'RUNNING', metrics.detected, features.view)} onStart={startMotion} />
    </section>
  );
}
