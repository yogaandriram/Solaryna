import { describe, expect, it } from 'vitest';
import {
  applySell,
  followSellTokenAmount,
  remainingCostLamports,
  type PositionState,
} from './position';

const opened: PositionState = {
  initialTokenAmountRaw: 1_000_000n,
  tokenAmountRaw: 1_000_000n,
  costLamports: 50_000_000n,
  proceedsLamports: 0n,
  feesLamports: 205_000n,
  realizedPnlLamports: 0n,
};

describe('applySell', () => {
  it('realizes the buy fees on the first partial sell, at average cost', () => {
    const result = applySell(opened, {
      tokenAmountRaw: 400_000n,
      solAmountLamports: 30_000_000n,
      feesLamports: 205_000n,
    });
    expect(result.realizedPnlLamports).toBe(9_590_000n);
    expect(result.closed).toBe(false);
    expect(result.next).toEqual({
      ...opened,
      tokenAmountRaw: 600_000n,
      proceedsLamports: 30_000_000n,
      feesLamports: 410_000n,
      realizedPnlLamports: 9_590_000n,
    });
  });

  it('closes on the final sell so the total equals proceeds - cost - all fees', () => {
    const first = applySell(opened, {
      tokenAmountRaw: 400_000n,
      solAmountLamports: 30_000_000n,
      feesLamports: 205_000n,
    });
    const final = applySell(first.next, {
      tokenAmountRaw: 600_000n,
      solAmountLamports: 10_000_000n,
      feesLamports: 205_000n,
    });
    expect(final.closed).toBe(true);
    expect(final.realizedPnlLamports).toBe(-20_205_000n);
    expect(final.next.tokenAmountRaw).toBe(0n);
    expect(final.next.realizedPnlLamports).toBe(40_000_000n - 50_000_000n - 615_000n);
  });

  it('charges the buy fees once even when the first sale returned nothing', () => {
    const first = applySell(opened, {
      tokenAmountRaw: 500_000n,
      solAmountLamports: 0n,
      feesLamports: 0n,
    });
    const second = applySell(first.next, {
      tokenAmountRaw: 250_000n,
      solAmountLamports: 1_000_000n,
      feesLamports: 0n,
    });
    expect(first.realizedPnlLamports).toBe(-25_000_000n - 205_000n);
    expect(second.realizedPnlLamports).toBe(1_000_000n - 12_500_000n);
  });

  it('rejects selling more than the position holds or nothing at all', () => {
    expect(() =>
      applySell(opened, { tokenAmountRaw: 1_000_001n, solAmountLamports: 1n, feesLamports: 0n }),
    ).toThrow(RangeError);
    expect(() =>
      applySell(opened, { tokenAmountRaw: 0n, solAmountLamports: 1n, feesLamports: 0n }),
    ).toThrow(RangeError);
  });
});

describe('remainingCostLamports', () => {
  it('prorates the cost by the tokens still held', () => {
    expect(remainingCostLamports(opened)).toBe(50_000_000n);
    expect(remainingCostLamports({ ...opened, tokenAmountRaw: 333_333n })).toBe(16_666_650n);
    expect(remainingCostLamports({ ...opened, tokenAmountRaw: 0n })).toBe(0n);
  });
});

describe('followSellTokenAmount', () => {
  it('sells the same share of the position as the wallet sold of its balance', () => {
    expect(followSellTokenAmount(1000n, 250n, 1000n)).toBe(250n);
  });

  it('sells everything when the wallet sold it all or its balance is unknown', () => {
    expect(followSellTokenAmount(1000n, 2000n, 1000n)).toBe(1000n);
    expect(followSellTokenAmount(1000n, 5n, null)).toBe(1000n);
    expect(followSellTokenAmount(1000n, 5n, 0n)).toBe(1000n);
  });

  it('rounds down to zero for a tiny share', () => {
    expect(followSellTokenAmount(3n, 1n, 1000n)).toBe(0n);
  });
});
