export interface ReplayVideoSource {
  filename: string;
  sourceCaptureId: string | null;
}

/** Only recognize the recorder's canonical name; renamed files have no inferred identity. */
export function replayVideoSourceFromFilename(filename: string): ReplayVideoSource {
  const match = /^(plank-stork-replay-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.webm$/.exec(filename);
  return { filename, sourceCaptureId: match?.[1] ?? null };
}

/** Keep identity extraction separate so verified container metadata can supply it later. */
export function replayVideoSourceError(
  expected: { filename: string; sourceCaptureId: string },
  selected: ReplayVideoSource,
): string | null {
  if (selected.filename !== expected.filename ||
      (selected.sourceCaptureId !== null && selected.sourceCaptureId !== expected.sourceCaptureId)) {
    return 'Replay JSON과 다른 capture의 WebM입니다.';
  }
  return null;
}
