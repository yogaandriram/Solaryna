import { describe, expect, it } from 'vitest';
import { columnScale, formatSolTick, lamportsToSol } from './chart';

describe('columnScale', () => {
  it('spans both signs with clean ticks, top first', () => {
    const scale = columnScale([0.05, -0.02, 0]);
    expect(scale).not.toBeNull();
    if (scale === null) return;
    expect(scale.step).toBeCloseTo(0.02);
    expect(scale.ticks.map((tick) => Number(tick.toFixed(4)))).toEqual([
      0.06, 0.04, 0.02, 0, -0.02,
    ]);
    expect(scale.position(0.06)).toBeCloseTo(0);
    expect(scale.position(0)).toBeCloseTo(75);
    expect(scale.position(-0.02)).toBeCloseTo(100);
  });

  it('starts at zero when every value is positive', () => {
    const scale = columnScale([1, 2.4]);
    expect(scale?.ticks.at(-1)).toBe(0);
    expect(scale?.position(0)).toBeCloseTo(100);
    expect(scale?.ticks[0]).toBeCloseTo(3);
  });

  it('is null when there is nothing to plot', () => {
    expect(columnScale([0, 0])).toBeNull();
    expect(columnScale([])).toBeNull();
  });
});

describe('ticks', () => {
  it('formats SOL ticks with as many decimals as the step needs', () => {
    expect(formatSolTick(0.06, 0.02)).toBe('0,06');
    expect(formatSolTick(-0.02, 0.02)).toBe('−0,02');
    expect(formatSolTick(0, 0.02)).toBe('0');
    expect(formatSolTick(2000, 1000)).toBe('2.000');
  });

  it('converts lamports to SOL for layout only', () => {
    expect(lamportsToSol(-1_500_000_000n)).toBe(-1.5);
  });
});
