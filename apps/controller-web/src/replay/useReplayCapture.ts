import { useCallback, useEffect, useRef, useState } from 'react';
import { ReplayCapture } from './replayCapture';
import type { CaptureCamera } from './replayTypes';
import { useLocalDownload } from './useLocalDownload';

export function useReplayCapture() {
  const ref = useRef<ReplayCapture | null>(null);
  if (!ref.current) ref.current = new ReplayCapture();
  const capture = ref.current;
  const [view, setView] = useState(() => capture.getView(performance.now()));
  const files = useLocalDownload();
  const stop = useCallback(() => capture.stop(performance.now()), [capture]);
  useEffect(() => {
    const timer = window.setInterval(() => setView(capture.getView(performance.now())), 250);
    return () => { window.clearInterval(timer); void stop(); };
  }, [capture, stop]);
  function start(camera: CaptureCamera | null, mirrored: boolean) {
    files.clear(); capture.start(camera, mirrored, performance.now()); setView(capture.getView(performance.now()));
  }
  function download(kind: 'video' | 'json') {
    const saved = capture.getFiles();
    files.download(kind === 'video' ? saved.video : new Blob([saved.json], { type: 'application/json' }), kind === 'video' ? saved.filename : saved.jsonFilename);
  }
  return { view, start, stop, download, observe: capture.observe, neutralStarted: capture.neutralStarted };
}
