import type { PoseFrame } from '../../recorder/poseRecorderTypes';
import { CALIBRATION_MIN_SAMPLES, CALIBRATION_WINDOW_MS, KNEE_CALIBRATION_GRACE_MS } from '../features/poseFeatureAnalysis';
import type { PoseFeatureView } from '../features/poseFeatureTypes';
import { extractKneeMotionFeatures, type KneeMotionFeatures } from '../motion/kneeMotionFeatures';
import { robustStats } from '../motion/kneeMotionAnalyzer';
import { GuidedDetectorTest } from './guidedDetectorTest';
import { KneeKickDetector, usableKnees } from './kneeKickDetector';
import { summarizeNeutralDiagnostics, type NeutralKickDiagnosticSample, type NeutralKickDiagnostics } from './kneeKickDiagnostics';

/** Collect only during the existing Neutral window; never learn from later movement. */
export class KneeKickAnalysis {
  private detector = new KneeKickDetector();
  private test = new GuidedDetectorTest();
  private sealed = false;
  private samples: ({ timestamp: number; leftOffset: number | null; rightOffset: number | null; leftDistance: number | null; rightDistance: number | null } & NeutralKickDiagnosticSample)[] = [];
  private neutralDiagnostics: NeutralKickDiagnostics | null = null;
  private counts = { left: 0, right: 0 };
  private lastFrameAt: number | null = null;

  processFrame(frame: PoseFrame, neutral: PoseFeatureView): void {
    if (neutral.collectionState === 'IDLE' || (this.sealed && neutral.collectionState !== 'FROZEN')) this.reset();
    if (this.lastFrameAt !== null && frame.timestamp <= this.lastFrameAt) return;
    this.lastFrameAt = frame.timestamp;
    const features = extractKneeMotionFeatures(frame.landmarks);
    if (!this.sealed && neutral.collectionState !== 'IDLE') {
      // Admit the frame that completed the baseline, but not one at/after an expired grace deadline.
      const withinWindow = neutral.collectionState !== 'FROZEN' || (neutral.hipReadyAt !== null && frame.timestamp < neutral.hipReadyAt + KNEE_CALIBRATION_GRACE_MS);
      if (withinWindow) this.collect(features, frame.timestamp);
      this.samples = this.samples.filter((sample) => sample.timestamp > frame.timestamp - CALIBRATION_WINDOW_MS);
      this.counts = { left: this.samples.filter((sample) => sample.leftOffset !== null).length, right: this.samples.filter((sample) => sample.rightOffset !== null).length };
      if (neutral.collectionState === 'FROZEN') this.freeze();
    }
    const poseFresh = neutral.collectionState === 'FROZEN' && neutral.smoothed.validNow;
    const usable = usableKnees(features, poseFresh);
    const stateBefore = this.detector.getStateForDiagnostics();
    const event = this.detector.processFrame(features, frame.timestamp, poseFresh);
    const values = this.detector.getValuesForDiagnostics();
    this.test.recordDiagnosticFrame({
      timestamp: frame.timestamp, poseFresh, usableLeft: usable.left, usableRight: usable.right,
      stateBefore, stateAfter: values.state,
      hipCenterX: features.hipCenterX, hipWidth: features.hipWidth,
      leftKneeVisibility: features.leftKneeVisibility, rightKneeVisibility: features.rightKneeVisibility,
      normalizedLeft: values.normalizedLeft, normalizedRight: values.normalizedRight,
      dominantNormalizedDisplacement: values.dominantNormalizedDisplacement,
      normalizedLeftVelocity: values.normalizedLeftVelocity, normalizedRightVelocity: values.normalizedRightVelocity,
      event,
    });
    this.test.record(event);
  }
  private collect(features: KneeMotionFeatures, timestamp: number): void {
    const usable = usableKnees(features, true);
    this.samples.push({ timestamp, leftOffset: usable.left ? features.leftKneeCenterOffsetX : null, rightOffset: usable.right ? features.rightKneeCenterOffsetX : null,
      leftDistance: usable.left ? features.leftKneeHipDistance : null, rightDistance: usable.right ? features.rightKneeHipDistance : null,
      hipCenterX: features.hipCenterX, leftKneeVisibility: features.leftKneeVisibility, rightKneeVisibility: features.rightKneeVisibility });
  }
  private freeze(): void {
    this.sealed = true;
    // Diagnostic-only statistics over the same bounded Neutral window; never used by setBaseline().
    this.neutralDiagnostics = summarizeNeutralDiagnostics(this.samples);
    if (this.counts.left >= CALIBRATION_MIN_SAMPLES && this.counts.right >= CALIBRATION_MIN_SAMPLES) {
      const median = (key: 'leftOffset' | 'rightOffset' | 'leftDistance' | 'rightDistance') => robustStats(this.samples.map((sample) => sample[key])).median!;
      const leftDistanceMedian = median('leftDistance'), rightDistanceMedian = median('rightDistance');
      this.detector.setBaseline({ leftMedian: median('leftOffset'), rightMedian: median('rightOffset'), leftDistanceMedian, rightDistanceMedian,
        bodyScale: (leftDistanceMedian + rightDistanceMedian) / 2 });
    }
    this.samples = [];
  }
  getView(now: number) {
    return { detector: this.detector.getView(now), baselineCounts: { ...this.counts }, baselineSealed: this.sealed, test: this.test.getView(now) };
  }
  getTestStages() { return this.test.getStages(); }
  getDiagnosticSummary() { return this.test.getDiagnosticSummary(); }
  exportDiagnosticsJson(): string { return this.test.exportDiagnosticsJson(); }
  startTest(now: number): boolean {
    const view = this.detector.getView(now);
    const started = this.test.start(now, view.ready && view.validNow);
    if (started) this.test.beginDiagnostics({
      createdAt: new Date().toISOString(), startedAt: now,
      baseline: { detector: view.baseline, diagnostics: this.neutralDiagnostics },
      testStart: { detectorState: view.state, ready: view.ready, valid: view.validNow },
    });
    return started;
  }
  resetTest(): void { this.test.reset(); }
  reset(): void {
    this.detector.reset(); this.test.reset(); this.samples = []; this.sealed = false; this.counts = { left: 0, right: 0 }; this.lastFrameAt = null;
    this.neutralDiagnostics = null;
  }
}
