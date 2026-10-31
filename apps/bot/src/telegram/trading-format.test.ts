import {
  Decimal,
  WSOL_MINT,
  buildDailySummary,
  buildWeeklyReport,
  type ReportPosition,
  type SwapEvent,
} from '@solaryna/core';
import type { PositionRow } from '@solaryna/db';
import { describe, expect, it } from 'vitest';
import type { TradeFill } from '../executor/types';
import { formatStartupMessage } from './format';
import {
  describeRiskReason,
  formatDailyReport,
  formatDecisionLine,
  formatExecutionError,
  formatPositionClosed,
  formatPositions,
  formatStatus,
  formatTradeExecuted,
  formatWeeklyReport,
  splitMessage,
} from './trading-format';

const TZ = 'Asia/Jakarta';
const MINT = 'AbrEhdN9Zsb5AvE5Pubd9VkUUr6ufAHfZ9zo7KAppump';
const EVIL = { symbol: '<b>PWN</b>', name: 'x&y' };
const AT = new Date('2026-10-31T05:00:00Z');

const fill: TradeFill = {
  side: 'buy',
  tokenMint: MINT,
  tokenAmountRaw: 1_000_000_000n,
  solAmountLamports: 50_000_000n,
  networkFeeLamports: 5000n,
  priorityFeeLamports: 200_000n,
  dexFeeLamports: 50_000n,
  slippageBps: 300,
  solUsdPrice: null,
  quotedAt: AT,
  executedAt: AT,
  quoteSnapshot: {},
  txSignature: null,
};

const position: PositionRow = {
  id: 7,
  mode: 'paper',
  status: 'closed',
  tokenMint: MINT,
  tokenDecimals: 6,
  trackedWalletId: 1,
  openedFromSignalId: 1,
  initialTokenAmountRaw: 1_000_000_000n,
  tokenAmountRaw: 0n,
  costLamports: 50_000_000n,
  proceedsLamports: 40_000_000n,
  feesLamports: 615_000n,
  realizedPnlLamports: -10_615_000n,
  closeReason: 'stop_loss',
  lastValueLamports: null,
  lastValuedAt: null,
  openedAt: AT,
  closedAt: AT,
  createdAt: AT,
  updatedAt: AT,
};

describe('describeRiskReason', () => {
  it('explains reasons in Indonesian with their numbers', () => {
    expect(
      describeRiskReason(
        { code: 'liquidity_below_min', detail: { actual: '12300', min: '20000' } },
        TZ,
      ),
    ).toBe('likuiditas $12.300 &lt; $20.000');
    expect(
      describeRiskReason(
        { code: 'liquidity_below_min', detail: { actual: null, min: '20000' } },
        TZ,
      ),
    ).toBe('likuiditas tidak diketahui (min $20.000)');
    expect(
      describeRiskReason(
        { code: 'signal_too_old', detail: { ageSeconds: 45, maxSeconds: 30 } },
        TZ,
      ),
    ).toBe('sinyal terlambat 45 dtk (maks 30)');
    expect(describeRiskReason({ code: 'liquidity_below_min' }, TZ)).toBe(
      'likuiditas di bawah minimum',
    );
  });
});

describe('formatDecisionLine', () => {
  it('summarizes the decision on one line', () => {
    expect(formatDecisionLine({ decision: 'accepted', side: 'buy', fill, soldPct: null }, TZ)).toBe(
      '🧪 Paper: diikuti',
    );
    expect(
      formatDecisionLine(
        { decision: 'accepted', side: 'sell', fill, soldPct: new Decimal(25) },
        TZ,
      ),
    ).toBe('🧪 Paper: ikut jual 25%');
    expect(
      formatDecisionLine(
        {
          decision: 'rejected',
          side: 'buy',
          reasons: [{ code: 'trading_paused' }, { code: 'already_holding' }],
        },
        TZ,
      ),
    ).toBe('🧪 Paper: dilewati — trading dijeda; token sudah dipegang');
    expect(
      formatDecisionLine(
        { decision: 'rejected', side: 'sell', reasons: [{ code: 'not_holding' }] },
        TZ,
      ),
    ).toBe('🧪 Paper: tidak memegang token ini');
    expect(formatDecisionLine({ decision: 'failed', side: 'buy', message: 'x' }, TZ)).toBe(
      '🧪 Paper: gagal dieksekusi',
    );
  });
});

describe('formatTradeExecuted', () => {
  const walletEvent: SwapEvent = {
    signature: 's',
    slot: 1n,
    blockTime: AT,
    wallet: 'WalletA',
    side: 'buy',
    tokenMint: MINT,
    tokenAmountRaw: 1_000_000_000n,
    tokenDecimals: 6,
    quoteMint: WSOL_MINT,
    quoteAmountRaw: 40_000_000n,
    quoteDecimals: 9,
    source: 'pumpfun',
  };

  it('shows amounts, fees and the price gap to the wallet, escaping token text', () => {
    const html = formatTradeExecuted({
      fill,
      token: EVIL,
      wallet: { id: 1, address: 'J8M2wM8vtBLZJfajpczrjbs78PWhW1sqVFVJdE5d43jX', label: 'a<b' },
      walletEvent,
      reason: 'copy_buy',
      realizedPnlLamports: null,
      tokenDecimals: 6,
      timeZone: TZ,
    });
    expect(html).toContain('PAPER BELI');
    expect(html).toContain('&lt;b&gt;PWN&lt;/b&gt;');
    expect(html).not.toContain('<b>PWN</b>');
    expect(html).toContain('a&lt;b');
    expect(html).toContain('0,05 SOL');
    expect(html).toContain('jaringan 0,000005 SOL');
    expect(html).toContain('priority 0,0002 SOL');
    // We paid 0.05 SOL, the wallet 0.04 SOL for the same amount.
    expect(html).toContain('25% lebih mahal dari wallet');
  });

  it('shows the realized PnL of a sell', () => {
    const html = formatTradeExecuted({
      fill: { ...fill, side: 'sell', solAmountLamports: 40_000_000n },
      token: { symbol: 'AAA', name: null },
      wallet: null,
      walletEvent: null,
      reason: 'stop_loss',
      realizedPnlLamports: -10_615_000n,
      tokenDecimals: 6,
      timeZone: TZ,
    });
    expect(html).toContain('PAPER JUAL');
    expect(html).toContain('stop-loss');
    expect(html).toContain('PnL realisasi: -0,01062 SOL');
  });
});

describe('formatExecutionError', () => {
  it('names the token and side and escapes the error text', () => {
    const html = formatExecutionError({
      tokenMint: MINT,
      side: 'sell',
      message: 'Jupiter getOrder failed (500): <html>',
      token: EVIL,
    });
    expect(html).toContain('Paper');
    expect(html).toContain('jual');
    expect(html).toContain('&lt;b&gt;PWN&lt;/b&gt;');
    expect(html).toContain('(500): &lt;html&gt;');
    expect(html).not.toContain('<html>');
  });
});

describe('position messages', () => {
  it('reports a closed position with its net PnL and fees', () => {
    const html = formatPositionClosed({ position, reason: 'stop_loss', token: EVIL });
    expect(html).toContain('&lt;b&gt;PWN&lt;/b&gt;');
    expect(html).toContain('Modal: 0,05 SOL');
    expect(html).toContain('Hasil jual: 0,04 SOL');
    expect(html).toContain('Biaya: 0,000615 SOL');
    expect(html).toContain('PnL bersih: -0,01062 SOL (-21,2%)');
    expect(html).toContain('bukan saran investasi');
  });

  it('shows status and open positions', () => {
    expect(
      formatStatus({
        mode: 'paper',
        paused: true,
        openCount: 2,
        realizedTodayLamports: 1_500_000n,
      }),
    ).toContain('⏸');
    const html = formatPositions([
      {
        position: { ...position, status: 'open', tokenAmountRaw: 1_000_000_000n },
        token: EVIL,
        walletLabel: 'alpha',
        valuation: {
          positionId: 7,
          netValueLamports: 60_000_000n,
          remainingCostLamports: 50_000_000n,
          at: AT,
        },
        now: new Date(AT.getTime() + 90 * 60_000),
      },
    ]);
    expect(html).toContain('&lt;b&gt;PWN&lt;/b&gt;');
    expect(html).toContain('0,06 SOL');
    // 60M value - 50M cost - 615k fees not realized yet.
    expect(html).toContain('+0,009385 SOL');
    expect(html).toContain('1 j 30 m');
    expect(formatPositions([])).toBe('Tidak ada posisi terbuka.');
  });
});

function reportPosition(i: number, overrides: Partial<ReportPosition> = {}): ReportPosition {
  return {
    id: i,
    tokenMint: MINT,
    tokenSymbol: '<i>T</i>',
    tokenDecimals: 6,
    walletId: i,
    walletAddress: `Wallet${String(i).padStart(38, '1')}`,
    walletLabel: `wallet-${i}`,
    closeReason: 'follow_sell',
    costLamports: 50_000_000n,
    initialTokenAmountRaw: 1000n,
    proceedsLamports: 40_000_000n,
    feesLamports: 410_000n,
    realizedPnlLamports: -10_410_000n,
    walletEntry: null,
    walletExits: [],
    buySolUsd: null,
    exitSolUsd: null,
    ...overrides,
  };
}

const range = {
  key: '2026-10-26',
  from: new Date('2026-10-25T17:00:00Z'),
  to: new Date('2026-11-01T17:00:00Z'),
};

describe('reports', () => {
  it('labels the daily report as a paper simulation', () => {
    const summary = buildDailySummary({ trades: [], closedPositions: [], signals: [], open: [] });
    const [message, ...rest] = formatDailyReport(summary, { ...range, key: '2026-10-31' }, TZ);
    expect(rest).toEqual([]);
    expect(message).toContain('PAPER');
    expect(message).toContain('31 Okt 2026');
    expect(message).toContain('Hasil simulasi, bukan saran investasi.');
  });

  it('marks unavailable decompositions and wallets still holding', () => {
    const report = buildWeeklyReport({
      trades: [],
      closedPositions: [reportPosition(1)],
      signals: [],
    });
    const text = formatWeeklyReport(report, range, TZ).join('\n');
    expect(text).toContain('PAPER');
    expect(text).toContain('tidak tersedia');
    expect(text).toContain('&lt;i&gt;T&lt;/i&gt;');
    expect(text).toContain('Hasil simulasi, bukan saran investasi.');

    const holding = buildWeeklyReport({
      trades: [],
      closedPositions: [
        reportPosition(1, {
          walletEntry: {
            quoteMint: WSOL_MINT,
            quoteAmountRaw: 40_000_000n,
            quoteDecimals: 9,
            tokenAmountRaw: 1000n,
          },
        }),
      ],
      signals: [],
    });
    expect(formatWeeklyReport(holding, range, TZ).join('\n')).toContain('wallet masih memegang');
  });

  it('splits a long weekly report into messages within the Telegram limit', () => {
    const positions = Array.from({ length: 60 }, (_, i) => reportPosition(i + 1));
    const report = buildWeeklyReport({ trades: [], closedPositions: positions, signals: [] });
    const messages = formatWeeklyReport(report, range, TZ);
    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) {
      expect(message.length).toBeLessThanOrEqual(4096);
    }
    expect(messages.join('\n')).toContain('wallet-60');
  });
});

describe('splitMessage', () => {
  it('splits on line boundaries', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i} ${'x'.repeat(20)}`);
    const parts = splitMessage(lines.join('\n'), 70);
    expect(parts.every((part) => part.length <= 70)).toBe(true);
    expect(parts.join('\n')).toBe(lines.join('\n'));
    expect(parts.every((part) => part.split('\n').every((line) => lines.includes(line)))).toBe(
      true,
    );
  });
});

describe('formatStartupMessage (M2)', () => {
  it('says whether paper trading is running or paused', () => {
    const base = {
      mode: 'paper' as const,
      fallbackReasons: [],
      ingestSource: 'webhook' as const,
      walletCount: 1,
    };
    expect(formatStartupMessage({ ...base, paused: false })).toContain('Paper trading aktif');
    const paused = formatStartupMessage({ ...base, paused: true });
    expect(paused).toContain('⏸');
    expect(paused).not.toContain('eksekusi trade belum aktif');
  });
});
