import type { PoseFrame } from '../../recorder/poseRecorderTypes';
import { CALIBRATION_MIN_SAMPLES, CALIBRATION_WINDOW_MS, KNEE_CALIBRATION_GRACE_MS } from '../features/poseFeatureAnalysis';
import type { PoseFeatureView } from '../features/poseFeatureTypes';
import { extractKneeMotionFeatures, type KneeMotionFeatures } from '../motion/kneeMotionFeatures';
import { robustStats } from '../motion/kneeMotionAnalyzer';
import { GuidedDetectorTest } from './guidedDetectorTest';
import { KneeKickDetector, usableKnees, type KneeKickBaseline } from './kneeKickDetector';
import { buildKneeKickBaselineV3 } from './kneeKickBaselineV3';
import { KneeKickDetectorV3, usableKneesV3, Y_KICK_V3_CONFIG, type KneeKickBaselineV3 } from './kneeKickDetectorV3';

import { summarizeNeutralDiagnostics, type NeutralKickDiagnosticSample, type NeutralKickDiagnostics, type KickDiagnosticDataset } from './kneeKickDiagnostics';

export type KickDetectorMode = 'Y_V3' | 'LEGACY_X';
// Empty X candidate columns for V3 diagnostics; Y run/gate evidence lives in v3.
const EMPTY_X_DIAGNOSTICS = new KneeKickDetector().getValuesForDiagnostics();

/** Collect only during the existing Neutral window; never learn from later movement. */
export class KneeKickAnalysis {
  private detectorV3 = new KneeKickDetectorV3();
  private legacyDetector = new KneeKickDetector();
  private legacyReferenceTest = new GuidedDetectorTest();
  private agreement = { eventAgreement: true, directionAgreement: null as boolean | null };
  private frameUsability = { primary: false, legacy: false };
  private test = new GuidedDetectorTest();
  private sealed = false;
  private baselineV3: KneeKickBaselineV3 | null = null;
  private samples: ({ timestamp: number; features: KneeMotionFeatures; leftOffset: number | null; rightOffset: number | null; leftDistance: number | null; rightDistance: number | null } & NeutralKickDiagnosticSample)[] = [];
  private neutralDiagnostics: NeutralKickDiagnostics | null = null;
  private counts = { left: 0, right: 0 };
  private lastFrameAt: number | null = null;
  private savedDiagnostics: KickDiagnosticDataset | null;

  constructor(savedDiagnostics: KickDiagnosticDataset | null = null, readonly detectorMode: KickDetectorMode = 'Y_V3') {
    this.savedDiagnostics = savedDiagnostics ? structuredClone(savedDiagnostics) : null;
  }

  private get primary() { return this.detectorMode === 'Y_V3' ? this.detectorV3 : this.legacyDetector; }

  processFrame(frame: PoseFrame, neutral: PoseFeatureView): void {
    if (neutral.collectionState === 'IDLE' || (this.sealed && neutral.collectionState !== 'FROZEN')) this.reset(frame.timestamp, 'RECALIBRATION');
    if (this.lastFrameAt !== null && frame.timestamp <= this.lastFrameAt) return;
    const inferenceGapMs = this.lastFrameAt === null ? null : frame.timestamp - this.lastFrameAt;
    this.lastFrameAt = frame.timestamp;
    const features = extractKneeMotionFeatures(frame.landmarks);
    if (!this.sealed && neutral.collectionState !== 'IDLE') {
      // Admit the frame that completed the baseline, but not one at/after an expired grace deadline.
      const withinWindow = neutral.collectionState !== 'FROZEN' || (neutral.hipReadyAt !== null && frame.timestamp < neutral.hipReadyAt + KNEE_CALIBRATION_GRACE_MS);
      if (withinWindow) this.collect(features, frame.timestamp);
      this.samples = this.samples.filter((sample) => sample.timestamp > frame.timestamp - CALIBRATION_WINDOW_MS);
      this.counts = { left: this.samples.filter((sample) => (this.detectorMode === 'Y_V3' ? usableKneesV3(sample.features).left : sample.leftOffset !== null)).length, right: this.samples.filter((sample) => (this.detectorMode === 'Y_V3' ? usableKneesV3(sample.features).right : sample.rightOffset !== null)).length };
      if (neutral.collectionState === 'FROZEN') this.freeze();
    }
    this.analyzeFrame(frame, features, neutral.smoothed.validNow, inferenceGapMs);
  }
  /** Explicit legacy-only reference route for old LANDMARK/VIDEO captures. Live defaults to V3. */
  static forReplay(baseline: KneeKickBaseline): KneeKickAnalysis {
    const analysis = new KneeKickAnalysis(null, 'LEGACY_X');
    analysis.sealed = true;
    analysis.legacyDetector.setBaseline({ ...baseline });
    return analysis;
  }
  processReplayFrame(frame: PoseFrame): void {
    if (this.lastFrameAt !== null && frame.timestamp <= this.lastFrameAt) return;
    const gap = this.lastFrameAt === null ? null : frame.timestamp - this.lastFrameAt;
    this.lastFrameAt = frame.timestamp;
    this.analyzeFrame(frame, extractKneeMotionFeatures(frame.landmarks), false, gap);
  }
  private analyzeFrame(frame: PoseFrame, features: KneeMotionFeatures, neutralSmoothedValidNow: boolean, inferenceGapMs: number | null): void {
    // Neutral FROZEN is enforced by baseline collection above, not by STEP 4A runtime validity.
    const legacyUsable = usableKnees(features);
    const usable = this.detectorMode === 'Y_V3' ? usableKneesV3(features) : legacyUsable;
    this.frameUsability = { primary: usable.left || usable.right, legacy: legacyUsable.left || legacyUsable.right };
    const poseFresh = usable.left || usable.right;
    const stateBefore = this.primary.getStateForDiagnostics();
    this.test.advance(frame.timestamp, stateBefore);
    this.legacyReferenceTest.advance(frame.timestamp, this.legacyDetector.getStateForDiagnostics());
    // One extraction, identical input/time, two independent state machines.
    const v3Event = this.detectorV3.processFrame(features, frame.timestamp);
    const legacyEvent = this.legacyDetector.processFrame(features, frame.timestamp);
    this.legacyReferenceTest.record(legacyEvent); // Diagnostic reference only; never the primary Guided result.
    const event = this.detectorMode === 'Y_V3' ? v3Event : legacyEvent;
    const legacy = this.legacyDetector.getValuesForDiagnostics(), v3 = this.detectorV3.getValuesForDiagnostics();
    this.agreement = { eventAgreement: Boolean(v3Event) === Boolean(legacyEvent),
      directionAgreement: v3Event && legacyEvent ? v3Event.direction === legacyEvent.direction : null };
    const dominantY = [v3.normalizedYLeft, v3.normalizedYRight].filter((v): v is number => v !== null).sort((a, b) => Math.abs(b) - Math.abs(a))[0] ?? null;
    const values = this.detectorMode === 'LEGACY_X' ? legacy : { ...EMPTY_X_DIAGNOSTICS,
      state: v3.state, normalizedLeft: v3.normalizedYLeft, normalizedRight: v3.normalizedYRight,
      dominantNormalizedDisplacement: dominantY, confirmationLatencyMs: v3Event?.confirmationLatencyMs ?? null };

    this.test.recordDiagnosticFrame({
      ...values,
      timestamp: frame.timestamp, poseFresh, usableLeft: usable.left, usableRight: usable.right,
      inferenceGapMs, neutralSmoothedValidNow,
      kickHipsUsable: usable.hips, kickLeftUsable: usable.left, kickRightUsable: usable.right, kickValidityReasons: legacyUsable.reasons,
      rawLeftHipVisibility: features.leftHipVisibility, rawRightHipVisibility: features.rightHipVisibility,
      rawLeftKneeVisibility: features.leftKneeVisibility, rawRightKneeVisibility: features.rightKneeVisibility,
      rawHipCenterX: features.hipCenterX, rawLeftKneeX: features.leftKneeX, rawRightKneeX: features.rightKneeX,
      rawLeftKneeCenterOffsetX: features.leftKneeCenterOffsetX, rawRightKneeCenterOffsetX: features.rightKneeCenterOffsetX,
      rawLeftKneeHipDistance: features.leftKneeHipDistance, rawRightKneeHipDistance: features.rightKneeHipDistance,
      stateBefore, stateAfter: values.state,
      hipCenterX: features.hipCenterX, hipWidth: features.hipWidth,
      leftKneeVisibility: features.leftKneeVisibility, rightKneeVisibility: features.rightKneeVisibility,
      normalizedLeft: values.normalizedLeft, normalizedRight: values.normalizedRight,
      dominantNormalizedDisplacement: values.dominantNormalizedDisplacement,
      normalizedLeftVelocity: values.normalizedLeftVelocity, normalizedRightVelocity: values.normalizedRightVelocity,
      event, detectorMode: this.detectorMode,
      v3: { ...v3, event: v3Event },
      legacyShadow: { ...legacy, event: legacyEvent, counts: this.legacyDetector.getReplaySnapshot().counts, ...this.agreement },
    });
    this.test.record(event);
  }
  private collect(features: KneeMotionFeatures, timestamp: number): void {
    const usable = usableKnees(features);
    this.samples.push({ timestamp, features: { ...features }, leftOffset: usable.left ? features.leftKneeCenterOffsetX : null, rightOffset: usable.right ? features.rightKneeCenterOffsetX : null,
      leftDistance: usable.left ? features.leftKneeHipDistance : null, rightDistance: usable.right ? features.rightKneeHipDistance : null,
      hipCenterX: features.hipCenterX, leftKneeVisibility: features.leftKneeVisibility, rightKneeVisibility: features.rightKneeVisibility });
  }
  private freeze(): void {
    this.sealed = true;
    // Same Neutral timing/visibility window as X; never update this after FROZEN.
    this.baselineV3 = buildKneeKickBaselineV3(this.samples.map((s) => s.features));
    this.detectorV3.setBaseline(this.baselineV3);
    // Diagnostic-only statistics over the same bounded Neutral window; never used by setBaseline().
    this.neutralDiagnostics = summarizeNeutralDiagnostics(this.samples);
    if (this.samples.filter((s) => s.leftOffset !== null).length >= CALIBRATION_MIN_SAMPLES && this.samples.filter((s) => s.rightOffset !== null).length >= CALIBRATION_MIN_SAMPLES) {
      const median = (key: 'leftOffset' | 'rightOffset' | 'leftDistance' | 'rightDistance') => robustStats(this.samples.map((sample) => sample[key])).median!;
      const leftDistanceMedian = median('leftDistance'), rightDistanceMedian = median('rightDistance');
      this.legacyDetector.setBaseline({ leftMedian: median('leftOffset'), rightMedian: median('rightOffset'), leftDistanceMedian, rightDistanceMedian,
        bodyScale: (leftDistanceMedian + rightDistanceMedian) / 2 });
    }
    this.samples = [];
  }
  getView(now: number) {
    const legacyShadow = this.legacyDetector.getView(now), v3 = this.detectorV3.getView(now);
    const detector = this.detectorMode === 'Y_V3' ? v3 : legacyShadow;
    this.legacyReferenceTest.getView(now, legacyShadow.state);
    return { detector, detectorMode: this.detectorMode, v3: v3.diagnostics, legacyShadow: { ...legacyShadow, ...this.agreement }, baselineV3: this.baselineV3 ? { ...this.baselineV3 } : null, baselineCounts: { ...this.counts }, baselineSealed: this.sealed,
      test: this.test.getView(now, detector.state), diagnosticsDownload: this.getDownloadInfo() };
  }
  getReplaySnapshot() {
    return { detectorMode: this.detectorMode, detector: this.primary.getReplaySnapshot(),
      legacyShadow: { detector: this.legacyDetector.getReplaySnapshot(), guided: this.legacyReferenceTest.getReplaySnapshot() },
      frameUsability: { ...this.frameUsability }, baselineV3: this.baselineV3 ? { ...this.baselineV3 } : null, guided: this.test.getReplaySnapshot() };
  }
  getTestStages() { return this.test.getStages(); }
  getDiagnosticSummary() { return this.test.getDiagnosticSummary(); }
  private getDownloadInfo() {
    const current = this.test.getExportInfo();
    return current ? { ...current, source: 'CURRENT' as const }
      : this.savedDiagnostics ? { status: this.savedDiagnostics.status, frameCount: this.savedDiagnostics.frames.length, source: 'PREVIOUS' as const } : null;
  }
  getSavedDiagnostics(): KickDiagnosticDataset | null { return this.savedDiagnostics ? structuredClone(this.savedDiagnostics) : null; }
  exportDiagnosticsJson(now?: number): string {
    if (now !== undefined) this.getView(now);
    const dataset = this.test.snapshotDiagnostics() ?? this.savedDiagnostics;
    if (!dataset) throw new Error('Inference frame을 한 개 이상 기록한 뒤 진단 JSON을 다운로드할 수 있습니다.');
    return JSON.stringify(dataset, null, 2);
  }
  private preserveDiagnostics(now: number, reason: string): void {
    this.test.interrupt(now, reason, this.primary.getStateForDiagnostics());
    this.legacyReferenceTest.interrupt(now, reason, this.legacyDetector.getStateForDiagnostics());
    const dataset = this.test.snapshotDiagnostics();
    if (dataset) this.savedDiagnostics = dataset;
  }
  startTest(now: number, onClock?: () => void): boolean {
    const view = this.getView(now).detector;
    const blocked = !this.sealed || !view.ready || this.test.getView(now, view.state).status === 'ACTIVE';
    // Observe the existing guard clock before a new trial clears the previous result.
    onClock?.();
    if (blocked) return false;
    this.preserveDiagnostics(now, 'NEW_TRIAL');
    const started = this.test.start(now, view.ready);
    if (started) {
      this.detectorV3.restartTrial(); this.legacyDetector.restartTrial();
      this.legacyReferenceTest.start(now, this.legacyDetector.getReplaySnapshot().baseline !== null);
      this.agreement = { eventAgreement: true, directionAgreement: null };
      this.frameUsability = { primary: false, legacy: false };
      this.lastFrameAt = null;
      this.test.beginDiagnostics({
        createdAt: new Date().toISOString(), startedAt: now,
        detectorMode: this.detectorMode, detectorConfigV3: Y_KICK_V3_CONFIG, baselineV3: this.baselineV3,
        baseline: { detector: this.legacyDetector.getReplaySnapshot().baseline, diagnostics: this.neutralDiagnostics },
        testStart: { detectorState: this.primary.getStateForDiagnostics(), ready: view.ready, valid: false },
      });
    }
    return started;
  }
  resetTest(now = this.lastFrameAt ?? 0): void {
    this.preserveDiagnostics(now, 'RESET_TEST');
    this.test.reset(); this.legacyReferenceTest.reset(); this.detectorV3.restartTrial(); this.legacyDetector.restartTrial(); this.lastFrameAt = null;
    this.agreement = { eventAgreement: true, directionAgreement: null }; this.frameUsability = { primary: false, legacy: false };
  }
  reset(now = this.lastFrameAt ?? 0, reason = 'RESET'): void {
    this.preserveDiagnostics(now, reason);
    this.detectorV3.reset(); this.legacyDetector.reset(); this.test.reset(); this.legacyReferenceTest.reset();
    this.agreement = { eventAgreement: true, directionAgreement: null }; this.frameUsability = { primary: false, legacy: false }; this.samples = []; this.sealed = false; this.counts = { left: 0, right: 0 }; this.lastFrameAt = null;
    this.neutralDiagnostics = null;
    this.baselineV3 = null;
  }
}
