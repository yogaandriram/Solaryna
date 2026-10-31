import { describe, expect, it } from 'vitest';
import { Decimal } from '../decimal';
import {
  effectiveRiskLimits,
  formatRuntimeLimit,
  isWithinCeiling,
  parseRiskLimitOverrides,
  serializeRiskLimitOverrides,
  type RuntimeLimits,
} from './runtime-limits';

const base: RuntimeLimits & { copyDelayMs: number } = {
  maxSolPerTradeLamports: 50_000_000n,
  maxOpenPositions: 5,
  dailyLossLimitLamports: 200_000_000n,
  minLiquidityUsd: new Decimal(20000),
  maxSlippageBps: 300,
  takeProfitPct: new Decimal(100),
  stopLossPct: new Decimal(30),
  maxHoldMinutes: 240,
  maxSignalAgeSeconds: 30,
  copyDelayMs: 3000,
};

describe('effectiveRiskLimits', () => {
  it('only lets an override make a limit stricter', () => {
    expect(
      effectiveRiskLimits(base, { maxSolPerTradeLamports: 1_000_000_000n }).maxSolPerTradeLamports,
    ).toBe(50_000_000n);
    expect(
      effectiveRiskLimits(base, { maxSolPerTradeLamports: 30_000_000n }).maxSolPerTradeLamports,
    ).toBe(30_000_000n);
    expect(effectiveRiskLimits(base, { maxOpenPositions: 9 }).maxOpenPositions).toBe(5);
    expect(effectiveRiskLimits(base, { stopLossPct: new Decimal(10) }).stopLossPct.toString()).toBe(
      '10',
    );
  });

  it('treats a higher minimum liquidity as stricter', () => {
    const low = effectiveRiskLimits(base, { minLiquidityUsd: new Decimal(10000) });
    const high = effectiveRiskLimits(base, { minLiquidityUsd: new Decimal(30000) });
    expect(low.minLiquidityUsd.toString()).toBe('20000');
    expect(high.minLiquidityUsd.toString()).toBe('30000');
  });

  it('keeps fields that are not runtime limits and does not mutate the base', () => {
    const result = effectiveRiskLimits(base, { maxHoldMinutes: 60 });
    expect(result.copyDelayMs).toBe(3000);
    expect(result.maxHoldMinutes).toBe(60);
    expect(base.maxHoldMinutes).toBe(240);
  });
});

describe('isWithinCeiling', () => {
  it('compares in the stricter direction of each key', () => {
    expect(isWithinCeiling('maxSlippageBps', 300, 300)).toBe(true);
    expect(isWithinCeiling('maxSlippageBps', 301, 300)).toBe(false);
    expect(isWithinCeiling('minLiquidityUsd', new Decimal(19999), new Decimal(20000))).toBe(false);
    expect(isWithinCeiling('minLiquidityUsd', new Decimal(25000), new Decimal(20000))).toBe(true);
  });
});

describe('parseRiskLimitOverrides', () => {
  it('drops unknown keys, wrong types and values outside the env minimums', () => {
    expect(
      parseRiskLimitOverrides({
        maxOpenPositions: '0',
        stopLossPct: '101',
        foo: '1',
        maxHoldMinutes: 5,
        maxSolPerTradeLamports: '-1',
        takeProfitPct: 'abc',
        maxSlippageBps: '1.5',
      }),
    ).toEqual({});
    expect(parseRiskLimitOverrides(null)).toEqual({});
    expect(parseRiskLimitOverrides('x')).toEqual({});
    expect(parseRiskLimitOverrides([1])).toEqual({});
  });

  it('round-trips with serializeRiskLimitOverrides', () => {
    const overrides = {
      maxSolPerTradeLamports: 30_000_000n,
      maxOpenPositions: 3,
      minLiquidityUsd: new Decimal('25000.5'),
      stopLossPct: new Decimal(20),
      maxSignalAgeSeconds: 15,
    };
    const serialized = serializeRiskLimitOverrides(overrides);
    expect(serialized).toEqual({
      maxSolPerTradeLamports: '30000000',
      maxOpenPositions: '3',
      minLiquidityUsd: '25000.5',
      stopLossPct: '20',
      maxSignalAgeSeconds: '15',
    });
    const parsed = parseRiskLimitOverrides(serialized);
    expect(serializeRiskLimitOverrides(parsed)).toEqual(serialized);
  });
});

describe('formatRuntimeLimit', () => {
  it('formats a stored value with its unit', () => {
    expect(formatRuntimeLimit('maxSolPerTradeLamports', '50000000')).toBe('0,05 SOL');
    expect(formatRuntimeLimit('minLiquidityUsd', '20000')).toBe('$20.000');
    expect(formatRuntimeLimit('maxSlippageBps', '300')).toBe('300 bps');
    expect(formatRuntimeLimit('takeProfitPct', '100')).toBe('100%');
    expect(formatRuntimeLimit('maxHoldMinutes', '240')).toBe('240 menit');
    expect(formatRuntimeLimit('maxSignalAgeSeconds', '30')).toBe('30 dtk');
    expect(formatRuntimeLimit('maxOpenPositions', '5')).toBe('5');
  });
});
