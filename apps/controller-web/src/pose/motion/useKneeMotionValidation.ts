import { useCallback, useEffect, useRef, useState } from 'react';
import type { PoseFrame } from '../../recorder/poseRecorderTypes';
import type { PoseFeatureView } from '../features/poseFeatureTypes';
import { KneeMotionValidation } from './kneeMotionValidation';
import type { MotionStart } from './kneeMotionTypes';

export function useKneeMotionValidation() {
  const ref = useRef<KneeMotionValidation | null>(null);
  if (!ref.current) ref.current = new KneeMotionValidation();
  const engine = ref.current;
  const [view, setView] = useState(() => engine.getView(performance.now()));
  const [error, setError] = useState<string | null>(null);
  const downloads = useRef(new Map<string, number>());
  const getCurrent = useCallback(() => engine.getView(performance.now()), [engine]);
  const recordFrame = useCallback((frame: PoseFrame, neutral: PoseFeatureView) => engine.recordFrame(frame, neutral), [engine]);
  const reset = useCallback(() => {
    engine.reset();
    for (const [url, timer] of downloads.current) { window.clearTimeout(timer); URL.revokeObjectURL(url); }
    downloads.current.clear();
  }, [engine]);
  useEffect(() => {
    const timer = window.setInterval(() => setView(getCurrent()), 250);
    return () => { window.clearInterval(timer); reset(); };
  }, [getCurrent, reset]);

  function start(context: MotionStart): boolean {
    if (!engine.start(context, performance.now())) {
      setError('Camera RUNNING, Pose detected, Neutral FROZEN 후 시작하세요.'); return false;
    }
    setError(null); setView(getCurrent()); return true;
  }
  function resetMotion() { reset(); setError(null); setView(getCurrent()); }
  function download() {
    const link = document.createElement('a'); let url: string | null = null;
    try {
      url = URL.createObjectURL(new Blob([engine.exportJson()], { type: 'application/json' }));
      link.href = url; link.download = `plank-stork-knee-motion-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.append(link); link.click(); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally {
      link.remove();
      if (url) {
        const objectUrl = url;
        downloads.current.set(objectUrl, window.setTimeout(() => { URL.revokeObjectURL(objectUrl); downloads.current.delete(objectUrl); }, 1000));
      }
    }
  }
  return { view, analysis: engine.getAnalysis(), error, getCurrent, recordFrame, start, reset, resetMotion, download };
}
