import { Decimal, USDC_MINT, WSOL_MINT } from '@solaryna/core';
import { describe, expect, it } from 'vitest';
import {
  formatDateTime,
  formatDayKey,
  formatDuration,
  formatPct,
  formatQuoteAmount,
  formatSignedSol,
  formatSol,
  formatTime,
  formatTokenAmount,
  formatUsd,
  pnlPct,
  pnlTone,
  tokenLabel,
  walletName,
} from './format';

const MINT = 'J8M2wM8vtBLZJfajpczrjbs78PWhW1sqVFVJdE5d43jX';
const MINUS = '−';

describe('SOL amounts', () => {
  it('formats lamports as SOL', () => {
    expect(formatSol(50_000_000n)).toBe('0,05 SOL');
    expect(formatSol(1_234_567_890n)).toBe('1,2346 SOL');
    expect(formatSol(0n)).toBe('0 SOL');
  });

  it('signs PnL with + and a real minus sign', () => {
    expect(formatSignedSol(10_000_000n)).toBe('+0,01 SOL');
    expect(formatSignedSol(-20_000_000n)).toBe(`${MINUS}0,02 SOL`);
    expect(formatSignedSol(0n)).toBe('0 SOL');
  });

  it('tones PnL by sign', () => {
    expect(pnlTone(1n)).toBe('pos');
    expect(pnlTone(-1n)).toBe('neg');
    expect(pnlTone(0n)).toBe('zero');
  });
});

describe('percentages', () => {
  it('computes PnL percent against cost, or null without a cost', () => {
    expect(pnlPct(25_000_000n, 100_000_000n)?.toString()).toBe('25');
    expect(pnlPct(-1n, 3n)?.toDecimalPlaces(2).toString()).toBe('-33.33');
    expect(pnlPct(5n, 0n)).toBeNull();
    expect(pnlPct(5n, -1n)).toBeNull();
  });

  it('formats percent values', () => {
    expect(formatPct(null)).toBe('—');
    expect(formatPct(new Decimal('12.345'), true)).toBe('+12,3%');
    expect(formatPct(new Decimal('12.345'))).toBe('12,3%');
    expect(formatPct(new Decimal('-5'), true)).toBe(`${MINUS}5%`);
    expect(formatPct(new Decimal('0'), true)).toBe('0%');
  });
});

describe('other amounts', () => {
  it('formats USD', () => {
    expect(formatUsd('20000')).toBe('$20.000');
    expect(formatUsd(new Decimal('1234.567'))).toBe('$1.235');
    expect(formatUsd('12.5')).toBe('$12,50');
    expect(formatUsd(null)).toBe('—');
  });

  it('formats token amounts with their decimals', () => {
    expect(formatTokenAmount(1_234_567_890n, 6)).toBe('1.234,57');
    expect(formatTokenAmount(1_500n, 6)).toBe('0,0015');
  });

  it('formats quote amounts by mint', () => {
    expect(formatQuoteAmount(500_000_000n, 9, WSOL_MINT)).toBe('0,5 SOL');
    expect(formatQuoteAmount(12_500_000n, 6, USDC_MINT)).toBe('12,5 USDC');
    expect(formatQuoteAmount(3_000_000n, 6, MINT)).toBe('3 J8M2…43jX');
  });
});

describe('time', () => {
  const at = new Date(Date.UTC(2026, 9, 31, 3, 53, 41));

  it('formats date and time in the display zone', () => {
    expect(formatDateTime(at, 'Asia/Jakarta')).toBe('31 Okt 2026, 10.53 WIB');
    expect(formatTime(at, 'Asia/Jakarta')).toBe('10.53.41 WIB');
  });

  it('formats a zoned date key', () => {
    expect(formatDayKey('2026-10-31')).toBe('Sab, 31 Okt');
  });

  it('formats durations', () => {
    expect(formatDuration(45_000)).toBe('45 dtk');
    expect(formatDuration(12 * 60_000 + 59_000)).toBe('12 m');
    expect(formatDuration((3 * 60 + 5) * 60_000)).toBe('3 j 5 m');
    expect(formatDuration((2 * 24 + 4) * 3_600_000 + 59 * 60_000)).toBe('2 h 4 j');
    expect(formatDuration(-5)).toBe('0 dtk');
  });
});

describe('labels', () => {
  it('prefers the symbol or label, falling back to the short address', () => {
    expect(tokenLabel('BONK', MINT)).toBe('BONK');
    expect(tokenLabel(null, MINT)).toBe('J8M2…43jX');
    expect(walletName('Paus', MINT)).toBe('Paus');
    expect(walletName(null, MINT)).toBe('J8M2…43jX');
  });
});
