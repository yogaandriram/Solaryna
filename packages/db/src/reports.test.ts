import { USDC_MINT, WSOL_MINT, type SwapEvent } from '@solaryna/core';
import { describe, expect, it } from 'vitest';
import { addManualWallet, insertSwapEvent, upsertTokenMetadata } from './queries';
import { listClosedReportPositions, listReportBuySignals, listReportTrades } from './reports';
import { TEST_DATABASE_URL, useTestDatabase } from './test-db';
import { insertSignal, openPosition, recordSell, type NewTrade } from './trading';

const WALLET = 'J8M2wM8vtBLZJfajpczrjbs78PWhW1sqVFVJdE5d43jX';
const MINT = 'AbrEhdN9Zsb5AvE5Pubd9VkUUr6ufAHfZ9zo7KAppump';
const FROM = new Date('2026-10-25T17:00:00Z');
const TO = new Date('2026-11-01T17:00:00Z');
const at = (iso: string) => new Date(iso);

describe.skipIf(TEST_DATABASE_URL === undefined)('report queries (MySQL)', () => {
  const { db } = useTestDatabase();

  async function swap(signature: string, side: SwapEvent['side'], blockTime: Date, quote = 1000n) {
    const saved = await insertSwapEvent(
      db,
      {
        signature,
        slot: 1n,
        blockTime,
        wallet: WALLET,
        side,
        tokenMint: MINT,
        tokenAmountRaw: 500n,
        tokenDecimals: 6,
        quoteMint: WSOL_MINT,
        quoteAmountRaw: quote,
        quoteDecimals: 9,
        source: 'pumpfun',
      },
      {},
    );
    if (saved.status !== 'inserted') {
      throw new Error('duplicate');
    }
    return saved.id;
  }

  const trade = (overrides: Partial<NewTrade>) => ({
    mode: 'paper' as const,
    side: 'buy' as const,
    reason: 'copy_buy' as const,
    status: 'simulated' as const,
    tokenMint: MINT,
    tokenAmountRaw: 1000n,
    tokenDecimals: 6,
    solAmountLamports: 1000n,
    networkFeeLamports: 5000n,
    priorityFeeLamports: 200_000n,
    dexFeeLamports: 10n,
    executedAt: at('2026-10-27T00:00:00Z'),
    ...overrides,
  });

  /** Opens a position from a wallet buy at `entryTime` and closes it at `closedAt`. */
  async function closedPosition(entryTime: Date, closedAt: Date, suffix: string) {
    const { wallet } = await addManualWallet(db, { address: WALLET, label: 'alpha' });
    const swapEventId = await swap(`buy-${suffix}`, 'buy', entryTime);
    const opened = await openPosition(db, {
      signal: {
        swapEventId,
        trackedWalletId: wallet.id,
        mode: 'paper',
        decision: 'accepted',
        reasons: [],
        createdAt: entryTime,
      },
      position: {
        mode: 'paper',
        status: 'open',
        tokenMint: MINT,
        tokenDecimals: 6,
        trackedWalletId: wallet.id,
        initialTokenAmountRaw: 1000n,
        tokenAmountRaw: 1000n,
        costLamports: 1000n,
        proceedsLamports: 0n,
        feesLamports: 205_010n,
        realizedPnlLamports: 0n,
        openedAt: entryTime,
      },
      trade: trade({ solUsdPrice: '180', executedAt: entryTime }),
    });
    await recordSell(db, {
      signal: null,
      positionId: opened.positionId,
      trade: trade({
        side: 'sell',
        reason: 'take_profit',
        solAmountLamports: 1500n,
        realizedPnlLamports: 500n - 410_020n,
        solUsdPrice: '190',
        executedAt: closedAt,
      }),
      position: {
        tokenAmountRaw: 0n,
        proceedsLamports: 1500n,
        feesLamports: 410_020n,
        realizedPnlLamports: 500n - 410_020n,
        status: 'closed',
        closeReason: 'take_profit',
        closedAt,
      },
    });
    return { ...opened, walletId: wallet.id };
  }

  it('lists positions closed in the period with the wallet entry and later wallet exits', async () => {
    await upsertTokenMetadata(db, { mint: MINT, decimals: 6, symbol: 'AAA', name: 'Aaa' });
    const inside = await closedPosition(
      at('2026-10-26T00:00:00Z'),
      at('2026-10-27T00:00:00Z'),
      'a',
    );
    await closedPosition(at('2026-10-20T00:00:00Z'), at('2026-10-21T00:00:00Z'), 'b');
    // The wallet sold before this entry (ignored), twice after it, and once after the period.
    await swap('sell-before', 'sell', at('2026-10-25T23:00:00Z'));
    await swap('sell-1', 'sell', at('2026-10-26T01:00:00Z'), 1800n);
    await swap('sell-2', 'sell', at('2026-10-26T02:00:00Z'), 1600n);
    await swap('sell-after', 'sell', at('2026-11-02T00:00:00Z'));

    const rows = await listClosedReportPositions(db, 'paper', FROM, TO);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({
      id: inside.positionId,
      tokenMint: MINT,
      tokenSymbol: 'AAA',
      walletId: inside.walletId,
      walletAddress: WALLET,
      walletLabel: 'alpha',
      closeReason: 'take_profit',
      costLamports: 1000n,
      initialTokenAmountRaw: 1000n,
      proceedsLamports: 1500n,
      feesLamports: 410_020n,
      realizedPnlLamports: 500n - 410_020n,
      walletEntry: {
        quoteMint: WSOL_MINT,
        quoteAmountRaw: 1000n,
        quoteDecimals: 9,
        tokenAmountRaw: 500n,
      },
    });
    expect(row?.walletExits.map((leg) => leg.quoteAmountRaw)).toEqual([1800n, 1600n]);
    expect(row?.buySolUsd?.toString()).toBe('180');
    expect(row?.exitSolUsd?.toString()).toBe('190');
    expect(await listClosedReportPositions(db, 'live', FROM, TO)).toEqual([]);
  });

  it('lists trades executed in the period', async () => {
    await closedPosition(at('2026-10-26T00:00:00Z'), at('2026-11-02T00:00:00Z'), 'c');
    expect(await listReportTrades(db, 'paper', FROM, TO)).toEqual([
      {
        side: 'buy',
        reason: 'copy_buy',
        networkFeeLamports: 5000n,
        priorityFeeLamports: 200_000n,
        dexFeeLamports: 10n,
        realizedPnlLamports: null,
      },
    ]);
  });

  it('lists only buy signals created in the period', async () => {
    const { wallet } = await addManualWallet(db, { address: WALLET, label: null });
    const reasons = [{ code: 'liquidity_below_min' as const }];
    const base = {
      trackedWalletId: wallet.id,
      mode: 'paper' as const,
      decision: 'rejected' as const,
      reasons,
    };
    await insertSignal(db, {
      ...base,
      swapEventId: await swap('b1', 'buy', at('2026-10-26T00:00:00Z')),
      createdAt: at('2026-10-26T00:00:01Z'),
    });
    await insertSignal(db, {
      ...base,
      swapEventId: await swap('s1', 'sell', at('2026-10-26T00:00:00Z')),
      createdAt: at('2026-10-26T00:00:01Z'),
    });
    await insertSignal(db, {
      ...base,
      swapEventId: await swap('b2', 'buy', at('2026-10-20T00:00:00Z')),
      createdAt: at('2026-10-20T00:00:01Z'),
    });
    const usdc = await insertSwapEvent(
      db,
      {
        signature: 'b3',
        slot: 1n,
        blockTime: at('2026-10-27T00:00:00Z'),
        wallet: WALLET,
        side: 'buy',
        tokenMint: MINT,
        tokenAmountRaw: 1n,
        tokenDecimals: 6,
        quoteMint: USDC_MINT,
        quoteAmountRaw: 1n,
        quoteDecimals: 6,
        source: 'raydium',
      },
      {},
    );
    if (usdc.status !== 'inserted') {
      throw new Error('duplicate');
    }
    await insertSignal(db, {
      ...base,
      decision: 'accepted',
      reasons: [],
      swapEventId: usdc.id,
      createdAt: at('2026-10-27T00:00:01Z'),
    });

    expect(await listReportBuySignals(db, 'paper', FROM, TO)).toEqual([
      {
        walletId: wallet.id,
        walletAddress: WALLET,
        walletLabel: null,
        decision: 'rejected',
        reasons,
      },
      {
        walletId: wallet.id,
        walletAddress: WALLET,
        walletLabel: null,
        decision: 'accepted',
        reasons: [],
      },
    ]);
  });
});
