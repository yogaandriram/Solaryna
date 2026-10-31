import { BASE_NETWORK_FEE_LAMPORTS, Decimal, LAMPORTS_PER_SOL, WSOL_MINT } from '@solaryna/core';
import type { JupiterClient, JupiterOrder } from '../jupiter/client';
import type { Executor, PreparedOrder, PrepareResult, TradeFill } from './types';

export interface PaperExecutorOptions {
  jupiter: Pick<JupiterClient, 'getOrder'>;
  slippageBps: number;
  /** Charged per simulated transaction (the configured maximum, to stay conservative). */
  priorityFeeLamports: bigint;
  now: () => Date;
}

/**
 * Simulates trades at real Jupiter quotes: the fill is the quote's `outAmount` (no transaction is
 * sent). Fees: base network fee + configured priority fee per transaction; the DEX/platform fee is
 * already deducted in the quote amounts and is recorded separately for reports.
 */
export function createPaperExecutor(options: PaperExecutorOptions): Executor {
  async function prepare(
    side: 'buy' | 'sell',
    tokenMint: string,
    amountRaw: bigint,
    priority: Parameters<Executor['prepareBuy']>[1],
  ): Promise<PrepareResult> {
    const quote = await options.jupiter.getOrder(
      {
        inputMint: side === 'buy' ? WSOL_MINT : tokenMint,
        outputMint: side === 'buy' ? tokenMint : WSOL_MINT,
        amountRaw,
        slippageBps: options.slippageBps,
      },
      priority,
    );
    if (quote === null) {
      return { ok: false, reason: 'no_route' };
    }
    const order: PreparedOrder = {
      side,
      tokenMint,
      inAmountRaw: quote.inAmountRaw,
      outAmountRaw: quote.outAmountRaw,
      priceImpactPct: quote.priceImpactPct,
      quote,
      quotedAt: options.now(),
    };
    return { ok: true, order };
  }

  return {
    mode: 'paper',
    prepareBuy: (params, priority) =>
      prepare('buy', params.tokenMint, params.solAmountLamports, priority),
    prepareSell: (params, priority) =>
      prepare('sell', params.tokenMint, params.tokenAmountRaw, priority),
    execute(order) {
      const buy = order.side === 'buy';
      const solAmount = buy ? order.inAmountRaw : order.outAmountRaw;
      const tokenAmount = buy ? order.outAmountRaw : order.inAmountRaw;
      const fill: TradeFill = {
        side: order.side,
        tokenMint: order.tokenMint,
        tokenAmountRaw: tokenAmount,
        solAmountLamports: solAmount,
        networkFeeLamports: BASE_NETWORK_FEE_LAMPORTS,
        priorityFeeLamports: options.priorityFeeLamports,
        dexFeeLamports: dexFeeLamports(order.quote, order.tokenMint, solAmount, tokenAmount),
        slippageBps: order.quote.slippageBps,
        solUsdPrice: solUsdPrice(buy ? order.quote.inUsdValue : order.quote.outUsdValue, solAmount),
        quotedAt: order.quotedAt,
        executedAt: options.now(),
        quoteSnapshot: order.quote.snapshot,
        txSignature: null,
      };
      return Promise.resolve(fill);
    },
  };
}

/** The platform fee in lamports; a fee taken in the token is valued at the quote's own price. */
function dexFeeLamports(
  quote: JupiterOrder,
  tokenMint: string,
  solAmount: bigint,
  tokenAmount: bigint,
): bigint {
  const fee = quote.platformFee;
  if (fee === null) {
    return 0n;
  }
  if (fee.mint === WSOL_MINT) {
    return fee.amountRaw;
  }
  if (fee.mint === tokenMint && tokenAmount > 0n) {
    return (fee.amountRaw * solAmount) / tokenAmount;
  }
  return 0n;
}

function solUsdPrice(usdValue: Decimal | null, solAmount: bigint): Decimal | null {
  if (usdValue === null || solAmount <= 0n) {
    return null;
  }
  return usdValue.div(new Decimal(solAmount.toString()).div(LAMPORTS_PER_SOL.toString()));
}
