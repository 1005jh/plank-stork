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
  const processFrame = useCallback((frame: PoseFrame, neutral: PoseFeatureView) => engine.processFrame(frame, neutral), [engine]);
  const reset = useCallback(() => engine.reset(), [engine]);
  useEffect(() => {
    const timer = window.setInterval(() => setView(getCurrent()), 250);
    return () => { window.clearInterval(timer); reset(); };
  }, [getCurrent, reset]);
  function startTest() { const started = engine.startTest(performance.now()); setView(getCurrent()); return started; }
  function resetTest() { engine.resetTest(); setView(getCurrent()); }
  return { view, stages: engine.getTestStages(), getCurrent, processFrame, reset, startTest, resetTest };
}
