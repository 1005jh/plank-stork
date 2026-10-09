import { validateReplayMediaArtifact, ReplayMediaValidationCache } from '../replay/mediaArtifact';
import { compareVideoCoverage } from '../replay/videoReplayMetrics';
import { ReplayVideoDiagnostics } from './ReplayVideoDiagnostics';
import { useEffect, useRef, useState } from 'react';
import { replayCalibration, replayLandmarks } from '../replay/landmarkReplay';
import { readReplaySession } from '../replay/readReplaySession';
import { replayDetectorMode, type ReplayOutput, type ReplayResult, type ReplaySession } from '../replay/replayTypes';
import { useLocalDownload } from '../replay/useLocalDownload';
import { inferReplayVideo } from '../replay/videoReplay';
import { diagnosticConfig } from '../pose/kick/kneeKickDiagnostics';
import { replayVideoSourceError, replayVideoSourceFromFilename } from '../replay/replayVideoSource';
import { replayKneeKickV3, type KneeKickV3Replay } from '../replay/kneeKickV3Replay';

const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
function ResultRow({ name, result }: { name: string; result: ReplayResult | null }) {
  const summary = result?.guidedSummary;
  const knee = (side: 'KNEE_LEFT' | 'KNEE_RIGHT') => summary ? `${summary[side].detected ? 'YES' : 'NO'} / ${summary[side].directionCorrect ?? '-'}` : '-';
  return <tr><th>{name}</th><td>{result?.poseFrameCount ?? '-'}</td><td>{result?.poseUsableFrameCount ?? '-'}</td>
    <td>{result?.events.filter((event) => event.direction === 'KNEE_LEFT').length ?? '-'}</td>
    <td>{result?.events.filter((event) => event.direction === 'KNEE_RIGHT').length ?? '-'}</td>
    <td>{summary?.TWIST_LEFT.falseKickCount ?? '-'} / {summary?.TWIST_RIGHT.falseKickCount ?? '-'}</td>
    <td>{summary?.NEUTRAL.falseKickCount ?? '-'}</td><td>{knee('KNEE_LEFT')}</td><td>{knee('KNEE_RIGHT')}</td><td>{result?.finalState ?? '-'}</td></tr>;
}
export function ReplayRunner() {
  const cache = useRef(new ReplayMediaValidationCache());
  const [identity, setIdentity] = useState<Awaited<ReturnType<typeof validateReplayMediaArtifact>> | null>(null);
  const [session, setSession] = useState<ReplaySession | null>(null);
  const [file, setFile] = useState<File | null>(null), [trialId, setTrialId] = useState(1);
  const [landmark, setLandmark] = useState<ReplayOutput | null>(null), [videoResult, setVideoResult] = useState<ReplayOutput | null>(null);
  const [calibration, setCalibration] = useState<ReturnType<typeof replayCalibration> | null>(null);
  const [v3, setV3] = useState<KneeKickV3Replay | null>(null);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [progress, setProgress] = useState('');
  const video = useRef<HTMLCanvasElement>(null), abort = useRef<AbortController | null>(null), generation = useRef(0), mounted = useRef(false);
  const videoInput = useRef<HTMLInputElement>(null);
  const downloads = useLocalDownload();
  const videoSourceError = session?.version === 1 && file ? replayVideoSourceError(
    { filename: session.video.filename, sourceCaptureId: session.captureId }, replayVideoSourceFromFilename(file.name),
  ) : null;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; abort.current?.abort(); }; }, []);
  function resetResults() {
    generation.current++; abort.current?.abort(); downloads.clear(); cache.current = new ReplayMediaValidationCache(); setIdentity(null);
    setLandmark(null); setVideoResult(null); setCalibration(null); setV3(null); setError(null); setProgress('');
  }
  async function loadJson(file: File | undefined) {
    resetResults(); setSession(null); setFile(null);
    if (videoInput.current) videoInput.current.value = '';
    const id = generation.current;
    if (!file) return;
    try {
      const loaded = readReplaySession(await file.text());
      if (!mounted.current || generation.current !== id) return;
      setSession(loaded); setTrialId(loaded.liveResult.trials[0]?.id ?? 1);
    } catch (cause) { if (mounted.current && generation.current === id) setError(message(cause)); }
  }
  function runLandmark() {
    if (!session) return;
    try { setError(null); setLandmark(replayLandmarks(session, trialId)); }
    catch (cause) { setError(message(cause)); }
  }
  function runCalibration() {
    if (!session) return;
    try { setError(null); setCalibration(replayCalibration(session, trialId)); }
    catch (cause) { setError(message(cause)); }
  }
  function runV3() {
    if (!session) return;
    try { setError(null); setV3(replayKneeKickV3(session, trialId)); }
    catch (cause) { setV3(null); setError(message(cause)); }
  }
  async function runVideo() {
    if (!session || !file || !video.current || busy) return;
    // Guard execution as well as the button, before initializing any replay resources.
    if (session.version === 1 && replayVideoSourceError(
      { filename: session.video.filename, sourceCaptureId: session.captureId }, replayVideoSourceFromFilename(file.name),
    )) return;
    const id = ++generation.current, controller = new AbortController(); abort.current = controller;
    setBusy(true); setError(null); setVideoResult(null); setProgress('Media identity 검증 중…');
    try {
      const verified = await validateReplayMediaArtifact(session, file, controller.signal, cache.current);
      if (!mounted.current || generation.current !== id) return;
      setIdentity(verified);
      const output = await inferReplayVideo(video.current, file, session, controller.signal, (tMs, count) => {
        if (mounted.current && generation.current === id) setProgress(`${(tMs / 1000).toFixed(1)}s · ${count} pose frames`);
      }, cache.current);
      if (!mounted.current || generation.current !== id) return;
      const result = replayLandmarks(session, trialId, output.frames, 'VIDEO');
      result.videoDiagnostics = compareVideoCoverage(session, trialId, output.frames, output.diagnostics);
      result.videoPose = { delegate: output.delegate, modelUrl: output.modelUrl };
      setVideoResult(result); setProgress(`완료 · 전체 video inference ${output.frames.length} frames`);
    } catch (cause) {
      if (mounted.current && generation.current === id) {
        if (controller.signal.aborted) setProgress('취소됨'); else setError(message(cause));
      }
    } finally { if (mounted.current) setBusy(false); }
  }
  const trial = session?.liveResult.trials.find((trial) => trial.id === trialId);
  const canRun = !!trial && trial.endMs !== null && !busy;
  function downloadResults() {
    if (!session) return;
    downloads.download(new Blob([JSON.stringify({ sourceCaptureId: session.captureId, landmark, video: videoResult, calibration, v3 }, null, 2)], { type: 'application/json' }), `${session.captureId}-results.json`);
  }
  return <section aria-label="STEP 4F Replay Runner">
    <h3>STEP 4F.1 — Replay Runner</h3>
    <p>Video는 디코딩된 모든 프레임을 순차 추론합니다. 실제 영상 길이보다 오래 걸릴 수 있습니다.</p>
    <p>Landmark는 JSON만 필요합니다. Video는 같은 capture ID의 WebM을 추가로 선택하세요. 재생 상태는 live와 분리됩니다.</p>
    <label>Replay JSON <input type="file" accept=".json,application/json" onChange={(event) => void loadJson(event.target.files?.[0])} /></label>{' '}
    <label>Replay WebM <input ref={videoInput} type="file" accept=".webm,video/webm" onChange={(event) => { resetResults(); setFile(event.target.files?.[0] ?? null); }} /></label>
    {session && <p>Capture: {session.captureId} · Detector: {replayDetectorMode(session)} · Recorded delegate: {session.pose.delegate} · Expected video: {session.video.filename}</p>}
    {identity && <p>{identity.validation} · renamed: {String(identity.renamed)}</p>}
    {videoSourceError && <p role="alert">{videoSourceError}</p>}
    {session && JSON.stringify(session.liveResult.detectorConfig) !== JSON.stringify(diagnosticConfig()) && <p>저장된 detector 설정과 현재 설정이 다릅니다. 비교 결과에 차이가 생길 수 있습니다.</p>}
    {session && <label>Guided trial <select value={trialId} onChange={(event) => { resetResults(); setTrialId(Number(event.target.value)); }}>
      {session.liveResult.trials.map((trial) => <option key={trial.id} value={trial.id}>Trial {trial.id} · {(trial.startMs / 1000).toFixed(1)}s</option>)}
    </select></label>}
    {session && !trial && <p>Capture에 Guided Test 시작이 없습니다. Capture를 먼저 시작한 뒤 Neutral 재보정과 Guided Test를 진행하세요.</p>}
    <p><button disabled={!canRun} onClick={runLandmark}>LANDMARK REPLAY</button>{' '}
      <button disabled={!canRun} onClick={runCalibration}>CALIBRATION REPLAY</button>{' '}
      <button disabled={!canRun} onClick={runV3}>Y V3 LANDMARK REPLAY</button>{' '}
      <button disabled={!canRun || !file || videoSourceError !== null} onClick={() => void runVideo()}>VIDEO REPLAY</button>{' '}
      <button disabled={!busy} onClick={() => abort.current?.abort()}>Cancel Video Replay</button></p>
    {progress && <p role="status">{progress}</p>}{error && <p role="alert">{error}</p>}
    <canvas ref={video} aria-label="Replay decoded frame" style={{ maxWidth: '100%', width: 480 }} />
    {videoResult?.videoDiagnostics && <ReplayVideoDiagnostics diagnostics={videoResult.videoDiagnostics} />}
    <div className="signal-table-scroll"><table className="visibility-table"><thead><tr>
      {['Source', 'Pose frames', 'Usable frames', 'LEFT events', 'RIGHT events', 'Twist L / R false', 'Neutral false', 'Knee L detected / correct', 'Knee R detected / correct', 'Final state'].map((name) => <th key={name}>{name}</th>)}
    </tr></thead><tbody>
      <ResultRow name={session && replayDetectorMode(session) === 'Y_V3' ? 'LIVE V3' : 'LIVE X'} result={trial?.result ?? null} />
      {session && replayDetectorMode(session) === 'Y_V3' && <ResultRow name="LIVE X SHADOW" result={trial?.legacyXShadow?.result ?? null} />}
      <ResultRow name="LANDMARK X" result={landmark?.result ?? null} /><ResultRow name="VIDEO X" result={videoResult?.result ?? null} />
      <ResultRow name="Y V3 LANDMARK" result={v3?.result ?? null} />
    </tbody></table></div>
    {[landmark, videoResult].map((result) => result && <p key={result.replayMode}>{result.replayMode} X → {result.comparison.target ?? 'LIVE_X'}: {result.comparison.available === false ? 'No recorded X reference to compare' : `Events/time ${result.comparison.eventsEqual ? 'MATCH' : 'DIFFER'} · Summary ${result.comparison.guidedSummaryEqual ? 'MATCH' : 'DIFFER'} · Final state ${result.comparison.finalStateEqual ? 'MATCH' : 'DIFFER'}`}</p>)}
    {calibration && <details open><summary>Calibration: Neutral {calibration.neutralBaselineEqual ? 'MATCH' : 'DIFFER'} · X baseline {calibration.kickBaselineEqual ? 'MATCH' : 'DIFFER'} · V3 baseline {calibration.kickBaselineV3Equal === null ? 'NO STORED V3' : calibration.kickBaselineV3Equal ? 'MATCH' : 'DIFFER'}</summary><pre>{JSON.stringify(calibration, null, 2)}</pre></details>}
    <p>STEP 4I — Live controller/mobile은 Y V3 PRIMARY입니다. Y V3 LANDMARK는 새 capture의 LIVE V3와 비교합니다. 기존 LANDMARK/VIDEO는 X reference이며 shadow 불일치는 V3 실패가 아닙니다.</p>
    {v3 && <section aria-label="Y V3 replay diagnostics">
      {v3.comparison ? <p>LIVE V3 ↔ LANDMARK V3: Events/time {v3.comparison.eventsEqual ? 'MATCH' : 'DIFFER'} · Summary {v3.comparison.guidedSummaryEqual ? 'MATCH' : 'DIFFER'} · Final state {v3.comparison.finalStateEqual ? 'MATCH' : 'DIFFER'}</p> : <p>Legacy X capture: V3 live parity는 비교 대상이 없습니다.</p>}
      {v3.calibrationParity && <p>Actual calibration frames → V3 baseline: {v3.calibrationParity.kickBaselineV3Equal === null ? 'NO STORED V3' : v3.calibrationParity.kickBaselineV3Equal ? 'MATCH' : 'DIFFER'}</p>}
      <p>Baseline: {v3.baseline.source} · Calibration-only frames: {v3.calibrationOnlyFrameCount} · Cross-gap: {v3.counts.crossGapConfirmations} · Reacquisition false: {v3.counts.reacquisitionFalseEvents}</p>
      {v3.warnings.map((warning) => <p key={warning}>{warning}</p>)}
      <p>Clean acceptance: {String(v3.cleanAcceptance)} · Stress safety: {String(v3.stressAcceptance)} · Wrong: {v3.counts.wrongDirection} · Duplicate: {v3.counts.duplicates}</p>
      <table className="visibility-table"><caption>V3 stage results (expected-side observability)</caption>
        <thead><tr>{['Stage', 'Left usable', 'Right usable', 'Outcome', 'False'].map((s) => <th key={s}>{s}</th>)}</tr></thead>
        <tbody>{v3.stages.map((s) => <tr key={s.stageIndex}><th>{s.expected}</th><td>{s.leftUsableFrames}</td><td>{s.rightUsableFrames}</td><td>{s.outcome}</td><td>{s.falseEvents}</td></tr>)}</tbody>
      </table>
      <details><summary>V3 baseline / events / final tracking diagnostics / X comparison</summary><pre>{JSON.stringify({ baseline: v3.baseline,
        events: v3.events, final: v3.finalDiagnostics, legacyX: v3.legacyX }, null, 2)}</pre></details>
    </section>}
    <button disabled={!landmark && !videoResult && !calibration && !v3} onClick={downloadResults}>Download Replay Results JSON</button>
  </section>;
}
