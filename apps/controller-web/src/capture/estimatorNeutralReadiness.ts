import type { PoseFrame } from '../recorder/poseRecorderTypes';
import { ESTIMATOR_VALIDATION_PROTOCOL_V1 as P, REQUIRED_JOINTS, type EstimatorNeutralReference, type JointCounts } from './estimatorValidationProtocol';
const counts = (): JointCounts => Object.fromEntries(REQUIRED_JOINTS.map((j) => [j.name, 0])) as JointCounts;
export function frameEligibility(frame: Pick<PoseFrame, 'landmarks' | 'worldLandmarks'>) {
  return REQUIRED_JOINTS.map((j) => {
    const image = frame.landmarks[j.index], world = frame.worldLandmarks[j.index];
    const visibility = image?.visibility;
    const usable = !!image && [image.x, image.y].every(Number.isFinite) && typeof visibility === 'number' && Number.isFinite(visibility) && visibility >= j.threshold &&
      !!world && [world.x, world.y, world.z].every(Number.isFinite) &&
      (world.visibility === undefined || typeof world.visibility === 'number' && Number.isFinite(world.visibility) && world.visibility >= j.threshold);
    return { ...j, usable, visibility: visibility ?? null, worldVisibility: world?.visibility ?? null };
  });
}
/** Passive capture quality only; never changes the production calibration or detector. */
export class EstimatorNeutralReadiness {
  private start: number | null = null;
  private samples: { tMs: number; usable: boolean[] }[] = [];
  private frozen = false;
  private current = frameEligibility({ landmarks: [], worldLandmarks: [] });
  private reference: EstimatorNeutralReference | null = null;
  private consumed = false;
  reset(tMs: number) { this.start = tMs; this.samples = []; this.reference = null; this.frozen = false; this.consumed = false; this.current = frameEligibility({ landmarks: [], worldLandmarks: [] }); }
  process(frame: PoseFrame, tMs: number, productionFrozen: boolean) {
    this.current = frameEligibility(frame); this.frozen = productionFrozen;
    if (this.start === null || tMs < this.start || tMs <= (this.samples.at(-1)?.tMs ?? -Infinity)) return;
    this.samples.push({ tMs, usable: this.current.map((j) => j.usable) }); this.getView(tMs);
  }
  getView(now: number) {
    this.samples = this.samples.filter((s) => s.tMs >= now - P.neutralReferenceWindowMs && s.tMs <= now);
    const perJoint = counts(); let all = 0;
    for (const s of this.samples) { if (s.usable.every(Boolean)) all++; REQUIRED_JOINTS.forEach((j, i) => { if (s.usable[i]) perJoint[j.name]++; }); }
    if (!this.reference && this.start !== null && this.frozen && now - this.start >= P.neutralReferenceWindowMs &&
        all >= P.neutralReferenceMinUsableFrames && Object.values(perJoint).every((n) => n >= P.neutralReferenceMinUsableFrames)) {
      this.reference = { protocolId: P.id, calibrationStartMs: this.start, startMs: now - 3000, endMs: now, durationMs: 3000, readyAtMs: now,
        analysisReadyFrameCount: all, perJointUsableFrames: { ...perJoint }, poseFrameCount: this.samples.length, thresholds: { ...P.visibility } };
    }
    return { status: this.reference ? 'READY' as const : this.start === null ? 'NOT_STARTED' as const : 'COLLECTING' as const,
      analysisReadyFrameCount: all, perJointUsableFrames: perJoint, poseFrameCount: this.samples.length, current: this.current.map((j) => ({ ...j })),
      allReadyNow: this.current.every((j) => j.usable), consumed: this.consumed, reference: this.reference ? structuredClone(this.reference) : null };
  }
  canStart(now: number) { return !!this.getView(now).reference && !this.consumed; }
  takeReference(now: number) { const ref = this.canStart(now) ? this.getView(now).reference : null; this.consumed = true; return ref; }
}
