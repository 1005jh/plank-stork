import { CALIBRATION_FEATURES } from '../pose/features/poseFeatureTypes';
import { CALIBRATION_MIN_SAMPLES, HIP_CALIBRATION_VISIBILITY, KNEE_CALIBRATION_VISIBILITY } from '../pose/features/poseFeatureAnalysis';
import type { usePoseFeatures } from '../pose/features/usePoseFeatures';

interface Props {
  features: ReturnType<typeof usePoseFeatures>;
  canCalibrate: boolean;
  onCalibrate: () => void;
}

const format = (value: number | null | undefined) => value?.toFixed(3) ?? '-';
const GROUP_LABELS = [
  { key: 'hips', label: 'HIP' }, { key: 'leftKnee', label: 'LEFT KNEE' }, { key: 'rightKnee', label: 'RIGHT KNEE' },
] as const;

export function PoseFeatures({ features, canCalibrate, onCalibrate }: Props) {
  const { view } = features;
  return (
    <section className="features-panel" aria-labelledby="pose-features-title">
      <h3 id="pose-features-title">STEP 4A — Calibrated Pose Features</h3>
      <p className="pose-note">250ms마다 표시합니다. 좌우는 신체 기준이며 Mirror는 계산에 영향을 주지 않습니다. 동작 판정은 하지 않습니다.</p>
      <div className="features-layout">
        <div>
          <h4>Raw Features</h4>
          <table className="visibility-table feature-raw-table" aria-label="Raw pose features">
            <thead><tr><th scope="col">Feature</th><th scope="col">Value</th></tr></thead>
            <tbody>{Object.entries(view.raw).map(([name, value]) => (
              <tr key={name}><th scope="row">{name}</th><td>{format(value)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div>
          <h4>Neutral Calibration</h4>
          <p role="status">Status: <strong>{view.status}</strong></p>
          <table className="visibility-table" aria-label="Calibration readiness">
            <thead><tr><th scope="col">Group</th><th scope="col">Samples</th><th scope="col">Readiness</th></tr></thead>
            <tbody>{GROUP_LABELS.map(({ key, label }) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                <td>{view.readiness[key].sampleCount} / {CALIBRATION_MIN_SAMPLES}</td>
                <td>{view.readiness[key].ready ? 'READY' : 'PARTIAL'}</td>
              </tr>
            ))}</tbody>
          </table>
          <button type="button" onClick={onCalibrate} disabled={!canCalibrate || view.status === 'CALIBRATING'}>
            Calibrate Neutral
          </button>
          <p className="pose-note">기본 플랭크를 유지하고 누르세요. 최근 1초의 HIP X·Y·depth에 각각 유효 샘플 {CALIBRATION_MIN_SAMPLES}개가 모이면 CALIBRATED입니다.</p>
          <p className="pose-note">Knee는 독립 수집합니다. PARTIAL인 knee 기준값을 완성하려면 Neutral을 계속 유지하세요. 준비된 기준값은 고정됩니다.</p>
          <p className="pose-note">Hip visibility ≥ {HIP_CALIBRATION_VISIBILITY}, knee visibility ≥ {KNEE_CALIBRATION_VISIBILITY}. world depth는 HIP 필수 항목입니다. 카메라 Stop 시 초기화됩니다.</p>
          <table className="visibility-table feature-baseline-table" aria-label="Neutral baseline and valid samples">
            <thead><tr><th scope="col">Feature</th><th scope="col">Baseline</th><th scope="col">Valid</th></tr></thead>
            <tbody>{CALIBRATION_FEATURES.map(({ raw }) => (
              <tr key={raw}><th scope="row">{raw}</th><td>{format(view.baseline?.[raw])}</td><td>{view.sampleCounts[raw]}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>
      <h4>Calibrated / Smoothed Features</h4>
      <p role="status">Smoothed: <strong>{view.smoothed.validNow ? 'VALID' : view.smoothed.lastValidAt === null ? 'UNAVAILABLE' : 'STALE'}</strong></p>
      <p className="pose-note">Calibrated = 현재 raw − Neutral. Smoothed = 최근 400ms 유효 delta의 중앙값. 현재 Pose/HIP이 없거나 유효하지 않으면 STALE 및 -로 표시합니다. 누락된 knee 값도 -로 표시합니다.</p>
      <div className="signal-table-scroll" role="region" aria-label="Calibrated and smoothed features" tabIndex={0}>
        <table className="visibility-table feature-delta-table">
          <thead><tr><th scope="col">Feature</th><th scope="col">Calibrated</th><th scope="col">Smoothed (400ms)</th></tr></thead>
          <tbody>{CALIBRATION_FEATURES.map(({ delta }) => (
            <tr key={delta}><th scope="row">{delta}</th><td>{format(view.calibrated[delta])}</td><td>{format(view.smoothed.validNow ? view.smoothed.values[delta] : null)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}
