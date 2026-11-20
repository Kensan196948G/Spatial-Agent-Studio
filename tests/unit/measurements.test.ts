import { describe, expect, it } from 'vitest';
import {
  crossSection,
  deviationStats,
  embankmentBalance,
  safetyScan,
  volumeInPolygon,
} from '../../src/shared/measurements';
import { DEFAULT_MODEL, modelForProgress } from '../../src/shared/terrain';

describe('deterministic measurement engine', () => {
  it('produces the same deviation statistics for the same input', () => {
    const a = deviationStats(DEFAULT_MODEL);
    const b = deviationStats(DEFAULT_MODEL);
    expect(a).toEqual(b);
    expect(a.n).toBe(2688);
    expect(a.gridM).toBe(0.5);
    expect(a.toleranceM).toBe(0.2);
    expect(a.passRate).toBeCloseTo(93.4151785714, 6);
    expect(a.mean).toBeCloseTo(-0.0232827827, 9);
    expect(a.std).toBeCloseTo(0.1117249197, 9);
    expect(a.min).toBeCloseTo(-0.5890124299, 9);
    expect(a.max).toBeCloseTo(0.3205388735, 9);
    expect(a.outUnder).toBe(142);
    expect(a.outOver).toBe(35);
    expect(a.verdict).toBe('fail');
    expect(a.worstUnder.deviation).toBeLessThan(0);
  });

  it('marks lower progress as under-filled', () => {
    const low = deviationStats(modelForProgress(0.55));
    expect(low.passRate).toBeLessThan(50);
    expect(low.min).toBeLessThan(-1);
    expect(low.outUnder).toBeGreaterThan(low.outOver);
  });

  it('integrates embankment volumes deterministically', () => {
    const balance = embankmentBalance(DEFAULT_MODEL);
    expect(balance.designVolumeM3).toBeCloseTo(1632.6667, 3);
    expect(balance.currentVolumeM3).toBeCloseTo(1617.0206, 3);
    expect(balance.underVolumeM3).toBeCloseTo(32.5594, 3);
    expect(balance.overVolumeM3).toBeCloseTo(16.9134, 3);
    expect(balance.netRequiredM3).toBeCloseTo(15.646, 3);
  });

  it('computes a cross section with worst deviation', () => {
    const section = crossSection(DEFAULT_MODEL, 0);
    expect(section.points).toHaveLength(121);
    expect(section.worstDeviation).toBeCloseTo(-0.1779022777, 9);
    expect(section.worstX).toBeCloseTo(-3.25, 9);
    const designPoints = section.points.filter((p) => p.design !== null);
    expect(designPoints.length).toBeGreaterThan(0);
  });

  it('detects the excavator clearance intrusion deterministically', () => {
    const scan = safetyScan(DEFAULT_MODEL);
    expect(scan.radiusM).toBe(7.5);
    expect(scan.minDistanceM).toBeCloseTo(5.0001272295, 9);
    expect(scan.minWorker).toBe('W-02');
    expect(scan.intruded).toBe(true);
    expect(scan.verdict).toBe('intruded');
    expect(scan.intrusionAtSeconds).toBeCloseTo(4.2, 6);
    expect(scan.workers).toHaveLength(3);
    expect(scan.workers.filter((w) => w.inside)).toHaveLength(1);
  });

  it('integrates cut/fill volumes inside a polygon', () => {
    const result = volumeInPolygon(
      [
        { x: -30, z: -5 },
        { x: -20, z: -5 },
        { x: -20, z: 10 },
        { x: -30, z: 10 },
      ],
      DEFAULT_MODEL,
    );
    expect(result.areaM2).toBe(150);
    expect(result.cells).toBe(600);
    expect(result.cutM3).toBeCloseTo(296.7275, 3);
    expect(result.fillM3).toBeCloseTo(0.0062, 4);
  });

  it('rejects a degenerate polygon volume', () => {
    const result = volumeInPolygon([{ x: 0, z: 0 }], DEFAULT_MODEL);
    expect(result).toEqual({ cutM3: 0, fillM3: 0, areaM2: 0, cells: 0 });
  });
});
