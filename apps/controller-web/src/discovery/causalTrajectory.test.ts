// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { trajectorySummary, observedOnset, onsetRelation } from './causalTrajectory';
const p = (timestamp: number, value: number | null) => ({ timestamp, value });
describe('causal trajectory statistics', () => {
  it('measures coherent motion using observed times and trapezoidal seconds', () => {
    const s = trajectorySummary([p(0, 0), p(100, 1), p(200, 2)], 0, 200);
    expect(s).toMatchObject({ min: 0, max: 2, range: 2, absPeak: 2, signedArea: .2, absArea: .2, directionalCoherence: 1, netChange: 2, pathLength: 2, efficiency: 1, connectedMs: 200 });
    expect(s.RMS).toBeCloseTo(Math.sqrt(5 / 3));
  });
  it('counts sign-crossing absolute area and oscillation without cancellation', () => {
    const s = trajectorySummary([p(0, 1), p(100, -1), p(200, 1)], 0, 200);
    expect(s.signedArea).toBe(0); expect(s.absArea).toBeCloseTo(.1); expect(s.directionalCoherence).toBe(0); expect(s.efficiency).toBe(0);
  });
  it('does not connect path or report usable coherence across dt >= 400ms', () => {
    const s = trajectorySummary([p(0, 0), p(400, 10), p(450, 11)], 0, 450);
    expect(s.pathLength).toBe(1); expect(s.connectedMs).toBe(50); expect(s.continuous).toBe(false); expect(s.netChange).toBeNull(); expect(s.efficiency).toBeNull();
  });
  it('does not bridge missing or replace it with zero', () => {
    const s = trajectorySummary([p(0, 1), p(50, null), p(100, 2)], 0, 100);
    expect(s).toMatchObject({ usable: 2, pathLength: null, signedArea: null, netChange: null, directionalCoherence: null });
    expect(trajectorySummary([p(0, null)], 0, 100).startValue).toBeNull();
  });
  it('past windows never see future samples', () => {
    const rows = [p(0, 1), p(100, 2), p(101, 99)];
    expect(trajectorySummary(rows, 0, 100)).toEqual(trajectorySummary(rows.slice(0, 2), 0, 100));
  });
  it.each([100, 150, 200])('+%ims windows use only frames available by the decision', (end) => {
    const rows = [p(0, .4), p(end - 1, .5), p(end + 1, 99)];
    expect(trajectorySummary(rows, 0, end, end).max).toBe(.5);
    expect(trajectorySummary(rows, 0, end + 100, end).max).toBe(.5);
  });
  it('zero-area and zero-path produce null ratios', () => {
    const s = trajectorySummary([p(0, 0), p(100, 0)], 0, 100);
    expect(s.directionalCoherence).toBeNull(); expect(s.efficiency).toBeNull();
  });
  it('reports actual observed onset separately from left-censored high values', () => {
    expect(observedOnset([p(0, .5), p(50, .6)], 100, .2)).toEqual({ at: null, leftCensored: true });
    const r = onsetRelation([p(0, .1), p(50, -.3)], [p(0, .1), p(100, .4)], 100, .2);
    expect(r).toMatchObject({ candidateOnsetAt: 50, opponentOnsetAt: 100, onsetLagMs: 50 });
    expect(observedOnset([p(0, .1), p(50, null), p(100, .3)], 100, .2).at).toBeNull();
  });
});
