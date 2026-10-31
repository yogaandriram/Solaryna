import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal';
import { formatUnits, lamportsToSol, parseUnits, toDecimal } from './units';

describe('parseUnits', () => {
  it('parses SOL amounts into lamports', () => {
    expect(parseUnits('0.05', 9)).toBe(50_000_000n);
    expect(parseUnits('1', 9)).toBe(1_000_000_000n);
    expect(parseUnits('0.000000001', 9)).toBe(1n);
  });

  it('handles zero and zero decimals', () => {
    expect(parseUnits('0', 9)).toBe(0n);
    expect(parseUnits('0.0', 6)).toBe(0n);
    expect(parseUnits('42', 0)).toBe(42n);
  });

  it('handles negative values and surrounding whitespace', () => {
    expect(parseUnits(' -1.5 ', 6)).toBe(-1_500_000n);
  });

  it('keeps precision beyond Number.MAX_SAFE_INTEGER', () => {
    expect(parseUnits('18446744073.709551615', 9)).toBe(18_446_744_073_709_551_615n);
  });

  it('rejects more fractional digits than decimals instead of rounding', () => {
    expect(() => parseUnits('0.0000000001', 9)).toThrow(RangeError);
    expect(() => parseUnits('1.5', 0)).toThrow(RangeError);
  });

  it('rejects malformed input', () => {
    for (const bad of ['', 'abc', '1e9', '1.', '.5', '0x10', '1,5', '--1']) {
      expect(() => parseUnits(bad, 9)).toThrow(RangeError);
    }
  });

  it('rejects invalid decimals', () => {
    expect(() => parseUnits('1', -1)).toThrow(RangeError);
    expect(() => parseUnits('1', 1.5)).toThrow(RangeError);
  });
});

describe('formatUnits', () => {
  it('formats raw amounts with different decimals', () => {
    expect(formatUnits(50_000_000n, 9)).toBe('0.05');
    expect(formatUnits(1_234_567n, 6)).toBe('1.234567');
    expect(formatUnits(1n, 9)).toBe('0.000000001');
    expect(formatUnits(42n, 0)).toBe('42');
  });

  it('formats zero and negative amounts', () => {
    expect(formatUnits(0n, 9)).toBe('0');
    expect(formatUnits(-1_500_000n, 6)).toBe('-1.5');
  });

  it('round-trips with parseUnits', () => {
    for (const [value, decimals] of [
      ['123.456', 9],
      ['0.000001', 6],
      ['-7', 0],
      ['340282366920938463463.374607431768211455', 18],
    ] as const) {
      expect(formatUnits(parseUnits(value, decimals), decimals)).toBe(value);
    }
  });
});

describe('toDecimal / lamportsToSol', () => {
  it('converts exactly without floating point error', () => {
    expect(toDecimal(1n, 18).toString()).toBe('0.000000000000000001');
    expect(lamportsToSol(200_000_000n).equals(new Decimal('0.2'))).toBe(true);
  });

  it('never uses exponential notation', () => {
    expect(toDecimal(10n ** 30n, 0).toString()).toBe('1' + '0'.repeat(30));
  });
});
