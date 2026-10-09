// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ReplayCapture } from './replayCapture';
import { captureCamera, createTestCapture, fixtureFinalizer, mockRecorder } from './testFixtures';
import { hashBlob, type finalizeMediaArtifact } from './mediaArtifact';
import { readyCapture } from './v2TestFixtures';
import { readReplaySession } from './readReplaySession';

describe('V2 capture finalization and Guided reference', () => {
  it('withholds JSON until finalization resolves, then downloads the exact hashed Blob', async () => {
    let release!: () => void, hashed: Blob | undefined;
    const finalize: typeof finalizeMediaArtifact = async (blob, video, signal, phase) => {
      hashed = blob; phase?.('HASHING'); const sha256 = await hashBlob(blob, signal);
      await new Promise<void>((r) => { release = r; }); phase?.('MEDIA_INSPECTION');
      return { ...await fixtureFinalizer(blob, video, signal), sha256 };
    };
    const capture = new ReplayCapture(finalize); capture.start(captureCamera(), true, 0, mockRecorder);
    let resolved = false; const stopped = capture.stop(100).then(() => { resolved = true; });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(resolved).toBe(false); expect(capture.getView(200).artifactState).toBe('HASHING');
    expect(() => capture.getFiles()).toThrow('NOT VALIDATION READY');
    expect(capture.start(captureCamera(), false, 200, mockRecorder)).toBe(false);
    release(); await stopped;
    const saved = capture.getFiles(), session = readReplaySession(saved.json);
    expect(saved.video).toBe(hashed); expect(session.video.integrity!.sha256).toBe(await hashBlob(saved.video, new AbortController().signal));
    expect(session).toMatchObject({ version: 2, attemptId: session.captureId, validation: { mediaIntegrityReady: true, status: 'INCOMPLETE' } });
    expect(capture.getView(300).artifactState).toBe('ARTIFACT_READY');
  });
  it.each(['cancel', 'dispose', 'failure'] as const)('settles stop safely after %s without a validation download', async (mode) => {
    let release!: () => void, signal!: AbortSignal;
    const capture = new ReplayCapture(async (_blob, _video, s, phase) => {
      signal = s; phase?.('MEDIA_INSPECTION'); await new Promise<void>((r) => { release = r; }); throw new Error('inspection failed');
    });
    capture.start(captureCamera(), false, 0, mockRecorder); const stop = capture.stop(100);
    if (mode === 'cancel') capture.cancelFinalization(); if (mode === 'dispose') capture.dispose();
    expect(signal.aborted).toBe(mode !== 'failure'); release(); await stop;
    expect(capture.getView(200)).toMatchObject({ artifactState: 'ARTIFACT_FAILED', downloadable: false });
    expect(() => capture.getFiles()).toThrow('NOT VALIDATION READY');
  });
  it('gates only RECORDING, copies the reference once, and completes at 22s despite pose loss', async () => {
    const idle = createTestCapture(); expect(idle.canStartGuided(0)).toBe(true);
    idle.start(captureCamera(), true, 0, mockRecorder); expect(idle.canStartGuided(0)).toBe(false); await idle.stop(10); expect(idle.canStartGuided(20)).toBe(true);
    const { capture, kick, read, frame } = readyCapture();
    expect(capture.canStartGuided(3101)).toBe(true); expect(kick.startTest(3101)).toBe(true);
    const ref = capture.getView(3101).readiness.reference;
    capture.observe({ kind: 'START', timestamp: 3101 }, read); expect(capture.canStartGuided(3102)).toBe(false);
    frame(4000, true); frame(25000, true); kick.getView(25101); capture.observe({ kind: 'CLOCK', timestamp: 25101 }, read);
    await capture.stop(25200); const saved = readReplaySession(capture.getFiles().json);
    expect(saved.validation).toMatchObject({ estimatorReferenceReady: true, trialHasEstimatorReference: true, guidedTrialCompleted: true, status: 'VALIDATION_CAPTURE_COMPLETE' });
    expect(saved.liveResult.trials[0].estimatorNeutralReference).toEqual(ref);
    expect(saved.markers.find((m) => m.type === 'GUIDED_TEST_COMPLETE')?.tMs).toBe(25101);
  });
  it('resets pending reference on recalibration and never changes a previous trial reference', async () => {
    const { capture, kick, read } = readyCapture(); kick.startTest(3101); capture.observe({ kind: 'START', timestamp: 3101 }, read);
    const first = capture.getView(3101).readiness.reference;
    capture.neutralStarted(4000); expect(capture.getView(4000).readiness).toMatchObject({ reference: null, analysisReadyFrameCount: 0 });
    expect(capture.canStartGuided(4000)).toBe(false); await capture.stop(4100);
    expect(readReplaySession(capture.getFiles().json).liveResult.trials[0].estimatorNeutralReference).toEqual(first);
  });
  it('marks a defensive START without reference invalid without stopping the live timeline', async () => {
    const { capture, kick, read } = readyCapture(); capture.neutralStarted(3100);
    expect(kick.startTest(3101)).toBe(true); capture.observe({ kind: 'START', timestamp: 3101 }, read);
    kick.getView(25101); capture.observe({ kind: 'CLOCK', timestamp: 25101 }, read);
    await capture.stop(25200); const saved = readReplaySession(capture.getFiles().json);
    expect(saved.liveResult.trials[0].validationStatus).toBe('INVALID_MISSING_ESTIMATOR_REFERENCE');
    expect(saved.markers.some((m) => m.type === 'INVALID_MISSING_ESTIMATOR_REFERENCE')).toBe(true);
    expect(saved.validation).toMatchObject({ status: 'INCOMPLETE', guidedTrialCompleted: true, trialHasEstimatorReference: false });
  });
});
