import { describe, expect, it } from 'vitest';
import {
  PAGE_SIZE,
  pageToOffset,
  parseId,
  parseMode,
  parsePage,
  parsePositionsTab,
  parseSignalFilter,
  parseWalletStatus,
  splitPage,
  withParams,
} from './params';

describe('parseMode', () => {
  it('defaults to paper', () => {
    expect(parseMode('live')).toBe('live');
    expect(parseMode('paper')).toBe('paper');
    expect(parseMode('x')).toBe('paper');
    expect(parseMode(undefined)).toBe('paper');
    expect(parseMode(['live', 'paper'])).toBe('live');
  });
});

describe('parsePage', () => {
  it('accepts integers from 1 to 10 000 and falls back to 1', () => {
    expect(parsePage('3')).toBe(3);
    expect(parsePage('10000')).toBe(10_000);
    expect(parsePage('10001')).toBe(1);
    expect(parsePage('-3')).toBe(1);
    expect(parsePage('2.5')).toBe(1);
    expect(parsePage('0')).toBe(1);
    expect(parsePage(undefined)).toBe(1);
  });
});

describe('parseId', () => {
  it('accepts positive safe integers only', () => {
    expect(parseId('42')).toBe(42);
    expect(parseId('abc')).toBeNull();
    expect(parseId('0')).toBeNull();
    expect(parseId('-1')).toBeNull();
    expect(parseId('1e3')).toBeNull();
    expect(parseId('99999999999999999999')).toBeNull();
    expect(parseId(undefined)).toBeNull();
  });
});

describe('parseSignalFilter', () => {
  it('keeps only valid filters', () => {
    expect(parseSignalFilter({ decision: 'accepted', side: 'zzz', wallet: '4' })).toEqual({
      decision: 'accepted',
      walletId: 4,
    });
    expect(parseSignalFilter({ decision: 'rejected', side: 'sell' })).toEqual({
      decision: 'rejected',
      side: 'sell',
    });
    expect(parseSignalFilter({})).toEqual({});
  });
});

describe('pagination', () => {
  it('fetches one extra row to know whether a next page exists', () => {
    expect(PAGE_SIZE).toBe(50);
    expect(pageToOffset(1)).toEqual({ limit: 51, offset: 0 });
    expect(pageToOffset(3)).toEqual({ limit: 51, offset: 100 });
  });

  it('splits the extra row off', () => {
    const full = Array.from({ length: 51 }, (_, i) => i);
    expect(splitPage(full)).toEqual({ items: full.slice(0, 50), hasNext: true });
    expect(splitPage([1, 2])).toEqual({ items: [1, 2], hasNext: false });
  });
});

describe('withParams', () => {
  it('builds a query string, skipping undefined values', () => {
    expect(withParams('/sinyal', { mode: 'live', page: 2, wallet: undefined })).toBe(
      '/sinyal?mode=live&page=2',
    );
    expect(withParams('/', {})).toBe('/');
    expect(withParams('/posisi', { q: 'a b&c' })).toBe('/posisi?q=a+b%26c');
  });
});

describe('parsePositionsTab', () => {
  it('defaults to the open tab', () => {
    expect(parsePositionsTab('closed')).toBe('closed');
    expect(parsePositionsTab('trades')).toBe('trades');
    expect(parsePositionsTab('x')).toBe('open');
    expect(parsePositionsTab(undefined)).toBe('open');
  });
});

describe('parseWalletStatus', () => {
  it('defaults to all wallets', () => {
    expect(parseWalletStatus('active')).toBe('active');
    expect(parseWalletStatus('inactive')).toBe('inactive');
    expect(parseWalletStatus('zzz')).toBe('all');
    expect(parseWalletStatus(undefined)).toBe('all');
  });
});
