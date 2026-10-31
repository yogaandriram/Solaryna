import { describe, expect, it } from 'vitest';
import { rawAmountFromDriver, rawAmountToDriver } from './columns';

describe('rawAmount column mapping', () => {
  it('round-trips amounts beyond Number.MAX_SAFE_INTEGER', () => {
    const u64Max = 18_446_744_073_709_551_615n;
    expect(rawAmountToDriver(u64Max)).toBe('18446744073709551615');
    expect(rawAmountFromDriver('18446744073709551615')).toBe(u64Max);
  });

  it('handles zero and negative values (PnL)', () => {
    expect(rawAmountFromDriver('0')).toBe(0n);
    expect(rawAmountFromDriver('-150000')).toBe(-150_000n);
    expect(rawAmountToDriver(-1n)).toBe('-1');
  });

  it('rejects non-integer driver values instead of truncating', () => {
    for (const bad of ['1.5', '', 'abc', 42, null]) {
      expect(() => rawAmountFromDriver(bad)).toThrow(TypeError);
    }
  });
});
