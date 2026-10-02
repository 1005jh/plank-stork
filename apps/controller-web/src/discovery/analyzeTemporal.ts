import { orderedFrames } from '../replay/landmarkReplay';
import type { ReplaySession } from '../replay/replayTypes';
import { buildNeutralReference, discoveryFeatures, LIMBS, type Limb } from './discoveryFeatures';
import { discoveryStages, stageForTime, type DiscoveryLabel, type DiscoveryStage } from './discoveryStages';
import type { DiscoveryInput } from './analyzeDiscovery';
import { directionWindows, summarizeTemporalSide, TEMPORAL_SETTINGS, trimSeries,
  type DirectionWindow, type EvidencePair, type TemporalRole, type TemporalSideSummary, type WindowMode } from './temporalEvidence';

export interface TemporalStage {
  stageIndex: number; expected: DiscoveryLabel; window: WindowMode; startMs: number; endMs: number;
  observable: boolean; coverage: number | null; pairedUsableFrameCount: number;
  sides: Record<Limb, TemporalSideSummary>; directionEvidence: DirectionWindow[];
}
export interface TemporalDataset {
  input: DiscoveryInput; role: TemporalRole; stageSource: string; warnings: string[]; stages: TemporalStage[];
}
export interface TemporalRule {
  window: WindowMode; threshold: number; dwellMs: number; confirmation2D: number | null;
  neutralFalse: number | null; twistLeftFalse: number | null; twistRightFalse: number | null;
  kneeLeftDetected: boolean | null; kneeRightDetected: boolean | null;
  observable: boolean; assessment: 'VIABLE' | 'REJECTED' | 'INSUFFICIENT_EVIDENCE';
}
export interface TemporalDiscoveryReport {
  version: 1; createdAt: string; feature: 'deltaDyNorm'; inputs: (DiscoveryInput & { role: TemporalRole })[];
  settings: typeof TEMPORAL_SETTINGS; perDataset: TemporalDataset[];
  rulesClean: TemporalRule[]; viableRulesClean: TemporalRule[];
  warnings: string[];
}

/** Kept outside React state: scalar-only timeline shared by temporal and shadow analysis. */
export interface PreparedTemporalDataset {
  input: DiscoveryInput; stageSource: string; warnings: string[]; stages: DiscoveryStage[]; frames: EvidencePair[];
}

export function prepareTemporalDatasets(session: ReplaySession, filename: string): PreparedTemporalDataset[] {
  if (!session.liveResult.trials.length) throw new Error('Guided trial이 없는 Replay Capture입니다.');
  const ordered = orderedFrames(session.poseFrames);
  return session.liveResult.trials.map((trial) => {
    const { stages, source, warnings } = discoveryStages(session, trial);
    const firstNeutral = stages.find((s) => s.expected === 'NEUTRAL');
    const neutral = buildNeutralReference(firstNeutral ? ordered.filter((f) => f.tMs >= firstNeutral.startMs && f.tMs < firstNeutral.endMs) : []);
    const frames: EvidencePair[] = [];
    for (const frame of ordered) {
      const stage = stageForTime(stages, frame.tMs);
      if (!stage) continue;
      const values = discoveryFeatures(frame, neutral, trial.baseline);
      const side = (side: Limb) => {
        const deltaDyNorm = values.deltaDyNorm[side] ?? null;
        return { timestamp: frame.tMs, deltaDyNorm, absY: deltaDyNorm === null ? null : Math.abs(deltaDyNorm),
          displacement2D: values.hipCenterRelative2DDisplacement[side] ?? null,
          normalizedX: values.normalizedXDisplacement[side] ?? null, usable: deltaDyNorm !== null,
          visibility: { leftHip: frame.landmarks[23]?.visibility ?? null, rightHip: frame.landmarks[24]?.visibility ?? null,
            knee: frame.landmarks[side === 'LEFT' ? 25 : 26]?.visibility ?? null } };
      };
      frames.push({ timestamp: frame.tMs, LEFT: side('LEFT'), RIGHT: side('RIGHT') });
    }
    return { input: { filename, captureId: session.captureId, trialId: trial.id }, stageSource: source, warnings, stages, frames };
  });
}

export function summarizeTemporalDatasets(prepared: readonly PreparedTemporalDataset[]): TemporalDataset[] {
  return prepared.map(({ input, stageSource, warnings, stages, frames: timeline }) => {
    const summaries = stages.flatMap((stage) => (['FULL', 'TRIMMED'] as const).map((window): TemporalStage => {
      const trim = window === 'FULL' ? 0 : TEMPORAL_SETTINGS.trimMs;
      const startMs = Math.min(stage.endMs, stage.startMs + trim), endMs = Math.max(startMs, stage.endMs - trim);
      const frames = trimSeries(timeline, startMs, endMs);
      const sides = Object.fromEntries(LIMBS.map((side) => [side, summarizeTemporalSide(frames.map((f) => f[side]), startMs, endMs)])) as Record<Limb, TemporalSideSummary>;
      return { stageIndex: stage.stageIndex, expected: stage.expected, window, startMs, endMs, sides,
        observable: stage.expected === 'KNEE_LEFT' ? sides.LEFT.observableStage : stage.expected === 'KNEE_RIGHT' ? sides.RIGHT.observableStage
          : sides.LEFT.observableStage && sides.RIGHT.observableStage,
        coverage: frames.length ? (sides.LEFT.usableFrameCount + sides.RIGHT.usableFrameCount) / (2 * frames.length) : null,
        pairedUsableFrameCount: frames.filter((f) => f.LEFT.usable && f.RIGHT.usable).length,
        directionEvidence: directionWindows(frames, stage.expected) };
    }));
    return { input, role: 'UNASSIGNED', stageSource, warnings, stages: summaries };
  });
}

export function analyzeTemporal(session: ReplaySession, filename: string): TemporalDataset[] {
  return summarizeTemporalDatasets(prepareTemporalDatasets(session, filename));
}

function cleanRules(datasets: readonly TemporalDataset[]): TemporalRule[] {
  const clean = datasets.filter((d) => d.role === 'CLEAN');
  return (['FULL', 'TRIMMED'] as const).flatMap((window) => TEMPORAL_SETTINGS.thresholds.flatMap((threshold) => TEMPORAL_SETTINGS.dwellMs.flatMap((dwellMs) =>
    [null, ...TEMPORAL_SETTINGS.confirmation2D].map((confirmation2D): TemporalRule => {
      const result = (label: DiscoveryLabel) => {
        let unknown = !clean.length, count = 0, observations = 0;
        for (const dataset of clean) {
          const stages = dataset.stages.filter((s) => s.expected === label && s.window === window);
          if (!stages.length) unknown = true;
          for (const stage of stages) {
            observations++;
            const sideNames: readonly Limb[] = label === 'KNEE_LEFT' ? ['LEFT'] : label === 'KNEE_RIGHT' ? ['RIGHT'] : LIMBS;
            const sides = sideNames.map((side) => stage.sides[side]);
            const triggers = sides.map((side) => side.thresholds.find((t) => t.threshold === threshold)!.dwellResults
              .find((d) => d.dwellMs === dwellMs && d.confirmation2D === confirmation2D)!);
            // Missing is not a failed kick. Even an observed trigger cannot certify coverage of the whole stage.
            if (sides.some((side) => !side.observableStage)) unknown = true;
            if (triggers.some((trigger) => trigger.observedTrigger)) count++;
          }
        }
        return { value: unknown ? null : count, observations };
      };
      const neutral = result('NEUTRAL'), tl = result('TWIST_LEFT'), tr = result('TWIST_RIGHT'), kl = result('KNEE_LEFT'), kr = result('KNEE_RIGHT');
      const kneeLeftDetected = kl.value === null ? null : kl.observations > 0 && kl.value === kl.observations;
      const kneeRightDetected = kr.value === null ? null : kr.observations > 0 && kr.value === kr.observations;
      const observable = [neutral.value, tl.value, tr.value, kneeLeftDetected, kneeRightDetected].every((v) => v !== null);
      const viable = observable && neutral.value === 0 && tl.value === 0 && tr.value === 0 && kneeLeftDetected && kneeRightDetected;
      return { window, threshold, dwellMs, confirmation2D, neutralFalse: neutral.value, twistLeftFalse: tl.value, twistRightFalse: tr.value,
        kneeLeftDetected, kneeRightDetected, observable, assessment: !observable ? 'INSUFFICIENT_EVIDENCE' : viable ? 'VIABLE' : 'REJECTED' };
    }))));
}
export function createTemporalReport(perDataset: TemporalDataset[], createdAt = new Date().toISOString()): TemporalDiscoveryReport {
  const rulesClean = cleanRules(perDataset);
  return { version: 1, createdAt, feature: 'deltaDyNorm', inputs: perDataset.map((d) => ({ ...d.input, role: d.role })),
    settings: TEMPORAL_SETTINGS, perDataset, rulesClean, viableRulesClean: rulesClean.filter((r) => r.assessment === 'VIABLE'),
    warnings: perDataset.some((d) => d.role === 'CLEAN') ? [] : ['No CLEAN dataset selected'] };
}
