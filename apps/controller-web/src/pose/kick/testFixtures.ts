import type { KickCandidateDiagnostics, KickValidityReason } from './kneeKickDetector';
import { DETECTOR_TEST_SEQUENCE, type GuidedDetectorTest } from './guidedDetectorTest';

export const emptyCandidate = (): KickCandidateDiagnostics => ({ candidateId: null, candidateActive: false, candidateStartedAt: null, candidateAgeMs: null,
  candidatePositivePeak: null, candidateNegativePeak: null, candidatePeakAbsVelocity: null, candidateSawLeft: false, candidateSawRight: false,
  candidateFrameCount: 0, candidateStrongestMagnitude: null, candidateDirectionMargin: null, candidateOutcome: null, candidateEndedAt: null, confirmationLatencyMs: null });

export const frameValidity = (usable: boolean) => ({
  inferenceGapMs: 50, neutralSmoothedValidNow: usable, kickHipsUsable: usable, kickLeftUsable: usable, kickRightUsable: usable,
  kickValidityReasons: (usable ? ['OK'] : ['NO_LANDMARKS', 'HIP_VISIBILITY', 'HIP_GEOMETRY', 'LEFT_KNEE_VISIBILITY', 'RIGHT_KNEE_VISIBILITY', 'LEFT_KNEE_GEOMETRY', 'RIGHT_KNEE_GEOMETRY', 'NO_USABLE_KNEE']) as KickValidityReason[],
  rawLeftHipVisibility: usable ? 0.95 : null, rawRightHipVisibility: usable ? 0.95 : null,
  rawLeftKneeVisibility: usable ? 0.8 : null, rawRightKneeVisibility: usable ? 0.6 : null,
  rawHipCenterX: usable ? 0.5 : null, rawLeftKneeX: usable ? 0.35 : null, rawRightKneeX: usable ? 0.65 : null,
  rawLeftKneeCenterOffsetX: usable ? -0.15 : null, rawRightKneeCenterOffsetX: usable ? 0.15 : null,
  rawLeftKneeHipDistance: usable ? 0.3 : null, rawRightKneeHipDistance: usable ? 0.3 : null,
});

/** Simulate the normal controller clock at each boundary, with a fresh ARMED detector. */
export function advanceUnblockedTest(test: GuidedDetectorTest, now: number, startedAt = 0) {
  let boundary = startedAt;
  for (const stage of DETECTOR_TEST_SEQUENCE) {
    boundary += stage.durationMs;
    if (boundary > now) break;
    test.advance(boundary, true);
  }
  return test.getView(now, true);
}
