import type { Decimal } from '../decimal';

/** Stable reason codes; stored with signals and counted in reports. */
export const RISK_REASON_CODES = [
  'trading_paused',
  'max_open_positions',
  'already_holding',
  'daily_loss_limit',
  'token_data_unavailable',
  'liquidity_below_min',
  'mint_authority_active',
  'freeze_authority_active',
  'token_flagged_suspicious',
  'token_blacklisted',
  'wallet_cooldown',
  'signal_too_old',
  'price_impact_too_high',
  'no_route',
  /** Jupiter answered the buy quote with an error (recorded with the error text). */
  'quote_failed',
  // Sell signals only.
  'not_holding',
  'sell_amount_zero',
] as const;
export type RiskReasonCode = (typeof RISK_REASON_CODES)[number];

/** A reason with the numbers behind it. Decimals and bigints are stored as strings. */
export interface RiskReason {
  code: RiskReasonCode;
  detail?: Record<string, string | number | boolean | null>;
}

export interface RiskResult {
  decision: 'accepted' | 'rejected';
  reasons: RiskReason[];
}

export interface RiskLimitsInput {
  maxOpenPositions: number;
  dailyLossLimitLamports: bigint;
  minLiquidityUsd: Decimal;
  maxSlippageBps: number;
  maxSignalAgeSeconds: number;
}

export interface TokenMarketData {
  /** USD liquidity; null when unknown. */
  liquidityUsd: Decimal | null;
  mintAuthorityActive: boolean;
  freezeAuthorityActive: boolean;
  suspicious: boolean;
  createdAt: Date | null;
}

/** Rules that need only the database (checked before any Jupiter request). */
export interface LocalRiskInput {
  limits: RiskLimitsInput;
  tradingPaused: boolean;
  /** Open positions plus buys in flight, excluding this token. */
  openPositionCount: number;
  holdingToken: boolean;
  realizedPnlTodayLamports: bigint;
  tokenBlacklisted: boolean;
  walletCooldownUntil: Date | null;
  signalBlockTime: Date;
  now: Date;
}

/** Rules that need Jupiter token data and the buy quote. */
export interface MarketRiskInput {
  limits: RiskLimitsInput;
  token: TokenMarketData | null;
  /** null when Jupiter has no route. */
  quote: { priceImpactPct: Decimal } | null;
}
