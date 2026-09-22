import { useCallback, useEffect, useRef, useState } from 'react';
import { ACTION_UI_INTERVAL_MS } from './poseActionConstants';
import { PoseActionAnalysis } from './poseActionAnalysis';
import type { ActionInput } from './poseActionTypes';

export function usePoseActions(getFeatures: () => ActionInput) {
  const analysisRef = useRef<PoseActionAnalysis | null>(null);
  if (analysisRef.current === null) analysisRef.current = new PoseActionAnalysis();
  const analysis = analysisRef.current;
  const [view, setView] = useState(() => analysis.getView(getFeatures(), performance.now()));
  const [error, setError] = useState<string | null>(null);
  const processFrame = useCallback((input: ActionInput, timestamp: number) => {
    analysis.processFrame(input, timestamp);
  }, [analysis]);
  // Called by camera release/unmount, without scheduling React updates.
  const reset = useCallback(() => analysis.reset(), [analysis]);
  const getCurrent = useCallback(() => analysis.getView(getFeatures(), performance.now()), [analysis, getFeatures]);

  useEffect(() => {
    const timer = window.setInterval(() => setView(analysis.getView(getFeatures(), performance.now())), ACTION_UI_INTERVAL_MS);
    return () => { window.clearInterval(timer); analysis.reset(); };
  }, [analysis, getFeatures]);

  function start() {
    const input = getFeatures();
    if (!analysis.start(input, performance.now())) {
      setError('Action calibration requires frozen Neutral calibration.');
      return false;
    }
    setError(null);
    setView(analysis.getView(input, performance.now()));
    return true;
  }

  function resetCalibration() {
    reset();
    setError(null);
    setView(analysis.getView(getFeatures(), performance.now()));
  }

  return { view, error, processFrame, getCurrent, reset, start, resetCalibration };
}
