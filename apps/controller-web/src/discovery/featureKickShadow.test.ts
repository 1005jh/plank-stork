// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FeatureKickShadow, directFeatureConfigs, temporalFeatureConfigs, type FeatureConfig } from './featureKickShadow';
const config: FeatureConfig = { featureFamily: 'SAME_HIP_Y', threshold: .4, dwell: 50, temporalRule: null };
const step = (d: FeatureKickShadow, t: number, left: number | null, right: number | null = 0) => d.processFrame(t, { LEFT: left, RIGHT: right });
describe('independent FeatureKickShadow', () => {
  it('keeps the exact coarse grid and a separate bounded temporal extension', () => {
    expect(directFeatureConfigs()).toHaveLength(256); expect(temporalFeatureConfigs()).toHaveLength(180);
    expect(temporalFeatureConfigs().every((c) => !!c.temporalRule && [.3, .5].includes(c.threshold))).toBe(true);
  });
  it('uses observed dwell, landmark identity, and a fresh post-event clear clock', () => {
    const d = new FeatureKickShadow(config); expect(step(d, 0, .5)).toBeNull(); expect(step(d, 49, .5)).toBeNull();
    expect(step(d, 50, .5)).toMatchObject({ side: 'LEFT', candidateStart: 0, timestamp: 50, latencyMs: 50, crossGap: false });
    step(d, 80, 0); step(d, 179, 0); expect(d.getView().state).toBe('WAIT_CLEAR'); step(d, 180, 0); expect(d.getView().state).toBe('ARMED');
    step(d, 200, 0, .5); expect(step(d, 250, 0, .5)?.side).toBe('RIGHT');
  });
  it('FIRST_DWELL emits the first ready side without waiting for a stronger later side', () => {
    const d = new FeatureKickShadow(config); step(d, 0, .5); step(d, 30, .5, .9); expect(step(d, 50, .5, .9)?.side).toBe('LEFT');
  });
  it('symmetric residual magnitudes wait for both sides to clear instead of inventing direction', () => {
    const d = new FeatureKickShadow(config); step(d, 0, .5, -.5); expect(step(d, 50, .5, -.5)).toBeNull(); expect(d.getView().ambiguityCount).toBe(1);
    step(d, 80, 0, .5); step(d, 180, 0, .5); expect(d.getView().state).toBe('WAIT_CLEAR');
    step(d, 200, 0, 0); step(d, 300, 0, 0); expect(d.getView().state).toBe('ARMED');
  });
  it('does not join dwell across a hard gap; reacquisition needs clear', () => {
    const d = new FeatureKickShadow(config); step(d, 0, .5); expect(step(d, 400, .5)).toBeNull(); expect(step(d, 450, .5)).toBeNull();
    step(d, 500, 0); step(d, 600, 0); step(d, 650, .5); expect(step(d, 700, .5)).toMatchObject({ crossGap: false, postReacquisition: true, candidateStart: 650 });
  });
  it('missing side cancels its run without blocking the other side', () => {
    const d = new FeatureKickShadow(config); step(d, 0, .5); step(d, 25, null, .5); expect(step(d, 75, null, .5)?.side).toBe('RIGHT');
    expect(d.getView().sides.LEFT.missing).toBe(true);
  });
  it('visibility recovery cannot continue the old candidate', () => {
    const d = new FeatureKickShadow(config); step(d, 0, .5); step(d, 20, null); expect(step(d, 50, .5)).toBeNull(); expect(step(d, 100, .5)).toBeNull();
    expect(d.getView().sides.LEFT.gate).toBe(true);
  });
  it.each([100, 150, 200] as const)('waits %ims, excludes the later observation from the decision metric, reports actual latency', (waitMs) => {
    const d = new FeatureKickShadow({ ...config, dwell: waitMs, temporalRule: { waitMs, metric: 'directionalCoherence', minimum: .8 } });
    step(d, 0, .5); expect(step(d, waitMs - 1, .6)).toBeNull();
    // The first post-deadline observation is current valid evidence but cannot enter the closed trajectory window.
    const e = step(d, waitMs + 1, -10); expect(e?.latencyMs).toBe(waitMs + 1); expect(e?.temporalSummary?.max).toBe(.6); expect(e?.temporalSummary?.min).toBe(.5);
  });
  it('compares efficiency separately and a rejected attempt waits for clear', () => {
    const d = new FeatureKickShadow({ ...config, temporalRule: { waitMs: 100, metric: 'efficiency', minimum: .4 } });
    step(d, 0, .5); step(d, 50, .7); expect(step(d, 100, .5)).toBeNull(); expect(d.getView().sides.LEFT.blocked).toBe(true);
    expect(step(d, 200, 1)).toBeNull(); step(d, 250, 0); step(d, 350, 0); step(d, 400, .5); expect(step(d, 500, .6)?.side).toBe('LEFT');
  });
  it('rejects non-monotonic timestamps', () => {
    const d = new FeatureKickShadow(config); step(d, 100, 0); expect(() => step(d, 100, 0)).toThrow('strictly increasing');
  });
});
