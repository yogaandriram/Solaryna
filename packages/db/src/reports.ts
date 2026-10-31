import {
  Decimal,
  type ReportPosition,
  type ReportSignal,
  type ReportTrade,
  type TradingMode,
  type WalletLeg,
} from '@solaryna/core';
import { aliasedTable, and, asc, desc, eq, gt, gte, lt } from 'drizzle-orm';
import type { Database } from './client';
import { positions, signals, swapEvents, tokens, trackedWallets, trades } from './schema';

// Read-only queries feeding the daily/weekly reports (aggregated in @solaryna/core).

const toDecimal = (value: string | null) => (value === null ? null : new Decimal(value));

/** Trades executed in `[from, to)`. */
export async function listReportTrades(
  db: Database,
  mode: TradingMode,
  from: Date,
  to: Date,
): Promise<ReportTrade[]> {
  return db
    .select({
      side: trades.side,
      reason: trades.reason,
      networkFeeLamports: trades.networkFeeLamports,
      priorityFeeLamports: trades.priorityFeeLamports,
      dexFeeLamports: trades.dexFeeLamports,
      realizedPnlLamports: trades.realizedPnlLamports,
    })
    .from(trades)
    .where(and(eq(trades.mode, mode), gte(trades.executedAt, from), lt(trades.executedAt, to)))
    .orderBy(asc(trades.executedAt), asc(trades.id));
}

/** Signals for wallet buys, decided in `[from, to)`. */
export async function listReportBuySignals(
  db: Database,
  mode: TradingMode,
  from: Date,
  to: Date,
): Promise<ReportSignal[]> {
  return db
    .select({
      walletId: signals.trackedWalletId,
      walletAddress: trackedWallets.address,
      walletLabel: trackedWallets.label,
      decision: signals.decision,
      reasons: signals.reasons,
    })
    .from(signals)
    .innerJoin(swapEvents, eq(swapEvents.id, signals.swapEventId))
    .innerJoin(trackedWallets, eq(trackedWallets.id, signals.trackedWalletId))
    .where(
      and(
        eq(signals.mode, mode),
        eq(swapEvents.side, 'buy'),
        gte(signals.createdAt, from),
        lt(signals.createdAt, to),
      ),
    )
    .orderBy(asc(signals.createdAt), asc(signals.id));
}

const entrySwap = aliasedTable(swapEvents, 'entry_swap');

/**
 * Positions closed in `[from, to)`, with what the wallet itself did: the buy that opened the
 * position and the wallet's sells of the token after that buy, up to `to`.
 */
export async function listClosedReportPositions(
  db: Database,
  mode: TradingMode,
  from: Date,
  to: Date,
): Promise<ReportPosition[]> {
  const rows = await db
    .select({
      position: positions,
      walletAddress: trackedWallets.address,
      walletLabel: trackedWallets.label,
      tokenSymbol: tokens.symbol,
      entry: entrySwap,
    })
    .from(positions)
    .leftJoin(trackedWallets, eq(trackedWallets.id, positions.trackedWalletId))
    .leftJoin(tokens, eq(tokens.mint, positions.tokenMint))
    .leftJoin(signals, eq(signals.id, positions.openedFromSignalId))
    .leftJoin(entrySwap, eq(entrySwap.id, signals.swapEventId))
    .where(
      and(
        eq(positions.mode, mode),
        eq(positions.status, 'closed'),
        gte(positions.closedAt, from),
        lt(positions.closedAt, to),
      ),
    )
    .orderBy(asc(positions.closedAt), asc(positions.id));

  const leg = (swap: {
    quoteMint: string;
    quoteAmountRaw: bigint;
    quoteDecimals: number;
    tokenAmountRaw: bigint;
  }): WalletLeg => ({
    quoteMint: swap.quoteMint,
    quoteAmountRaw: swap.quoteAmountRaw,
    quoteDecimals: swap.quoteDecimals,
    tokenAmountRaw: swap.tokenAmountRaw,
  });

  const result: ReportPosition[] = [];
  for (const { position, walletAddress, walletLabel, tokenSymbol, entry } of rows) {
    const exits =
      entry === null
        ? []
        : await db
            .select()
            .from(swapEvents)
            .where(
              and(
                eq(swapEvents.wallet, entry.wallet),
                eq(swapEvents.tokenMint, position.tokenMint),
                eq(swapEvents.side, 'sell'),
                gt(swapEvents.blockTime, entry.blockTime),
                lt(swapEvents.blockTime, to),
              ),
            )
            .orderBy(asc(swapEvents.blockTime), asc(swapEvents.id));
    const solUsd = async (side: 'buy' | 'sell') => {
      const [row] = await db
        .select({ solUsdPrice: trades.solUsdPrice })
        .from(trades)
        .where(and(eq(trades.positionId, position.id), eq(trades.side, side)))
        .orderBy(desc(trades.executedAt), desc(trades.id))
        .limit(1);
      return toDecimal(row?.solUsdPrice ?? null);
    };

    result.push({
      id: position.id,
      tokenMint: position.tokenMint,
      tokenSymbol,
      tokenDecimals: position.tokenDecimals,
      walletId: position.trackedWalletId,
      walletAddress,
      walletLabel,
      closeReason: position.closeReason ?? 'manual',
      costLamports: position.costLamports,
      initialTokenAmountRaw: position.initialTokenAmountRaw,
      proceedsLamports: position.proceedsLamports,
      feesLamports: position.feesLamports,
      realizedPnlLamports: position.realizedPnlLamports ?? 0n,
      walletEntry: entry === null ? null : leg(entry),
      walletExits: exits.map(leg),
      buySolUsd: await solUsd('buy'),
      exitSolUsd: await solUsd('sell'),
    });
  }
  return result;
}
