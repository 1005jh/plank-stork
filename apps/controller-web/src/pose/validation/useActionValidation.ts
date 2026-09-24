import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionValidation } from './actionValidation';
import type { ValidationStart } from './validationTypes';
import type { PoseFrame } from '../../recorder/poseRecorderTypes';
import type { PoseFeatureView } from '../features/poseFeatureTypes';
import type { PoseActionView } from '../actions/poseActionTypes';

export function useActionValidation() {
  const engineRef = useRef<ActionValidation | null>(null);
  if (!engineRef.current) engineRef.current = new ActionValidation();
  const engine = engineRef.current;
  const [view, setView] = useState(() => engine.getView(performance.now()));
  const [error, setError] = useState<string | null>(null);
  const downloads = useRef(new Map<string, number>());
  const getCurrent = useCallback(() => engine.getView(performance.now()), [engine]);
  const recordFrame = useCallback((frame: PoseFrame, features: PoseFeatureView, actions: PoseActionView) => {
    engine.recordFrame(frame, features, actions);
  }, [engine]);
  // Also used by camera release/unmount. No per-frame or cleanup React updates.
  const reset = useCallback(() => {
    engine.reset();
    for (const [url, timer] of downloads.current) { window.clearTimeout(timer); URL.revokeObjectURL(url); }
    downloads.current.clear();
  }, [engine]);

  useEffect(() => {
    const timer = window.setInterval(() => setView(getCurrent()), 250);
    return () => { window.clearInterval(timer); reset(); };
  }, [getCurrent, reset]);

  function start(context: ValidationStart): boolean {
    if (!engine.start(context, performance.now())) {
      setError('Camera RUNNING, Neutral FROZEN 및 네 Action prototype READY가 필요합니다.');
      return false;
    }
    setError(null); setView(getCurrent()); return true;
  }
  function resetValidation() { reset(); setError(null); setView(getCurrent()); }
  function download() {
    const link = document.createElement('a');
    let url: string | null = null;
    try {
      const json = engine.exportJson();
      url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      link.href = url;
      link.download = `plank-stork-validation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.append(link); link.click(); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally {
      link.remove();
      if (url) {
        const objectUrl = url;
        const timer = window.setTimeout(() => { URL.revokeObjectURL(objectUrl); downloads.current.delete(objectUrl); }, 1000);
        downloads.current.set(objectUrl, timer);
      }
    }
  }
  return { view, summary: engine.getSummary(), error, recordFrame, getCurrent, start, reset, resetValidation, download };
}
