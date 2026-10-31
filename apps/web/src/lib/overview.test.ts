import { Decimal } from '@solaryna/core';
import type { DashboardPosition, OverviewTotals, PositionRow } from '@solaryna/db';
import { describe, expect, it } from 'vitest';
import { buildOverview, positionEstimate } from './overview';

const NOW = new Date('2026-10-31T05:00:00Z');

function position(overrides: Partial<PositionRow>): DashboardPosition {
  return {
    position: {
      id: 1,
      mode: 'paper',
      status: 'open',
      tokenMint: 'J8M2wM8vtBLZJfajpczrjbs78PWhW1sqVFVJdE5d43jX',
      tokenDecimals: 6,
      trackedWalletId: 1,
      openedFromSignalId: 1,
      initialTokenAmountRaw: 1_000n,
      tokenAmountRaw: 1_000n,
      costLamports: 100_000_000n,
      proceedsLamports: 0n,
      feesLamports: 1_000_000n,
      realizedPnlLamports: null,
      closeReason: null,
      lastValueLamports: null,
      lastValuedAt: null,
      openedAt: NOW,
      closedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    },
    tokenSymbol: null,
    walletId: 1,
    walletAddress: 'Fake1111111111111111111111111111111111111111',
    walletLabel: null,
  };
}

const totals: OverviewTotals = {
  realizedTodayLamports: 1n,
  realizedWeekLamports: 2n,
  realizedAllLamports: 3n,
  feesWeekLamports: 4n,
  closedCount: 0,
  winCount: 0,
  signalsToday: { accepted: 2, rejected: 5 },
};

const limits = { maxOpenPositions: 5 };

describe('positionEstimate', () => {
  it('is null without a valuation and value − remaining cost − pending fees with one', () => {
    expect(positionEstimate(position({}).position)).toBeNull();
    expect(positionEstimate(position({ lastValueLamports: 120_000_000n }).position)).toBe(
      19_000_000n,
    );
  });
});

describe('buildOverview', () => {
  it('has no win rate and zero unrealized PnL without positions', () => {
    const view = buildOverview({ totals, open: [], limits });
    expect(view.winRate).toBeNull();
    expect(view.unrealized).toEqual({ totalLamports: 0n, valuedCount: 0, unvaluedCount: 0 });
    expect(view.openCount).toBe(0);
    expect(view.maxOpen).toBe(5);
    expect(view.capitalInUseLamports).toBe(0n);
    expect(view.realizedTodayLamports).toBe(1n);
    expect(view.signalsToday).toEqual({ accepted: 2, rejected: 5 });
  });

  it('sums the estimate over valued positions only and counts the rest', () => {
    const view = buildOverview({
      totals: { ...totals, closedCount: 4, winCount: 1 },
      open: [
        position({ id: 1, lastValueLamports: 120_000_000n }),
        // Half sold: remaining cost 25_000_000, no valuation.
        position({ id: 2, costLamports: 50_000_000n, tokenAmountRaw: 500n }),
      ],
      limits,
    });
    expect(view.unrealized).toEqual({
      totalLamports: 19_000_000n,
      valuedCount: 1,
      unvaluedCount: 1,
    });
    expect(view.openCount).toBe(2);
    expect(view.capitalInUseLamports).toBe(125_000_000n);
    expect(view.winRate).toEqual(new Decimal(25));
  });
});
