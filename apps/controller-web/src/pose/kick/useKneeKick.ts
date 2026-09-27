import { useCallback, useEffect, useRef, useState } from 'react';
import type { PoseFrame } from '../../recorder/poseRecorderTypes';
import type { PoseFeatureView } from '../features/poseFeatureTypes';
import { KneeKickAnalysis } from './kneeKickAnalysis';

export function useKneeKick() {
  const ref = useRef<KneeKickAnalysis | null>(null);
  if (!ref.current) ref.current = new KneeKickAnalysis();
  const engine = ref.current;
  const getCurrent = useCallback(() => engine.getView(performance.now()), [engine]);
  const [view, setView] = useState(getCurrent);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const downloads = useRef(new Map<string, number>());
  const clearDownloads = useCallback(() => {
    for (const [url, timer] of downloads.current) { window.clearTimeout(timer); URL.revokeObjectURL(url); }
    downloads.current.clear();
  }, []);
  const processFrame = useCallback((frame: PoseFrame, neutral: PoseFeatureView) => engine.processFrame(frame, neutral), [engine]);
  const reset = useCallback(() => { engine.reset(); clearDownloads(); }, [engine, clearDownloads]);
  useEffect(() => {
    const timer = window.setInterval(() => setView(getCurrent()), 250);
    return () => { window.clearInterval(timer); reset(); };
  }, [getCurrent, reset]);
  function startTest() {
    const started = engine.startTest(performance.now());
    if (started) { clearDownloads(); setDownloadError(null); }
    setView(getCurrent()); return started;
  }
  function resetTest() { engine.resetTest(); clearDownloads(); setDownloadError(null); setView(getCurrent()); }
  function downloadDiagnostics() {
    const link = document.createElement('a'); let url: string | null = null;
    try {
      url = URL.createObjectURL(new Blob([engine.exportDiagnosticsJson()], { type: 'application/json' }));
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
