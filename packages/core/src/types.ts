export const TRADING_MODES = ['paper', 'live'] as const;
export type TradingMode = (typeof TRADING_MODES)[number];

export const SWAP_SIDES = ['buy', 'sell'] as const;
export type SwapSide = (typeof SWAP_SIDES)[number];

/** Why Solaryna executed a trade. */
export const TRADE_REASONS = [
  'copy_buy',
  'follow_sell',
  'take_profit',
  'stop_loss',
  'max_hold',
  'unsellable',
] as const;
export type TradeReason = (typeof TRADE_REASONS)[number];

/** Why a position was closed. `unsellable` = no route past max hold, closed at value 0. */
export const CLOSE_REASONS = [
  'follow_sell',
  'take_profit',
  'stop_loss',
  'max_hold',
  'unsellable',
  'manual',
] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

export const SWAP_SOURCES = [
  'pumpfun',
  'pumpswap',
  'raydium',
  'meteora',
  'orca',
  'jupiter',
  'unknown',
] as const;
export type SwapSource = (typeof SWAP_SOURCES)[number];

/**
 * A swap normalized from an on-chain transaction. Amounts are raw (smallest unit) and
 * always travel with their decimals. `quoteMint` is SOL (as WSOL) or USDC.
 */
export interface SwapEvent {
  signature: string;
  slot: bigint;
  blockTime: Date;
  wallet: string;
  side: SwapSide;
  tokenMint: string;
  tokenAmountRaw: bigint;
  tokenDecimals: number;
  quoteMint: string;
  quoteAmountRaw: bigint;
  quoteDecimals: number;
  source: SwapSource;
}
