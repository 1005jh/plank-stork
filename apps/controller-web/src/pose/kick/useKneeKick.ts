import { useCallback, useEffect, useRef, useState } from 'react';
import type { PoseFrame } from '../../recorder/poseRecorderTypes';
import type { PoseFeatureView } from '../features/poseFeatureTypes';
import { KneeKickAnalysis } from './kneeKickAnalysis';
import type { KickObserver } from '../../replay/replayTypes';
import type { KickDiagnosticDataset } from './kneeKickDiagnostics';

// Retain only the latest stopped trial across component remounts in this page. No persistence/upload.
let retainedDiagnostics: KickDiagnosticDataset | null = null;

export function useKneeKick(observer?: KickObserver) {
  const observerRef = useRef(observer); observerRef.current = observer;
  const ref = useRef<KneeKickAnalysis | null>(null);
  if (!ref.current) ref.current = new KneeKickAnalysis(retainedDiagnostics);
  const engine = ref.current;
  const observe = useCallback((event: Parameters<KickObserver>[0]) => {
    observerRef.current?.(event, () => engine.getReplaySnapshot());
  }, [engine]);
  const getCurrent = useCallback(() => {
    const now = performance.now(), current = engine.getView(now);
    observe({ kind: 'CLOCK', timestamp: now }); return current;
  }, [engine, observe]);
  const [view, setView] = useState(getCurrent);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const downloads = useRef(new Map<string, number>());
  const clearDownloads = useCallback(() => {
    for (const [url, timer] of downloads.current) { window.clearTimeout(timer); URL.revokeObjectURL(url); }
    downloads.current.clear();
  }, []);
  const processFrame = useCallback((frame: PoseFrame, neutral: PoseFeatureView) => {
    engine.processFrame(frame, neutral);
    observe({ kind: 'FRAME', timestamp: frame.timestamp, frame, neutral });
  }, [engine, observe]);
  const reset = useCallback((reason = 'RESET') => {
    const now = performance.now(); observe({ kind: 'RESET', timestamp: now, reason });
    engine.reset(now, reason); retainedDiagnostics = engine.getSavedDiagnostics(); clearDownloads();
  }, [engine, clearDownloads, observe]);
  useEffect(() => {
    const timer = window.setInterval(() => setView(getCurrent()), 250);
    return () => { window.clearInterval(timer); reset('UNMOUNT'); };
  }, [getCurrent, reset]);
  function startTest() {
    const now = performance.now();
    const started = engine.startTest(now, () => observe({ kind: 'CLOCK', timestamp: now }));
    if (started) observe({ kind: 'START', timestamp: now });
    if (started) { clearDownloads(); setDownloadError(null); }
    setView(getCurrent()); return started;
  }
  function resetTest() {
    const now = performance.now(); observe({ kind: 'RESET', timestamp: now, reason: 'RESET_TEST' });
    engine.resetTest(now); retainedDiagnostics = engine.getSavedDiagnostics();
    clearDownloads(); setDownloadError(null); setView(getCurrent());
  }
  function downloadDiagnostics() {
    const link = document.createElement('a'); let url: string | null = null;
    try {
      const now = performance.now();
      const json = engine.exportDiagnosticsJson(now); observe({ kind: 'CLOCK', timestamp: now });
      url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      link.href = url; link.download = `plank-stork-kick-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.append(link); link.click(); setDownloadError(null);
    } catch (cause) { setDownloadError(cause instanceof Error ? cause.message : String(cause)); }
    finally {
      link.remove();
      if (url) {
        const objectUrl = url;
        downloads.current.set(objectUrl, window.setTimeout(() => { URL.revokeObjectURL(objectUrl); downloads.current.delete(objectUrl); }, 1000));
      }
    }
  }
  return { view, stages: engine.getTestStages(), diagnostics: engine.getDiagnosticSummary(), downloadDiagnostics, downloadError,
    getCurrent, processFrame, reset, startTest, resetTest };
}
