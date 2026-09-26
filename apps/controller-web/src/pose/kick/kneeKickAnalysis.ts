import type { PoseFrame } from '../../recorder/poseRecorderTypes';
import { CALIBRATION_MIN_SAMPLES, CALIBRATION_WINDOW_MS, KNEE_CALIBRATION_GRACE_MS } from '../features/poseFeatureAnalysis';
import type { PoseFeatureView } from '../features/poseFeatureTypes';
import { extractKneeMotionFeatures, type KneeMotionFeatures } from '../motion/kneeMotionFeatures';
import { robustStats } from '../motion/kneeMotionAnalyzer';
import { GuidedDetectorTest } from './guidedDetectorTest';
import { KneeKickDetector, usableKnees } from './kneeKickDetector';

/** Collect only during the existing Neutral window; never learn from later movement. */
export class KneeKickAnalysis {
  private detector = new KneeKickDetector();
  private test = new GuidedDetectorTest();
  private sealed = false;
  private samples: { timestamp: number; leftOffset: number | null; rightOffset: number | null; leftDistance: number | null; rightDistance: number | null }[] = [];
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
    const event = this.detector.processFrame(features, frame.timestamp, neutral.collectionState === 'FROZEN' && neutral.smoothed.validNow);
    this.test.record(event);
  }
  private collect(features: KneeMotionFeatures, timestamp: number): void {
    const usable = usableKnees(features, true);
    this.samples.push({ timestamp, leftOffset: usable.left ? features.leftKneeCenterOffsetX : null, rightOffset: usable.right ? features.rightKneeCenterOffsetX : null,
      leftDistance: usable.left ? features.leftKneeHipDistance : null, rightDistance: usable.right ? features.rightKneeHipDistance : null });
  }
  private freeze(): void {
    this.sealed = true;
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
  startTest(now: number): boolean {
    const view = this.detector.getView(now);
    return this.test.start(now, view.ready && view.validNow);
  }
  resetTest(): void { this.test.reset(); }
  reset(): void {
    this.detector.reset(); this.test.reset(); this.samples = []; this.sealed = false; this.counts = { left: 0, right: 0 }; this.lastFrameAt = null;
  }
}
