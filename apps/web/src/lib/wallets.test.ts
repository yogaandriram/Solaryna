import { describe, expect, it } from 'vitest';
import { winRatePct } from './wallets';

describe('winRatePct', () => {
  it('is null when no position has closed yet', () => {
    expect(winRatePct(0, 0)).toBeNull();
  });

  it('is the share of winning closed positions in percent', () => {
    expect(winRatePct(2, 3)?.toFixed(2)).toBe('66.67');
    expect(winRatePct(0, 4)?.toString()).toBe('0');
    expect(winRatePct(5, 5)?.toString()).toBe('100');
  });
});
