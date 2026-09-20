import { useCallback, useEffect, useRef, useState } from 'react';
import { FEATURE_UI_INTERVAL_MS, PoseFeatureAnalysis } from './poseFeatureAnalysis';
import type { FeatureLandmarks } from './poseFeatureTypes';

export function usePoseFeatures() {
  const analysisRef = useRef<PoseFeatureAnalysis | null>(null);
  if (analysisRef.current === null) analysisRef.current = new PoseFeatureAnalysis();
  const analysis = analysisRef.current;
  const [view, setView] = useState(() => analysis.getView(performance.now()));

  const processFrame = useCallback((landmarks: FeatureLandmarks, worldLandmarks: FeatureLandmarks, timestamp: number) => {
    analysis.processFrame(landmarks, worldLandmarks, timestamp);
  }, [analysis]);
  // Safe for camera release and unmount: no React update is scheduled here.
  const reset = useCallback(() => analysis.reset(), [analysis]);

  useEffect(() => {
    const timer = window.setInterval(() => setView(analysis.getView(performance.now())), FEATURE_UI_INTERVAL_MS);
    return () => { window.clearInterval(timer); analysis.reset(); };
  }, [analysis]);

  function calibrate(cameraHasPose: boolean) {
    if (!cameraHasPose) return;
    analysis.startCalibration(performance.now());
    setView(analysis.getView(performance.now()));
  }

  return { view, processFrame, reset, calibrate };
}
