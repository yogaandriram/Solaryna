import type { RiskReason, SwapSide, TradingMode } from '@solaryna/core';
import { and, asc, desc, eq, gte, isNotNull, lt, sql, type SQL } from 'drizzle-orm';
import type { Database } from './client';
import type { TrackedWallet } from './queries';
import {
  positions,
  signals,
  swapEvents,
  tokens,
  trackedWallets,
  trades,
  walletScores,
} from './schema';
import { sumRealizedPnl, type PositionRow, type TradeRow } from './trading';

// Read-only queries for the dashboard. Every query is filtered by mode: paper and live data are
// never mixed. Amounts stay bigint; the web formats them.

export type SwapEventRow = typeof swapEvents.$inferSelect;

export interface Page {
  limit: number;
  offset: number;
}

export interface Range {
  from: Date;
  to: Date;
}

const toBigInt = (value: string | number | null | undefined) =>
  value === null || value === undefined ? 0n : BigInt(String(value).split('.')[0] ?? '0');
const toNumber = (value: string | number | null | undefined) => Number(value ?? 0);

export interface DashboardPosition {
  position: PositionRow;
  tokenSymbol: string | null;
  walletId: number | null;
  walletAddress: string | null;
  walletLabel: string | null;
}

function selectPositions(db: Database) {
  return db
    .select({
      position: positions,
      tokenSymbol: tokens.symbol,
      walletId: trackedWallets.id,
      walletAddress: trackedWallets.address,
      walletLabel: trackedWallets.label,
    })
    .from(positions)
    .leftJoin(trackedWallets, eq(trackedWallets.id, positions.trackedWalletId))
    .leftJoin(tokens, eq(tokens.mint, positions.tokenMint));
}

export async function listOpenDashboardPositions(
  db: Database,
  mode: TradingMode,
): Promise<DashboardPosition[]> {
  return selectPositions(db)
    .where(and(eq(positions.mode, mode), eq(positions.status, 'open')))
    .orderBy(asc(positions.openedAt), asc(positions.id));
}

export async function listWalletOpenPositions(
  db: Database,
  mode: TradingMode,
  walletId: number,
): Promise<DashboardPosition[]> {
  return selectPositions(db)
    .where(
      and(
        eq(positions.mode, mode),
        eq(positions.status, 'open'),
        eq(positions.trackedWalletId, walletId),
      ),
    )
    .orderBy(asc(positions.openedAt), asc(positions.id));
}

export async function listClosedDashboardPositions(
  db: Database,
  mode: TradingMode,
  page: Page,
  walletId?: number,
): Promise<DashboardPosition[]> {
  const conditions: SQL[] = [eq(positions.mode, mode), eq(positions.status, 'closed')];
  if (walletId !== undefined) {
    conditions.push(eq(positions.trackedWalletId, walletId));
  }
  return selectPositions(db)
    .where(and(...conditions))
    .orderBy(desc(positions.closedAt), desc(positions.id))
    .limit(page.limit)
    .offset(page.offset);
}

export async function getDashboardPosition(
  db: Database,
  id: number,
): Promise<(DashboardPosition & { trades: TradeRow[] }) | null> {
  const [row] = await selectPositions(db).where(eq(positions.id, id));
  if (row === undefined) {
    return null;
  }
  const positionTrades = await db
    .select()
    .from(trades)
    .where(eq(trades.positionId, id))
    .orderBy(asc(trades.executedAt), asc(trades.id));
  return { ...row, trades: positionTrades };
}

export interface DashboardSignal {
  id: number;
  createdAt: Date;
  decision: 'accepted' | 'rejected';
  reasons: RiskReason[];
  side: SwapSide;
  signature: string;
  blockTime: Date;
  tokenMint: string;
  tokenSymbol: string | null;
  tokenAmountRaw: bigint;
  tokenDecimals: number;
  quoteMint: string;
  quoteAmountRaw: bigint;
  quoteDecimals: number;
  walletId: number;
  walletAddress: string;
  walletLabel: string | null;
}

export interface SignalFilter {
  decision?: 'accepted' | 'rejected';
  side?: SwapSide;
  walletId?: number;
}

export async function listDashboardSignals(
  db: Database,
  mode: TradingMode,
  filter: SignalFilter,
  page: Page,
): Promise<DashboardSignal[]> {
  const conditions: SQL[] = [eq(signals.mode, mode)];
  if (filter.decision !== undefined) {
    conditions.push(eq(signals.decision, filter.decision));
  }
  if (filter.side !== undefined) {
    conditions.push(eq(swapEvents.side, filter.side));
  }
  if (filter.walletId !== undefined) {
    conditions.push(eq(signals.trackedWalletId, filter.walletId));
  }
  return db
    .select({
      id: signals.id,
      createdAt: signals.createdAt,
      decision: signals.decision,
      reasons: signals.reasons,
      side: swapEvents.side,
      signature: swapEvents.signature,
      blockTime: swapEvents.blockTime,
      tokenMint: swapEvents.tokenMint,
      tokenSymbol: tokens.symbol,
      tokenAmountRaw: swapEvents.tokenAmountRaw,
      tokenDecimals: swapEvents.tokenDecimals,
      quoteMint: swapEvents.quoteMint,
      quoteAmountRaw: swapEvents.quoteAmountRaw,
      quoteDecimals: swapEvents.quoteDecimals,
      walletId: trackedWallets.id,
      walletAddress: trackedWallets.address,
      walletLabel: trackedWallets.label,
    })
    .from(signals)
    .innerJoin(swapEvents, eq(swapEvents.id, signals.swapEventId))
    .innerJoin(trackedWallets, eq(trackedWallets.id, signals.trackedWalletId))
    .leftJoin(tokens, eq(tokens.mint, swapEvents.tokenMint))
    .where(and(...conditions))
    .orderBy(desc(signals.id))
    .limit(page.limit)
    .offset(page.offset);
}

export interface DashboardTrade {
  trade: TradeRow;
  tokenSymbol: string | null;
}

export async function listDashboardTrades(
  db: Database,
  mode: TradingMode,
  page: Page,
): Promise<DashboardTrade[]> {
  return db
    .select({ trade: trades, tokenSymbol: tokens.symbol })
    .from(trades)
    .leftJoin(tokens, eq(tokens.mint, trades.tokenMint))
    .where(eq(trades.mode, mode))
    .orderBy(desc(trades.executedAt), desc(trades.id))
    .limit(page.limit)
    .offset(page.offset);
}

/** Realized PnL of each sell executed in `[from, to)`, oldest first (for daily buckets). */
export async function listRealizedPnlPoints(
  db: Database,
  mode: TradingMode,
  from: Date,
  to: Date,
): Promise<{ at: Date; pnlLamports: bigint }[]> {
  const rows = await db
    .select({ at: trades.executedAt, pnl: trades.realizedPnlLamports })
    .from(trades)
    .where(
      and(
        eq(trades.mode, mode),
        isNotNull(trades.realizedPnlLamports),
        gte(trades.executedAt, from),
        lt(trades.executedAt, to),
      ),
    )
    .orderBy(asc(trades.executedAt), asc(trades.id));
  return rows.map((row) => ({ at: row.at, pnlLamports: row.pnl ?? 0n }));
}

export interface OverviewTotals {
  realizedTodayLamports: bigint;
  realizedWeekLamports: bigint;
  realizedAllLamports: bigint;
  /** Network + priority fees of trades in the week (the DEX fee is already in the quote). */
  feesWeekLamports: bigint;
  closedCount: number;
  winCount: number;
  signalsToday: { accepted: number; rejected: number };
}

export async function getOverviewTotals(
  db: Database,
  mode: TradingMode,
  today: Range,
  week: Range,
): Promise<OverviewTotals> {
  const [realizedToday, realizedWeek, [all], [fees], [closed], decisions] = await Promise.all([
    sumRealizedPnl(db, mode, today.from, today.to),
    sumRealizedPnl(db, mode, week.from, week.to),
    db
      .select({ total: sql<string | null>`SUM(${trades.realizedPnlLamports})` })
      .from(trades)
      .where(eq(trades.mode, mode)),
    db
      .select({
        total: sql<
          string | null
        >`SUM(${trades.networkFeeLamports} + ${trades.priorityFeeLamports})`,
      })
      .from(trades)
      .where(
        and(
          eq(trades.mode, mode),
          gte(trades.executedAt, week.from),
          lt(trades.executedAt, week.to),
        ),
      ),
    db
      .select({
        closed: sql<string>`COUNT(*)`,
        wins: sql<string | null>`SUM(${positions.realizedPnlLamports} > 0)`,
      })
      .from(positions)
      .where(and(eq(positions.mode, mode), eq(positions.status, 'closed'))),
    db
      .select({ decision: signals.decision, count: sql<string>`COUNT(*)` })
      .from(signals)
      .where(
        and(
          eq(signals.mode, mode),
          gte(signals.createdAt, today.from),
          lt(signals.createdAt, today.to),
        ),
      )
      .groupBy(signals.decision),
  ]);
  const countOf = (decision: 'accepted' | 'rejected') =>
    toNumber(decisions.find((row) => row.decision === decision)?.count);
  return {
    realizedTodayLamports: realizedToday,
    realizedWeekLamports: realizedWeek,
    realizedAllLamports: toBigInt(all?.total),
    feesWeekLamports: toBigInt(fees?.total),
    closedCount: toNumber(closed?.closed),
    winCount: toNumber(closed?.wins),
    signalsToday: { accepted: countOf('accepted'), rejected: countOf('rejected') },
  };
}

export interface WalletStats {
  /** Buy signals since the window start. */
  buySignals: number;
  /** Of those, the ones that were followed. */
  followed: number;
  closedPositions: number;
  /** Closed positions with a positive realized PnL. */
  wins: number;
  realizedPnlLamports: bigint;
  openPositions: number;
}

export interface DashboardWallet {
  wallet: TrackedWallet;
  stats: WalletStats;
  /** Latest `wallet_scores.score` (M4); null until scoring runs. */
  latestScore: string | null;
}

const EMPTY_STATS: WalletStats = {
  buySignals: 0,
  followed: 0,
  closedPositions: 0,
  wins: 0,
  realizedPnlLamports: 0n,
  openPositions: 0,
};

async function walletStats(
  db: Database,
  mode: TradingMode,
  signalsSince: Date,
  walletId?: number,
): Promise<Map<number, WalletStats>> {
  const signalConditions: SQL[] = [
    eq(signals.mode, mode),
    eq(swapEvents.side, 'buy'),
    gte(signals.createdAt, signalsSince),
  ];
  const positionConditions: SQL[] = [
    eq(positions.mode, mode),
    isNotNull(positions.trackedWalletId),
  ];
  if (walletId !== undefined) {
    signalConditions.push(eq(signals.trackedWalletId, walletId));
    positionConditions.push(eq(positions.trackedWalletId, walletId));
  }
  const [signalRows, positionRows] = await Promise.all([
    db
      .select({
        walletId: signals.trackedWalletId,
        total: sql<string>`COUNT(*)`,
        followed: sql<string | null>`SUM(${signals.decision} = 'accepted')`,
      })
      .from(signals)
      .innerJoin(swapEvents, eq(swapEvents.id, signals.swapEventId))
      .where(and(...signalConditions))
      .groupBy(signals.trackedWalletId),
    db
      .select({
        walletId: positions.trackedWalletId,
        closed: sql<string | null>`SUM(${positions.status} = 'closed')`,
        wins: sql<
          string | null
        >`SUM(${positions.status} = 'closed' AND ${positions.realizedPnlLamports} > 0)`,
        realized: sql<
          string | null
        >`SUM(CASE WHEN ${positions.status} = 'closed' THEN ${positions.realizedPnlLamports} ELSE 0 END)`,
        open: sql<string | null>`SUM(${positions.status} = 'open')`,
      })
      .from(positions)
      .where(and(...positionConditions))
      .groupBy(positions.trackedWalletId),
  ]);
  const stats = new Map<number, WalletStats>();
  const entry = (id: number) => {
    let current = stats.get(id);
    if (current === undefined) {
      current = { ...EMPTY_STATS };
      stats.set(id, current);
    }
    return current;
  };
  for (const row of signalRows) {
    const current = entry(row.walletId);
    current.buySignals = toNumber(row.total);
    current.followed = toNumber(row.followed);
  }
  for (const row of positionRows) {
    if (row.walletId === null) {
      continue;
    }
    const current = entry(row.walletId);
    current.closedPositions = toNumber(row.closed);
    current.wins = toNumber(row.wins);
    current.realizedPnlLamports = toBigInt(row.realized);
    current.openPositions = toNumber(row.open);
  }
  return stats;
}

async function latestScores(db: Database, addresses?: string[]): Promise<Map<string, string>> {
  const latest = db
    .select({
      address: walletScores.walletAddress,
      scoreDate: sql<string>`MAX(${walletScores.scoreDate})`.as('latest_date'),
    })
    .from(walletScores)
    .groupBy(walletScores.walletAddress)
    .as('latest');
  const rows = await db
    .select({ address: walletScores.walletAddress, score: walletScores.score })
    .from(walletScores)
    .innerJoin(
      latest,
      and(
        eq(latest.address, walletScores.walletAddress),
        eq(latest.scoreDate, walletScores.scoreDate),
      ),
    )
    .orderBy(desc(walletScores.windowDays));
  const scores = new Map<string, string>();
  for (const row of rows) {
    if (row.score !== null && !scores.has(row.address)) {
      if (addresses === undefined || addresses.includes(row.address)) {
        scores.set(row.address, row.score);
      }
    }
  }
  return scores;
}

/** Every tracked wallet with its stats in one mode; active wallets first. */
export async function listDashboardWallets(
  db: Database,
  mode: TradingMode,
  signalsSince: Date,
): Promise<DashboardWallet[]> {
  const [wallets, stats, scores] = await Promise.all([
    db.select().from(trackedWallets).orderBy(desc(trackedWallets.isActive), asc(trackedWallets.id)),
    walletStats(db, mode, signalsSince),
    latestScores(db),
  ]);
  return wallets.map((wallet) => ({
    wallet,
    stats: stats.get(wallet.id) ?? { ...EMPTY_STATS },
    latestScore: scores.get(wallet.address) ?? null,
  }));
}

export async function getTrackedWallet(
  db: Database,
  id: number,
): Promise<TrackedWallet | undefined> {
  const [row] = await db.select().from(trackedWallets).where(eq(trackedWallets.id, id));
  return row;
}

/** One wallet with its stats and latest 50 swaps (any mode: swaps are the wallet's own). */
export async function getDashboardWallet(
  db: Database,
  id: number,
  mode: TradingMode,
  signalsSince: Date,
): Promise<{ wallet: DashboardWallet; swaps: SwapEventRow[] } | null> {
  const wallet = await getTrackedWallet(db, id);
  if (wallet === undefined) {
    return null;
  }
  const [stats, scores, swaps] = await Promise.all([
    walletStats(db, mode, signalsSince, id),
    latestScores(db, [wallet.address]),
    db
      .select()
      .from(swapEvents)
      .where(eq(swapEvents.wallet, wallet.address))
      .orderBy(desc(swapEvents.blockTime), desc(swapEvents.id))
      .limit(50),
  ]);
  return {
    wallet: {
      wallet,
      stats: stats.get(id) ?? { ...EMPTY_STATS },
      latestScore: scores.get(wallet.address) ?? null,
    },
    swaps,
  };
}
