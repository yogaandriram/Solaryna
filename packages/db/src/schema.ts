import { SWAP_SIDES, TRADING_MODES } from '@solaryna/core';
import {
  bigint,
  boolean,
  date,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  smallint,
  text,
  tinyint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import {
  ADDRESS_LENGTH,
  SIGNATURE_LENGTH,
  base58,
  createdAt,
  rawAmount,
  updatedAt,
  utcDatetime,
} from './columns';

// Not `serial`: in MySQL that alias adds a redundant UNIQUE index next to the primary key.
function primaryId() {
  return bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey();
}

/** Foreign key to a `primaryId()` column (BIGINT UNSIGNED). */
function idRef(name: string) {
  return bigint(name, { mode: 'number', unsigned: true });
}

const address = (name: string) => base58(name, { length: ADDRESS_LENGTH });
const signature = (name: string) => base58(name, { length: SIGNATURE_LENGTH });
const decimals = (name: string) => tinyint(name, { unsigned: true });
const tradingMode = () => mysqlEnum('mode', TRADING_MODES);

export const trackedWallets = mysqlTable(
  'tracked_wallets',
  {
    id: primaryId(),
    address: address('address').notNull(),
    label: varchar('label', { length: 100 }),
    source: mysqlEnum('source', ['manual', 'discovered']).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    cooldownUntil: utcDatetime('cooldown_until'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('tracked_wallets_address_uq').on(t.address)],
);

/** Daily metric snapshot per wallet. Keyed by address so candidates can be scored before tracking. */
export const walletScores = mysqlTable(
  'wallet_scores',
  {
    id: primaryId(),
    walletAddress: address('wallet_address').notNull(),
    scoreDate: date('score_date', { mode: 'string' }).notNull(),
    windowDays: smallint('window_days', { unsigned: true }).notNull(),
    realizedPnlLamports: rawAmount('realized_pnl_lamports').notNull(),
    tradeCount: int('trade_count', { unsigned: true }).notNull(),
    winRate: decimal('win_rate', { precision: 7, scale: 6 }),
    medianRoi: decimal('median_roi', { precision: 30, scale: 10 }),
    profitConcentration: decimal('profit_concentration', { precision: 7, scale: 6 }),
    avgHoldSeconds: int('avg_hold_seconds', { unsigned: true }),
    medianHoldSeconds: int('median_hold_seconds', { unsigned: true }),
    copyabilityPnlLamports: rawAmount('copyability_pnl_lamports'),
    flags: json('flags').$type<string[]>().notNull(),
    score: decimal('score', { precision: 30, scale: 10 }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('wallet_scores_wallet_date_window_uq').on(
      t.walletAddress,
      t.scoreDate,
      t.windowDays,
    ),
    index('wallet_scores_score_date_idx').on(t.scoreDate),
  ],
);

/** Normalized swaps. Helius may redeliver webhooks: (signature, wallet) is the dedupe key. */
export const swapEvents = mysqlTable(
  'swap_events',
  {
    id: primaryId(),
    signature: signature('signature').notNull(),
    slot: bigint('slot', { mode: 'bigint', unsigned: true }).notNull(),
    blockTime: utcDatetime('block_time').notNull(),
    wallet: address('wallet').notNull(),
    side: mysqlEnum('side', SWAP_SIDES).notNull(),
    tokenMint: address('token_mint').notNull(),
    tokenAmountRaw: rawAmount('token_amount_raw').notNull(),
    tokenDecimals: decimals('token_decimals').notNull(),
    quoteMint: address('quote_mint').notNull(),
    quoteAmountRaw: rawAmount('quote_amount_raw').notNull(),
    quoteDecimals: decimals('quote_decimals').notNull(),
    source: varchar('source', { length: 32 }).notNull(),
    /** Compact raw payload kept for debugging the parser. */
    raw: json('raw'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('swap_events_signature_wallet_uq').on(t.signature, t.wallet),
    index('swap_events_wallet_block_time_idx').on(t.wallet, t.blockTime),
    index('swap_events_token_mint_idx').on(t.tokenMint),
  ],
);

/** Every swap by a tracked wallet, with the risk engine's decision and reasons. */
export const signals = mysqlTable(
  'signals',
  {
    id: primaryId(),
    swapEventId: idRef('swap_event_id')
      .notNull()
      .references(() => swapEvents.id),
    trackedWalletId: idRef('tracked_wallet_id')
      .notNull()
      .references(() => trackedWallets.id),
    mode: tradingMode().notNull(),
    decision: mysqlEnum('decision', ['accepted', 'rejected']).notNull(),
    reasons: json('reasons').$type<string[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('signals_swap_event_uq').on(t.swapEventId),
    index('signals_created_at_idx').on(t.createdAt),
  ],
);

/** Solaryna's holding of one token. All SOL amounts include fees; paper and live never mix. */
export const positions = mysqlTable(
  'positions',
  {
    id: primaryId(),
    mode: tradingMode().notNull(),
    status: mysqlEnum('status', ['open', 'closed']).notNull(),
    tokenMint: address('token_mint').notNull(),
    tokenDecimals: decimals('token_decimals').notNull(),
    trackedWalletId: idRef('tracked_wallet_id').references(() => trackedWallets.id),
    openedFromSignalId: idRef('opened_from_signal_id').references(() => signals.id),
    tokenAmountRaw: rawAmount('token_amount_raw').notNull(),
    costLamports: rawAmount('cost_lamports').notNull(),
    proceedsLamports: rawAmount('proceeds_lamports').notNull(),
    feesLamports: rawAmount('fees_lamports').notNull(),
    realizedPnlLamports: rawAmount('realized_pnl_lamports'),
    closeReason: mysqlEnum('close_reason', [
      'follow_sell',
      'take_profit',
      'stop_loss',
      'max_hold',
      'manual',
    ]),
    openedAt: utcDatetime('opened_at').notNull(),
    closedAt: utcDatetime('closed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('positions_mode_status_idx').on(t.mode, t.status),
    index('positions_token_mint_idx').on(t.tokenMint),
  ],
);

/** One buy/sell executed by Solaryna. Live amounts come from the confirmed transaction. */
export const trades = mysqlTable(
  'trades',
  {
    id: primaryId(),
    positionId: idRef('position_id')
      .notNull()
      .references(() => positions.id),
    /** Null for exits not triggered by a signal (take-profit, stop-loss, max hold). */
    signalId: idRef('signal_id').references(() => signals.id),
    mode: tradingMode().notNull(),
    side: mysqlEnum('side', SWAP_SIDES).notNull(),
    status: mysqlEnum('status', ['simulated', 'pending', 'confirmed', 'failed']).notNull(),
    tokenMint: address('token_mint').notNull(),
    tokenAmountRaw: rawAmount('token_amount_raw').notNull(),
    tokenDecimals: decimals('token_decimals').notNull(),
    /** SOL spent (buy) or received (sell), excluding fees. */
    solAmountLamports: rawAmount('sol_amount_lamports').notNull(),
    priceSol: decimal('price_sol', { precision: 50, scale: 30 }),
    networkFeeLamports: rawAmount('network_fee_lamports').notNull(),
    priorityFeeLamports: rawAmount('priority_fee_lamports').notNull(),
    dexFeeLamports: rawAmount('dex_fee_lamports').notNull(),
    slippageBps: int('slippage_bps'),
    txSignature: signature('tx_signature'),
    /** Snapshot of the Jupiter quote the trade was based on. */
    quote: json('quote'),
    error: text('error'),
    executedAt: utcDatetime('executed_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('trades_tx_signature_uq').on(t.txSignature),
    index('trades_position_idx').on(t.positionId),
    index('trades_mode_executed_at_idx').on(t.mode, t.executedAt),
  ],
);

/** Token metadata and liquidity cache. Name/symbol are untrusted on-chain text. */
export const tokens = mysqlTable('tokens', {
  mint: address('mint').primaryKey(),
  symbol: varchar('symbol', { length: 64 }),
  name: varchar('name', { length: 255 }),
  decimals: decimals('decimals').notNull(),
  priceUsd: decimal('price_usd', { precision: 50, scale: 30 }),
  liquidityUsd: decimal('liquidity_usd', { precision: 30, scale: 6 }),
  mintAuthorityActive: boolean('mint_authority_active'),
  freezeAuthorityActive: boolean('freeze_authority_active'),
  tokenCreatedAt: utcDatetime('token_created_at'),
  isBlacklisted: boolean('is_blacklisted').notNull().default(false),
  marketDataFetchedAt: utcDatetime('market_data_fetched_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Runtime settings, e.g. `trading_paused` (kill switch) and risk limits changed at runtime. */
export const settings = mysqlTable('settings', {
  name: varchar('name', { length: 64 }).primaryKey(),
  value: json('value').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Who changed trading behaviour, how, and when (Telegram commands, dashboard actions). */
export const auditLog = mysqlTable(
  'audit_log',
  {
    id: primaryId(),
    actor: varchar('actor', { length: 64 }).notNull(),
    action: varchar('action', { length: 64 }).notNull(),
    details: json('details'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_created_at_idx').on(t.createdAt)],
);
