import type { Decimal, TradingMode } from '@solaryna/core';
import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import type { Database } from './client';
import type { AuditActor } from './queries';
import { auditLog, positions, settings, signals, tokens, trackedWallets, trades } from './schema';

export type SignalRow = typeof signals.$inferSelect;
export type PositionRow = typeof positions.$inferSelect;
export type TradeRow = typeof trades.$inferSelect;
export type NewSignal = typeof signals.$inferInsert;
export type NewPosition = typeof positions.$inferInsert;
export type NewTrade = typeof trades.$inferInsert;

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Kill switch: `true` blocks every execution. A missing row means not paused. */
export const TRADING_PAUSED_SETTING = 'trading_paused';

export async function isTradingPaused(db: Database): Promise<boolean> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.name, TRADING_PAUSED_SETTING));
  return row?.value === true;
}

/** Sets the kill switch and audits the change. Returns false when it already had that value. */
export async function setTradingPaused(
  db: Database,
  paused: boolean,
  audit: AuditActor,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.name, TRADING_PAUSED_SETTING))
      .for('update');
    if ((row?.value === true) === paused) {
      return false;
    }
    await tx
      .insert(settings)
      .values({ name: TRADING_PAUSED_SETTING, value: paused })
      .onDuplicateKeyUpdate({ set: { value: paused, updatedAt: new Date() } });
    await tx.insert(auditLog).values({
      actor: audit.actor,
      action: paused ? 'trading.pause' : 'trading.resume',
      details: { paused },
    });
    return true;
  });
}

/** Runtime risk limit overrides (JSON object of strings); see @solaryna/core runtime-limits. */
export const RISK_LIMITS_SETTING = 'risk_limits';

export async function getRiskLimitOverrides(db: Database): Promise<unknown> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.name, RISK_LIMITS_SETTING));
  return row?.value ?? null;
}

/** Per key: the stored override before and after; null means "follow .env". */
export type LimitChanges = Record<string, { from: string | null; to: string | null }>;

function storedStrings(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/**
 * Replaces the runtime limit overrides and audits what changed, atomically. Nothing is written
 * when the overrides are unchanged.
 */
export async function setRiskLimitOverrides(
  db: Database,
  next: Record<string, string>,
  audit: AuditActor,
): Promise<{ changes: LimitChanges }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.name, RISK_LIMITS_SETTING))
      .for('update');
    const previous = storedStrings(row?.value);
    const changes: LimitChanges = {};
    for (const key of [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort()) {
      const from = previous[key] ?? null;
      const to = next[key] ?? null;
      if (from !== to) {
        changes[key] = { from, to };
      }
    }
    if (Object.keys(changes).length === 0) {
      return { changes };
    }
    await tx
      .insert(settings)
      .values({ name: RISK_LIMITS_SETTING, value: next })
      .onDuplicateKeyUpdate({ set: { value: next, updatedAt: new Date() } });
    await tx.insert(auditLog).values({
      actor: audit.actor,
      action: 'limits.update',
      details: { changes },
    });
    return { changes };
  });
}

export async function getSettingString(db: Database, name: string): Promise<string | null> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.name, name));
  return typeof row?.value === 'string' ? row.value : null;
}

export async function setSettingString(db: Database, name: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ name, value })
    .onDuplicateKeyUpdate({ set: { value, updatedAt: new Date() } });
}

export async function insertSignal(db: Database | Transaction, signal: NewSignal): Promise<number> {
  const [row] = await db.insert(signals).values(signal).$returningId();
  if (row === undefined) {
    throw new Error('Insert into signals returned no id');
  }
  return row.id;
}

/** Stores an accepted buy: its signal, the new position and the buy trade, atomically. */
export async function openPosition(
  db: Database,
  input: {
    signal: NewSignal;
    position: Omit<NewPosition, 'openedFromSignalId'>;
    trade: Omit<NewTrade, 'positionId' | 'signalId'>;
  },
): Promise<{ signalId: number; positionId: number; tradeId: number }> {
  return db.transaction(async (tx) => {
    const signalId = await insertSignal(tx, input.signal);
    const [position] = await tx
      .insert(positions)
      .values({ ...input.position, openedFromSignalId: signalId })
      .$returningId();
    if (position === undefined) {
      throw new Error('Insert into positions returned no id');
    }
    const [trade] = await tx
      .insert(trades)
      .values({ ...input.trade, positionId: position.id, signalId })
      .$returningId();
    if (trade === undefined) {
      throw new Error('Insert into trades returned no id');
    }
    return { signalId, positionId: position.id, tradeId: trade.id };
  });
}

/** Stores a sell (with its signal for follow-sells) and the updated position, atomically. */
export async function recordSell(
  db: Database,
  input: {
    signal: NewSignal | null;
    positionId: number;
    trade: Omit<NewTrade, 'positionId' | 'signalId'>;
    position: Pick<
      NewPosition,
      | 'tokenAmountRaw'
      | 'proceedsLamports'
      | 'feesLamports'
      | 'realizedPnlLamports'
      | 'status'
      | 'closeReason'
      | 'closedAt'
    >;
  },
): Promise<{ signalId: number | null; tradeId: number }> {
  return db.transaction(async (tx) => {
    const signalId = input.signal === null ? null : await insertSignal(tx, input.signal);
    const [trade] = await tx
      .insert(trades)
      .values({ ...input.trade, positionId: input.positionId, signalId })
      .$returningId();
    if (trade === undefined) {
      throw new Error('Insert into trades returned no id');
    }
    await tx
      .update(positions)
      .set({ ...input.position, updatedAt: new Date() })
      .where(eq(positions.id, input.positionId));
    return { signalId, tradeId: trade.id };
  });
}

export async function listOpenPositions(db: Database, mode: TradingMode): Promise<PositionRow[]> {
  return db
    .select()
    .from(positions)
    .where(and(eq(positions.mode, mode), eq(positions.status, 'open')))
    .orderBy(asc(positions.openedAt), asc(positions.id));
}

export async function findOpenPositionByToken(
  db: Database,
  mode: TradingMode,
  tokenMint: string,
): Promise<PositionRow | undefined> {
  const [row] = await db
    .select()
    .from(positions)
    .where(
      and(
        eq(positions.mode, mode),
        eq(positions.status, 'open'),
        eq(positions.tokenMint, tokenMint),
      ),
    )
    .limit(1);
  return row;
}

export async function getPosition(db: Database, id: number): Promise<PositionRow | undefined> {
  const [row] = await db.select().from(positions).where(eq(positions.id, id));
  return row;
}

/** Realized PnL of trades executed in `[from, to)`. */
export async function sumRealizedPnl(
  db: Database,
  mode: TradingMode,
  from: Date,
  to: Date,
): Promise<bigint> {
  const [row] = await db
    .select({ total: sql<string | null>`SUM(${trades.realizedPnlLamports})` })
    .from(trades)
    .where(and(eq(trades.mode, mode), gte(trades.executedAt, from), lt(trades.executedAt, to)));
  return BigInt(row?.total ?? '0');
}

/**
 * Stores the monitor's latest valuation of an open position. Skipped (false) when the position
 * closed or its amount changed since the quote, so a stale quote never overwrites a newer state.
 */
export async function savePositionValuation(
  db: Database,
  input: { positionId: number; tokenAmountRaw: bigint; netValueLamports: bigint | null; at: Date },
): Promise<boolean> {
  const [result] = await db
    .update(positions)
    .set({ lastValueLamports: input.netValueLamports, lastValuedAt: input.at })
    .where(
      and(
        eq(positions.id, input.positionId),
        eq(positions.status, 'open'),
        eq(positions.tokenAmountRaw, input.tokenAmountRaw),
      ),
    );
  return result.affectedRows > 0;
}

export async function getWalletCooldown(db: Database, walletId: number): Promise<Date | null> {
  const [row] = await db
    .select({ cooldownUntil: trackedWallets.cooldownUntil })
    .from(trackedWallets)
    .where(eq(trackedWallets.id, walletId));
  return row?.cooldownUntil ?? null;
}

export async function isTokenBlacklisted(db: Database, mint: string): Promise<boolean> {
  const [row] = await db
    .select({ isBlacklisted: tokens.isBlacklisted })
    .from(tokens)
    .where(eq(tokens.mint, mint));
  return row?.isBlacklisted ?? false;
}

/** Caches Jupiter market data for a token; name and symbol are left as they are. */
export async function saveTokenMarketData(
  db: Database,
  input: {
    mint: string;
    decimals: number;
    liquidityUsd: Decimal | null;
    mintAuthorityActive: boolean;
    freezeAuthorityActive: boolean;
    tokenCreatedAt: Date | null;
    fetchedAt: Date;
  },
): Promise<void> {
  const market = {
    decimals: input.decimals,
    liquidityUsd: input.liquidityUsd?.toFixed(6) ?? null,
    mintAuthorityActive: input.mintAuthorityActive,
    freezeAuthorityActive: input.freezeAuthorityActive,
    tokenCreatedAt: input.tokenCreatedAt,
    marketDataFetchedAt: input.fetchedAt,
  };
  await db
    .insert(tokens)
    .values({ mint: input.mint, ...market })
    .onDuplicateKeyUpdate({ set: { ...market, updatedAt: new Date() } });
}
