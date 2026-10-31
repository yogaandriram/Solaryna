import { describe, expect, it } from 'vitest';
import { USDC_MINT, WSOL_MINT } from '../constants';
import { Decimal } from '../decimal';
import {
  buildDailySummary,
  buildWeeklyReport,
  decomposePosition,
  type ReportPosition,
  type ReportSignal,
  type ReportTrade,
} from './report';

const SOL = 1_000_000_000n;

function position(overrides: Partial<ReportPosition> = {}): ReportPosition {
  return {
    id: 1,
    tokenMint: 'Mint1',
    tokenSymbol: 'AAA',
    tokenDecimals: 6,
    walletId: 10,
    walletAddress: 'WalletA',
    walletLabel: 'alpha',
    closeReason: 'follow_sell',
    costLamports: SOL,
    initialTokenAmountRaw: 1000n,
    proceedsLamports: (SOL * 3n) / 2n,
    feesLamports: 0n,
    realizedPnlLamports: SOL / 2n,
    walletEntry: {
      quoteMint: WSOL_MINT,
      quoteAmountRaw: (SOL * 9n) / 10n,
      quoteDecimals: 9,
      tokenAmountRaw: 1000n,
    },
    walletExits: [
      {
        quoteMint: WSOL_MINT,
        quoteAmountRaw: (SOL * 9n) / 5n,
        quoteDecimals: 9,
        tokenAmountRaw: 1000n,
      },
    ],
    buySolUsd: null,
    exitSolUsd: null,
    ...overrides,
  };
}

const usdcEntry = {
  quoteMint: USDC_MINT,
  quoteAmountRaw: 90_000_000n,
  quoteDecimals: 6,
  tokenAmountRaw: 1000n,
};

describe('decomposePosition', () => {
  it('splits gross PnL into wallet result, entry gap and exit gap', () => {
    // Wallet bought at 0.9 SOL and sold at 1.8 SOL per 1000 tokens; we paid 1 SOL, got 1.5 SOL.
    const d = decomposePosition(
      position({ feesLamports: 1_000_000n, realizedPnlLamports: 499_000_000n }),
    );
    expect(d.walletLamports).toBe(1_000_000_000n);
    expect(d.entryLamports).toBe(-200_000_000n);
    expect(d.exitLamports).toBe(-300_000_000n);
    expect(d.unattributedLamports).toBe(0n);
    expect(d.walletLamports + d.entryLamports + d.exitLamports).toBe(500_000_000n);
    expect(d.feesLamports).toBe(1_000_000n);
    expect(d.netLamports).toBe(499_000_000n);
    expect(d).toMatchObject({
      positions: 1,
      unattributedPositions: 0,
      walletStillHoldingPositions: 0,
    });
  });

  it('uses our exit price when the wallet has not sold yet', () => {
    const d = decomposePosition(position({ walletExits: [], closeReason: 'take_profit' }));
    expect(d.exitLamports).toBe(0n);
    expect(d.walletLamports + d.entryLamports).toBe(500_000_000n);
    expect(d.walletStillHoldingPositions).toBe(1);
  });

  it('converts USDC wallet prices with the SOL/USD price of our trades', () => {
    // Wallet paid 90 USDC for 1000 tokens at 100 USD/SOL = 0.9 SOL; sold for 1.8 SOL.
    const d = decomposePosition(position({ walletEntry: usdcEntry, buySolUsd: new Decimal(100) }));
    expect(d.walletLamports).toBe(1_000_000_000n);
    expect(d.entryLamports).toBe(-200_000_000n);
  });

  it('leaves everything unattributed when the wallet price cannot be computed', () => {
    const d = decomposePosition(position({ walletEntry: usdcEntry, buySolUsd: null }));
    expect(d).toMatchObject({
      walletLamports: 0n,
      entryLamports: 0n,
      exitLamports: 0n,
      unattributedLamports: 500_000_000n,
      unattributedPositions: 1,
    });
    expect(decomposePosition(position({ walletEntry: null })).unattributedPositions).toBe(1);
  });

  it('handles an unsellable position closed at zero', () => {
    const d = decomposePosition(
      position({
        proceedsLamports: 0n,
        realizedPnlLamports: -SOL - 5000n,
        feesLamports: 5000n,
        closeReason: 'unsellable',
      }),
    );
    expect(d.walletLamports + d.entryLamports + d.exitLamports).toBe(-SOL);
    expect(d.netLamports).toBe(-SOL - 5000n);
  });
});

const trade = (overrides: Partial<ReportTrade>): ReportTrade => ({
  side: 'buy',
  reason: 'copy_buy',
  networkFeeLamports: 5000n,
  priorityFeeLamports: 200_000n,
  dexFeeLamports: 0n,
  realizedPnlLamports: null,
  ...overrides,
});

const signal = (overrides: Partial<ReportSignal>): ReportSignal => ({
  walletId: 10,
  walletAddress: 'WalletA',
  walletLabel: 'alpha',
  decision: 'accepted',
  reasons: [],
  ...overrides,
});

describe('buildDailySummary', () => {
  it('totals realized PnL, fees, outcomes and rejections', () => {
    const summary = buildDailySummary({
      trades: [
        trade({}),
        trade({
          side: 'sell',
          reason: 'take_profit',
          dexFeeLamports: 1000n,
          realizedPnlLamports: 3000n,
        }),
        trade({ side: 'sell', reason: 'stop_loss', realizedPnlLamports: -10_000n }),
      ],
      closedPositions: [
        position({ realizedPnlLamports: 3000n }),
        position({ id: 2, realizedPnlLamports: -10_000n }),
      ],
      signals: [
        signal({}),
        signal({
          decision: 'rejected',
          reasons: [{ code: 'liquidity_below_min' }, { code: 'trading_paused' }],
        }),
        signal({ decision: 'rejected', reasons: [{ code: 'liquidity_below_min' }] }),
      ],
      open: [
        { remainingCostLamports: 1000n, netValueLamports: 1500n, pendingFeesLamports: 100n },
        { remainingCostLamports: 1000n, netValueLamports: null, pendingFeesLamports: 100n },
      ],
    });
    expect(summary).toMatchObject({
      realizedPnlLamports: -7000n,
      buys: 1,
      sells: 2,
      wins: 1,
      losses: 1,
      fees: { network: 15_000n, priority: 600_000n, dex: 1000n, total: 616_000n },
      acceptedSignals: 1,
      rejectedSignals: 2,
      openCount: 2,
      unpricedOpenCount: 1,
      unrealizedPnlLamports: 400n,
    });
    expect(summary.topRejections).toEqual([
      { code: 'liquidity_below_min', count: 2 },
      { code: 'trading_paused', count: 1 },
    ]);
  });

  it('reports no unrealized PnL when no open position is priced', () => {
    const summary = buildDailySummary({ trades: [], closedPositions: [], signals: [], open: [] });
    expect(summary.unrealizedPnlLamports).toBeNull();
    expect(summary.topRejections).toEqual([]);
  });
});

describe('buildWeeklyReport', () => {
  it('groups by wallet with the worst first, by exit reason and by rejection reason', () => {
    const a1 = position({ id: 1, realizedPnlLamports: SOL / 2n });
    const b1 = position({
      id: 2,
      walletId: 20,
      walletAddress: 'WalletB',
      walletLabel: null,
      closeReason: 'stop_loss',
      proceedsLamports: SOL / 2n,
      realizedPnlLamports: -SOL / 2n,
      walletExits: [],
    });
    const report = buildWeeklyReport({
      trades: [
        trade({ side: 'sell', realizedPnlLamports: SOL / 2n }),
        trade({ side: 'sell', realizedPnlLamports: -SOL / 2n }),
      ],
      closedPositions: [a1, b1],
      signals: [
        signal({}),
        signal({ walletId: 20, walletAddress: 'WalletB', walletLabel: null }),
        signal({
          walletId: 30,
          walletAddress: 'WalletC',
          walletLabel: null,
          decision: 'rejected',
          reasons: [{ code: 'no_route' }],
        }),
      ],
    });
    expect(report.positions).toBe(2);
    expect(report.winRate?.toString()).toBe('0.5');
    expect(
      report.perWallet.map((w) => [
        w.walletAddress,
        w.buySignals,
        w.positions,
        w.realizedPnlLamports,
      ]),
    ).toEqual([
      ['WalletB', 1, 1, -SOL / 2n],
      ['WalletC', 1, 0, 0n],
      ['WalletA', 1, 1, SOL / 2n],
    ]);
    expect(report.perWallet[1]?.winRate).toBeNull();
    expect(report.perExitReason).toEqual([
      { reason: 'follow_sell', count: 1, realizedPnlLamports: SOL / 2n },
      { reason: 'stop_loss', count: 1, realizedPnlLamports: -SOL / 2n },
    ]);
    expect(report.rejectedByReason).toEqual([{ code: 'no_route', count: 1 }]);
    expect(report.best?.id).toBe(1);
    expect(report.worst?.id).toBe(2);
    const d = report.decomposition;
    expect(d.positions).toBe(2);
    expect(d.walletLamports + d.entryLamports + d.exitLamports + d.unattributedLamports).toBe(0n);
  });
});
