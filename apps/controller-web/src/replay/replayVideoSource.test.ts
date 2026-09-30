// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { replayVideoSourceError, replayVideoSourceFromFilename } from './replayVideoSource';

const captureId = 'plank-stork-replay-2026-09-30T12-34-56-789Z';
const expected = { filename: `${captureId}.webm`, sourceCaptureId: captureId };
const mismatch = 'Replay JSON과 다른 capture의 WebM입니다.';

describe('Replay WebM source matching', () => {
  it('accepts the exact filename and matching parsed capture ID', () => {
    const source = replayVideoSourceFromFilename(expected.filename);
    expect(source.sourceCaptureId).toBe(captureId);
    expect(replayVideoSourceError(expected, source)).toBeNull();
  });
  it.each(['other.webm', 'clean인가.webm', `${captureId} (1).webm`, `${captureId}.WEBM`])('rejects a different filename: %s', (filename) => {
    expect(replayVideoSourceError(expected, replayVideoSourceFromFilename(filename))).toBe(mismatch);
  });
  it('rejects an inconsistent JSON capture ID even when the filenames match', () => {
    expect(replayVideoSourceError({ ...expected, sourceCaptureId: 'another-capture' }, replayVideoSourceFromFilename(expected.filename))).toBe(mismatch);
  });
  it('does not invent a capture ID for custom names and still requires the expected filename', () => {
    const source = replayVideoSourceFromFilename('clean인가.webm');
    expect(source.sourceCaptureId).toBeNull();
    expect(replayVideoSourceError({ ...expected, filename: source.filename }, source)).toBeNull();
    expect(replayVideoSourceError({ ...expected, filename: 'plank-stork-replay-custom.webm' }, source)).toBe(mismatch);
    expect(replayVideoSourceFromFilename('plank-stork-replay-custom.webm').sourceCaptureId).toBeNull();
  });
  it('can check an independently supplied identity without depending on how metadata was read', () => {
    const renamed = { ...expected, filename: 'renamed.webm' };
    expect(replayVideoSourceError(renamed, { filename: renamed.filename, sourceCaptureId: captureId })).toBeNull();
    expect(replayVideoSourceError(renamed, { filename: renamed.filename, sourceCaptureId: 'another-capture' })).toBe(mismatch);
  });
});
