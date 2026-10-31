import {
  Decimal,
  LAMPORTS_PER_SOL,
  applySell,
  positionStateOf,
  type PositionState,
  type SwapEvent,
  type TradeReason,
  type TradingMode,
} from '@solaryna/core';
import type { NewSignal, NewTrade, PositionRow } from '@solaryna/db';
import type { TradeFill } from '../executor/types';
import type { TradingStore } from './store';

/** Notifications raised by the engine and the position monitor. */
export interface TradingEvents {
  tradeExecuted(event: {
    fill: TradeFill;
    position: PositionRow;
    walletEvent: SwapEvent | null;
    reason: TradeReason;
    realizedPnlLamports: bigint | null;
  }): void;
  positionClosed(event: { position: PositionRow; reason: SellReason }): void;
  executionError(event: { tokenMint: string; side: 'buy' | 'sell'; message: string }): void;
}

export type SellReason = Exclude<TradeReason, 'copy_buy'>;

/** Network + priority fees: the costs not already inside the swap amounts. */
export function chargedFeesLamports(fill: TradeFill): bigint {
  return fill.networkFeeLamports + fill.priorityFeeLamports;
}

export const positionState = (position: PositionRow): PositionState => positionStateOf(position);

/** SOL per whole token, for display; null when no tokens changed hands. */
function priceSol(fill: TradeFill, tokenDecimals: number): string | null {
  if (fill.tokenAmountRaw <= 0n) {
    return null;
  }
  const sol = new Decimal(fill.solAmountLamports.toString()).div(LAMPORTS_PER_SOL.toString());
  const tokens = new Decimal(fill.tokenAmountRaw.toString()).div(
    new Decimal(10).pow(tokenDecimals),
  );
  return sol.div(tokens).toDecimalPlaces(30).toFixed();
}

export function tradeValues(
  mode: TradingMode,
  fill: TradeFill,
  reason: TradeReason,
  tokenDecimals: number,
  realizedPnlLamports: bigint | null,
): Omit<NewTrade, 'positionId' | 'signalId'> {
  return {
    mode,
    side: fill.side,
    reason,
    status: mode === 'paper' ? 'simulated' : 'confirmed',
    tokenMint: fill.tokenMint,
    tokenAmountRaw: fill.tokenAmountRaw,
    tokenDecimals,
    solAmountLamports: fill.solAmountLamports,
    priceSol: priceSol(fill, tokenDecimals),
    networkFeeLamports: fill.networkFeeLamports,
    priorityFeeLamports: fill.priorityFeeLamports,
    dexFeeLamports: fill.dexFeeLamports,
    slippageBps: fill.slippageBps,
    txSignature: fill.txSignature,
    quote: fill.quoteSnapshot,
    solUsdPrice: fill.solUsdPrice?.toDecimalPlaces(12).toFixed() ?? null,
    quotedAt: fill.quotedAt,
    executedAt: fill.executedAt,
    realizedPnlLamports,
  };
}

/**
 * Applies a sell fill to a position and stores trade + position (+ the follow-sell signal) in one
 * transaction, then notifies. Callers hold the token lock and re-read the position inside it.
 */
export async function recordSale(
  deps: { store: TradingStore; events: TradingEvents; mode: TradingMode },
  input: {
    position: PositionRow;
    fill: TradeFill;
    reason: SellReason;
    signal: NewSignal | null;
    walletEvent: SwapEvent | null;
  },
): Promise<{ position: PositionRow; realizedPnlLamports: bigint; closed: boolean }> {
  const { position, fill, reason } = input;
  const sale = applySell(positionState(position), {
    tokenAmountRaw: fill.tokenAmountRaw,
    solAmountLamports: fill.solAmountLamports,
    feesLamports: chargedFeesLamports(fill),
  });
  await deps.store.recordSell({
    signal: input.signal,
    positionId: position.id,
    trade: tradeValues(deps.mode, fill, reason, position.tokenDecimals, sale.realizedPnlLamports),
    position: {
      tokenAmountRaw: sale.next.tokenAmountRaw,
      proceedsLamports: sale.next.proceedsLamports,
      feesLamports: sale.next.feesLamports,
      realizedPnlLamports: sale.next.realizedPnlLamports,
      status: sale.closed ? 'closed' : 'open',
      closeReason: sale.closed ? reason : null,
      closedAt: sale.closed ? fill.executedAt : null,
    },
  });
  const updated = (await deps.store.getPosition(position.id)) ?? position;
  deps.events.tradeExecuted({
    fill,
    position: updated,
    walletEvent: input.walletEvent,
    reason,
    realizedPnlLamports: sale.realizedPnlLamports,
  });
  if (sale.closed) {
    deps.events.positionClosed({ position: updated, reason });
  }
  return { position: updated, realizedPnlLamports: sale.realizedPnlLamports, closed: sale.closed };
}
