import { describe, expect, it } from 'vitest';
import { formatAmount, formatDateTime } from './format';
import { parseWalletList } from './wallet-list';

describe('formatAmount', () => {
  it('uses id-ID separators and limits fraction digits for whole amounts', () => {
    expect(formatAmount(1_234_567_891_234n, 6, 2)).toBe('1.234.567,89');
    expect(formatAmount(1_500_000_000n, 9, 4)).toBe('1,5');
    expect(formatAmount(3_639_046_262n, 9, 4)).toBe('3,639');
  });

  it('keeps significant digits for amounts below one', () => {
    expect(formatAmount(44_204n, 9, 4)).toBe('0,0000442');
    expect(formatAmount(123_456_789n, 9, 4)).toBe('0,1235');
  });

  it('is exact beyond the safe integer range', () => {
    expect(formatAmount(123_456_789_012_345_678_901n, 0, 2)).toBe('123.456.789.012.345.678.901');
  });

  it('handles zero and zero decimals', () => {
    expect(formatAmount(0n, 6, 2)).toBe('0');
    expect(formatAmount(42n, 0, 2)).toBe('42');
  });
});

describe('formatDateTime', () => {
  it('shows the time in WIB', () => {
    expect(formatDateTime(new Date('2026-10-31T03:53:41Z'), 'Asia/Jakarta')).toBe(
      '31 Okt 2026, 10.53.41 WIB',
    );
  });
});

describe('parseWalletList', () => {
  const walletA = 'J8M2wM8vp5Q9aJm3z5AGk8vZbn5w4f9Br8cDNw3XcGXS';
  const walletB = 'So11111111111111111111111111111111111111112';

  it('reads addresses with optional labels in several separators', () => {
    const text = [
      'address,label',
      '# dari GMGN, 30 hari',
      '',
      `${walletA}  Smart money 1`,
      `${walletB};  ape\tking `,
    ].join('\r\n');
    expect(parseWalletList(text)).toEqual({
      entries: [
        { address: walletA, label: 'Smart money 1' },
        { address: walletB, label: 'ape king' },
      ],
      errors: [],
    });
  });

  it('reports invalid and duplicate lines with their line numbers', () => {
    const text = [walletA, 'not-a-wallet label', `${walletA},again`].join('\n');
    const result = parseWalletList(text);
    expect(result.entries).toEqual([{ address: walletA, label: null }]);
    expect(result.errors).toEqual([
      { line: 2, reason: 'invalid_address', text: 'not-a-wallet label' },
      { line: 3, reason: 'duplicate', text: `${walletA},again` },
    ]);
  });
});
