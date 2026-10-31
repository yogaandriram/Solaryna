import { Decimal, WSOL_MINT } from '@solaryna/core';
import { describe, expect, it, vi } from 'vitest';
import type { JupiterClient, JupiterOrder } from '../jupiter/client';
import { createPaperExecutor } from './paper';

const MINT = 'AbrEhdN9Zsb5AvE5Pubd9VkUUr6ufAHfZ9zo7KAppump';
const QUOTED_AT = new Date('2026-10-31T05:00:00Z');
const EXECUTED_AT = new Date('2026-10-31T05:00:01Z');

function quote(overrides: Partial<JupiterOrder> = {}): JupiterOrder {
  return {
    inAmountRaw: 50_000_000n,
    outAmountRaw: 1_000_000n,
    minOutAmountRaw: 970_000n,
    priceImpactPct: new Decimal('-0.4'),
    slippageBps: 300,
    feeBps: 10,
    platformFee: { amountRaw: 50_000n, mint: WSOL_MINT },
    inUsdValue: new Decimal('9'),
    outUsdValue: new Decimal('8.9'),
    router: 'metis',
    snapshot: { outAmount: '1000000' },
    ...overrides,
  };
}

function setup(order: JupiterOrder | null) {
  const getOrder = vi.fn<JupiterClient['getOrder']>(() => Promise.resolve(order));
  const times = [QUOTED_AT, EXECUTED_AT];
  const executor = createPaperExecutor({
    jupiter: { getOrder },
    priorityFeeLamports: 200_000n,
    now: () => times.shift() ?? EXECUTED_AT,
  });
  return { executor, getOrder };
}

describe('createPaperExecutor', () => {
  it('quotes a buy of SOL for the token and fills at outAmount', async () => {
    const { executor, getOrder } = setup(quote());
    const prepared = await executor.prepareBuy(
      { tokenMint: MINT, solAmountLamports: 50_000_000n, slippageBps: 300 },
      'buy',
    );
    expect(getOrder).toHaveBeenCalledWith(
      { inputMint: WSOL_MINT, outputMint: MINT, amountRaw: 50_000_000n, slippageBps: 300 },
      'buy',
      undefined,
    );
    if (!prepared.ok) {
      throw new Error('expected an order');
    }
    expect(prepared.order).toMatchObject({ side: 'buy', tokenMint: MINT, quotedAt: QUOTED_AT });

    const fill = await executor.execute(prepared.order);
    expect(fill).toMatchObject({
      side: 'buy',
      tokenMint: MINT,
      tokenAmountRaw: 1_000_000n,
      solAmountLamports: 50_000_000n,
      networkFeeLamports: 5000n,
      priorityFeeLamports: 200_000n,
      dexFeeLamports: 50_000n,
      slippageBps: 300,
      quotedAt: QUOTED_AT,
      executedAt: EXECUTED_AT,
      quoteSnapshot: { outAmount: '1000000' },
      txSignature: null,
    });
    // 9 USD for 0.05 SOL.
    expect(fill.solUsdPrice?.toString()).toBe('180');
    expect(executor.mode).toBe('paper');
  });

  it('quotes a sell of the token for SOL and converts a token-denominated fee to lamports', async () => {
    const sellQuote = quote({
      inAmountRaw: 1_000_000n,
      outAmountRaw: 60_000_000n,
      platformFee: { amountRaw: 1000n, mint: MINT },
      inUsdValue: null,
      outUsdValue: new Decimal('10.8'),
    });
    const { executor, getOrder } = setup(sellQuote);
    const prepared = await executor.prepareSell(
      { tokenMint: MINT, tokenAmountRaw: 1_000_000n, slippageBps: 300 },
      'exit',
      undefined,
    );
    expect(getOrder).toHaveBeenCalledWith(
      { inputMint: MINT, outputMint: WSOL_MINT, amountRaw: 1_000_000n, slippageBps: 300 },
      'exit',
      undefined,
    );
    if (!prepared.ok) {
      throw new Error('expected an order');
    }
    const fill = await executor.execute(prepared.order);
    expect(fill).toMatchObject({
      side: 'sell',
      tokenAmountRaw: 1_000_000n,
      solAmountLamports: 60_000_000n,
      // 1000 tokens at 60 lamports per token.
      dexFeeLamports: 60_000n,
    });
    expect(fill.solUsdPrice?.toString()).toBe('180');
  });

  it('passes the signal expiry to the quote request', async () => {
    const { executor, getOrder } = setup(quote());
    await executor.prepareBuy({ tokenMint: MINT, solAmountLamports: 1n, slippageBps: 300 }, 'buy', {
      expiresAt: 42,
    });
    expect(getOrder.mock.calls[0]?.[2]).toEqual({ expiresAt: 42 });
  });

  it('reports no_route when Jupiter has no route', async () => {
    const { executor } = setup(null);
    expect(
      await executor.prepareBuy(
        { tokenMint: MINT, solAmountLamports: 50_000_000n, slippageBps: 300 },
        'buy',
      ),
    ).toEqual({ ok: false, reason: 'no_route' });
  });

  it('records no SOL/USD price or DEX fee when the quote lacks them', async () => {
    const { executor } = setup(quote({ inUsdValue: null, platformFee: null }));
    const prepared = await executor.prepareBuy(
      { tokenMint: MINT, solAmountLamports: 50_000_000n, slippageBps: 300 },
      'buy',
      undefined,
    );
    if (!prepared.ok) {
      throw new Error('expected an order');
    }
    const fill = await executor.execute(prepared.order);
    expect(fill.solUsdPrice).toBeNull();
    expect(fill.dexFeeLamports).toBe(0n);
  });
});
