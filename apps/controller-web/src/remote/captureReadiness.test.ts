// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { captureReadinessSnapshot } from './captureReadiness';
import { ReplayCapture, type ArtifactState } from '../replay/replayCapture';
import { EstimatorNeutralReadiness } from '../capture/estimatorNeutralReadiness';
import { ESTIMATOR_VALIDATION_PROTOCOL_V1 as P } from '../capture/estimatorValidationProtocol';
import { motionFrame } from '../pose/motion/testFixtures';

function recording(r = new EstimatorNeutralReadiness(), now = 0) {
  return { ...new ReplayCapture().getView(now), artifactState: 'RECORDING' as const,
    readiness: r.getView(now), guidedStartAllowed: r.canStart(now) };
}
function fill(r: EstimatorNeutralReadiness, count: number) {
  r.reset(0);
  for (let i = 1; i <= count; i++) r.process(motionFrame(i * 50), i * 50, true);
}

describe('compact capture readiness projection', () => {
  it.each<ArtifactState>(['IDLE', 'STOPPING', 'WEBM_READY', 'HASHING', 'MEDIA_INSPECTION', 'ARTIFACT_READY', 'ARTIFACT_FAILED'])('maps %s to NOT_REQUIRED without exposing artifact state', (artifactState) => {
    const view = new ReplayCapture().getView(0);
    const snapshot = captureReadinessSnapshot({ ...view, artifactState });
    expect(snapshot).toMatchObject({ captureRecording: false, estimatorNeutralStatus: 'NOT_REQUIRED', guidedStartAllowed: true });
    expect(snapshot).not.toHaveProperty('artifactState');
  });

  it('maps recording before Neutral to NOT_STARTED', () => {
    expect(captureReadinessSnapshot(recording())).toMatchObject({ captureRecording: true, estimatorNeutralStatus: 'NOT_STARTED',
      analysisReadyFrameCount: 0, requiredFrameCount: P.neutralReferenceMinUsableFrames, guidedStartAllowed: false });
  });

  it('projects COLLECTING 45/60 independently of current missing joints', () => {
    const r = new EstimatorNeutralReadiness(); fill(r, 45);
    expect(captureReadinessSnapshot(recording(r, 2250))).toMatchObject({ estimatorNeutralStatus: 'COLLECTING',
      analysisReadyFrameCount: 45, requiredFrameCount: 60, missingJoints: [], allJointsReadyNow: true, guidedStartAllowed: false });
  });

  it('keeps required joint order and exact rolling per-joint counts, without coordinates or baselines', () => {
    const r = new EstimatorNeutralReadiness(); r.reset(0);
    for (let i = 1; i <= 10; i++) {
      const frame = motionFrame(i * 50); frame.landmarks[27].visibility = .1;
      if (i > 5) frame.landmarks[26].visibility = .1;
      r.process(frame, i * 50, true);
    }
    const view = recording(r, 500);
    view.readiness.current.reverse(); // Wire order comes from the protocol, not input array order.
    const snapshot = captureReadinessSnapshot(view);
    expect(snapshot.missingJoints).toEqual(['RIGHT_KNEE', 'LEFT_ANKLE']);
    expect(Object.keys(snapshot.perJointUsableFrames)).toEqual(P.requiredJoints);
    expect(snapshot.perJointUsableFrames).toEqual({ LEFT_SHOULDER: 10, RIGHT_SHOULDER: 10, LEFT_HIP: 10, RIGHT_HIP: 10,
      LEFT_KNEE: 10, RIGHT_KNEE: 5, LEFT_ANKLE: 0, RIGHT_ANKLE: 10 });
    expect(Object.keys(snapshot).sort()).toEqual(['captureRecording', 'estimatorNeutralStatus', 'analysisReadyFrameCount',
      'requiredFrameCount', 'perJointUsableFrames', 'missingJoints', 'allJointsReadyNow', 'guidedStartAllowed'].sort());
    expect(JSON.stringify(snapshot)).not.toMatch(/landmarks|world|visibility|reference|baseline|threshold|"[xyz]"/i);
    snapshot.perJointUsableFrames.LEFT_HIP = -1;
    expect(view.readiness.perJointUsableFrames.LEFT_HIP).toBe(10);
  });

  it('keeps frozen READY after pose loss even when rolling counts expire, then respects the consumed gate', () => {
    const r = new EstimatorNeutralReadiness(); fill(r, 60);
    expect(captureReadinessSnapshot(recording(r, 3000))).toMatchObject({ estimatorNeutralStatus: 'READY', guidedStartAllowed: true });
    r.process({ ...motionFrame(7000), landmarks: [], worldLandmarks: [] }, 7000, true);
    expect(captureReadinessSnapshot(recording(r, 7000))).toMatchObject({ estimatorNeutralStatus: 'READY', analysisReadyFrameCount: 0,
      missingJoints: [...P.requiredJoints], allJointsReadyNow: false, guidedStartAllowed: true });
    r.takeReference(7000);
    expect(captureReadinessSnapshot(recording(r, 7000))).toMatchObject({ estimatorNeutralStatus: 'READY', guidedStartAllowed: false });
    r.reset(7100);
    expect(captureReadinessSnapshot(recording(r, 7100))).toMatchObject({ estimatorNeutralStatus: 'COLLECTING', guidedStartAllowed: false });
  });

  it('never derives READY or the capture gate from sufficient counts', () => {
    const r = new EstimatorNeutralReadiness(); r.reset(0);
    for (let t = 1; t <= 60; t++) r.process(motionFrame(t), t, true);
    expect(captureReadinessSnapshot(recording(r, 60))).toMatchObject({ analysisReadyFrameCount: 60, estimatorNeutralStatus: 'COLLECTING', guidedStartAllowed: false });
  });
});
