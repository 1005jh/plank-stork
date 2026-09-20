import { POSE_LABELS } from '../recorder/poseRecorderTypes';
import type { usePoseRecorder } from '../recorder/usePoseRecorder';

interface Props {
  recorder: ReturnType<typeof usePoseRecorder>;
  canStart: boolean;
  onStart: () => void;
}

export function PoseRecorder({ recorder, canStart, onStart }: Props) {
  const { view } = recorder;
  const finished = view.status === 'COMPLETED' || view.status === 'INTERRUPTED';
  const label = view.stage?.label ?? view.stage?.nextLabel;

  return (
    <section className="recorder-panel" aria-labelledby="recorder-title">
      <h3 id="recorder-title">Pose Dataset Recorder</h3>
      <div className="camera-controls">
        <button type="button" onClick={onStart} disabled={!canStart || view.status !== 'IDLE'}>
          Start Guided Recording
        </button>
        <button type="button" onClick={recorder.download} disabled={!finished}>Download JSON</button>
        <button type="button" onClick={recorder.reset} disabled={view.status === 'IDLE'}>Reset Dataset</button>
        <label>
          <input type="checkbox" checked={recorder.voiceEnabled} onChange={(event) => recorder.setVoiceEnabled(event.target.checked)} />
          {' '}Voice guide
        </label>
      </div>
      {view.status === 'IDLE' && (
        <p>카메라를 켜고 Pose가 감지되면 시작하세요. 준비 5초 · 안정화 1초 후 5가지 자세를 각 3초 기록합니다. 좌우는 본인의 신체 기준입니다.</p>
      )}
      {recorder.error && <p className="camera-error" role="alert">{recorder.error}</p>}
      <div className="recorder-stage" role="status" aria-live="polite">
        <strong>{view.stage?.phase ?? view.status}</strong>
        {label && <span className="recorder-label">{label.replaceAll('_', ' ')}</span>}
      </div>
      {view.status === 'ACTIVE' && (
        <>
          <p className="recorder-countdown">{(view.remainingMs / 1000).toFixed(1)}s remaining</p>
          {view.stage?.phase === 'PREPARE' && <p>기록 전 준비 시간입니다. 기본 플랭크 자세를 준비하세요.</p>}
          {view.stage?.phase === 'STABILIZE' && <p>자세 안정화 중 — Neutral plank를 유지하세요. 기록과 dropped 집계는 하지 않습니다.</p>}
          {view.stage?.phase === 'TRANSITION' && <p>기록하지 않습니다. 가능하면 Neutral을 거쳐 표시된 다음 자세로 이동하세요.</p>}
          <p>Samples: {view.totalSamples}{view.stage?.label && ` · ${view.stage.label}: ${view.sampleCounts[view.stage.label]}`}</p>
        </>
      )}
      {view.status === 'INTERRUPTED' && <p>카메라가 멈춰 기록을 중단했습니다. 수집된 데이터는 INTERRUPTED 상태로 내려받을 수 있습니다.</p>}
      {finished && <p>새 기록을 시작하려면 필요한 JSON을 내려받은 뒤 Reset Dataset을 누르세요.</p>}
      {finished && <table className="visibility-table recorder-counts" aria-label="Recorded samples per label">
        <thead><tr><th scope="col">Label</th><th scope="col">Samples</th></tr></thead>
        <tbody>
          {POSE_LABELS.map((name) => <tr key={name}><th scope="row">{name}</th><td>{view.sampleCounts[name]} samples / {view.droppedPoseFrameCounts[name]} dropped</td></tr>)}
        </tbody>
      </table>}
      <p>Dropped frames: {view.droppedPoseFrameCount}</p>
      <p className="pose-note">기록 구간에서 Pose가 없는 추론 프레임만 dropped로 셉니다. 영상은 저장하지 않으며 JSON은 로컬로만 다운로드합니다.</p>
    </section>
  );
}
