import {
  Decimal,
  estimatedPnlLamports,
  positionStateOf,
  remainingCostLamports,
} from '@solaryna/core';
import type { DashboardPosition, OverviewTotals, PositionRow } from '@solaryna/db';

export interface OverviewView {
  realizedTodayLamports: bigint;
  realizedWeekLamports: bigint;
  realizedAllLamports: bigint;
  feesWeekLamports: bigint;
  openCount: number;
  maxOpen: number;
  capitalInUseLamports: bigint;
  /** Estimated PnL of selling the open positions now; only positions with a valuation count. */
  unrealized: { totalLamports: bigint; valuedCount: number; unvaluedCount: number };
  /** Percent of closed positions with a positive PnL; null before the first close. */
  winRate: Decimal | null;
  closedCount: number;
  winCount: number;
  signalsToday: { accepted: number; rejected: number };
}

/** Estimated PnL from the monitor's last valuation; null when there is none (or no route). */
export function positionEstimate(position: PositionRow): bigint | null {
  return position.lastValueLamports === null
    ? null
    : estimatedPnlLamports(positionStateOf(position), position.lastValueLamports);
}

export function buildOverview(input: {
  totals: OverviewTotals;
  open: readonly DashboardPosition[];
  limits: { maxOpenPositions: number };
}): OverviewView {
  const { totals, open } = input;
  let capitalInUseLamports = 0n;
  const unrealized = { totalLamports: 0n, valuedCount: 0, unvaluedCount: 0 };
  for (const { position } of open) {
    capitalInUseLamports += remainingCostLamports(positionStateOf(position));
    const estimate = positionEstimate(position);
    if (estimate === null) {
      unrealized.unvaluedCount += 1;
    } else {
      unrealized.totalLamports += estimate;
      unrealized.valuedCount += 1;
    }
  }
  return {
    realizedTodayLamports: totals.realizedTodayLamports,
    realizedWeekLamports: totals.realizedWeekLamports,
    realizedAllLamports: totals.realizedAllLamports,
    feesWeekLamports: totals.feesWeekLamports,
    openCount: open.length,
    maxOpen: input.limits.maxOpenPositions,
    capitalInUseLamports,
    unrealized,
    winRate:
      totals.closedCount === 0
        ? null
        : new Decimal(totals.winCount).div(totals.closedCount).times(100),
    closedCount: totals.closedCount,
    winCount: totals.winCount,
    signalsToday: totals.signalsToday,
  };
}
