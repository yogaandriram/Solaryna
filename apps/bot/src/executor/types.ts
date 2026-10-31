import type { Decimal, SwapSide, TradingMode } from '@solaryna/core';
import type { JupiterOrder } from '../jupiter/client';
import type { RequestPriority, ScheduleOptions } from '../jupiter/rate-limiter';

/** A quote the risk engine judges and the executor then fills, unchanged. */
export interface PreparedOrder {
  side: SwapSide;
  tokenMint: string;
  inAmountRaw: bigint;
  outAmountRaw: bigint;
  priceImpactPct: Decimal;
  quote: JupiterOrder;
  quotedAt: Date;
}

export type PrepareResult = { ok: true; order: PreparedOrder } | { ok: false; reason: 'no_route' };

export interface TradeFill {
  side: SwapSide;
  tokenMint: string;
  tokenAmountRaw: bigint;
  /** SOL spent (buy) or received (sell), excluding network and priority fees. */
  solAmountLamports: bigint;
  networkFeeLamports: bigint;
  priorityFeeLamports: bigint;
  /** DEX/platform fee; already reflected in the swap amounts, recorded for reporting only. */
  dexFeeLamports: bigint;
  slippageBps: number;
  solUsdPrice: Decimal | null;
  quotedAt: Date;
  executedAt: Date;
  quoteSnapshot: unknown;
  /** Live only. */
  txSignature: string | null;
}

/**
 * Two steps so the risk engine judges exactly the quote that gets executed. Paper fills at the
 * quote; live (M5) signs, sends and reads the confirmed amounts. The slippage tolerance comes with
 * each order because it is a runtime risk limit.
 */
export interface Executor {
  readonly mode: TradingMode;
  prepareBuy(
    params: { tokenMint: string; solAmountLamports: bigint; slippageBps: number },
    priority: RequestPriority,
    options?: ScheduleOptions,
  ): Promise<PrepareResult>;
  prepareSell(
    params: { tokenMint: string; tokenAmountRaw: bigint; slippageBps: number },
    priority: RequestPriority,
    options?: ScheduleOptions,
  ): Promise<PrepareResult>;
  execute(order: PreparedOrder): Promise<TradeFill>;
}
