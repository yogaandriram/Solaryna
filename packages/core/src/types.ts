export const TRADING_MODES = ['paper', 'live'] as const;
export type TradingMode = (typeof TRADING_MODES)[number];

export const SWAP_SIDES = ['buy', 'sell'] as const;
export type SwapSide = (typeof SWAP_SIDES)[number];

export const SWAP_SOURCES = ['pumpfun', 'raydium', 'meteora', 'jupiter', 'unknown'] as const;
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
