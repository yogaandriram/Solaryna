import { Decimal, WSOL_MINT, type SwapEvent } from '@solaryna/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { addManualWallet, findToken, insertSwapEvent, upsertTokenMetadata } from './queries';
import { TEST_DATABASE_URL, useTestDatabase } from './test-db';
import {
  findOpenPositionByToken,
  getPosition,
  getRiskLimitOverrides,
  getSettingString,
  getWalletCooldown,
  insertSignal,
  isTokenBlacklisted,
  isTradingPaused,
  listOpenPositions,
  openPosition,
  recordSell,
  savePositionValuation,
  saveTokenMarketData,
  setRiskLimitOverrides,
  setSettingString,
  setTradingPaused,
  sumRealizedPnl,
  type NewTrade,
} from './trading';

const WALLET = 'J8M2wM8vtBLZJfajpczrjbs78PWhW1sqVFVJdE5d43jX';
const MINT = 'AbrEhdN9Zsb5AvE5Pubd9VkUUr6ufAHfZ9zo7KAppump';
const T0 = new Date('2026-10-31T03:00:00.000Z');

describe.skipIf(TEST_DATABASE_URL === undefined)('trading queries (MySQL)', () => {
  const { db } = useTestDatabase();

  async function seedSwap(signature: string) {
    const { wallet } = await addManualWallet(db, { address: WALLET, label: 'alpha' });
    const event: SwapEvent = {
      signature,
      slot: 1n,
      blockTime: T0,
      wallet: WALLET,
      side: 'buy',
      tokenMint: MINT,
      tokenAmountRaw: 1000n,
      tokenDecimals: 6,
      quoteMint: WSOL_MINT,
      quoteAmountRaw: 50_000_000n,
      quoteDecimals: 9,
      source: 'pumpfun',
    };
    const saved = await insertSwapEvent(db, event, {});
    if (saved.status !== 'inserted') {
      throw new Error('seed swap was a duplicate');
    }
    return { walletId: wallet.id, swapEventId: saved.id };
  }

  function buyTrade(overrides: Partial<NewTrade> = {}) {
    return {
      mode: 'paper' as const,
      side: 'buy' as const,
      reason: 'copy_buy' as const,
      status: 'simulated' as const,
      tokenMint: MINT,
      tokenAmountRaw: 1_000_000n,
      tokenDecimals: 6,
      solAmountLamports: 50_000_000n,
      priceSol: '0.05',
      networkFeeLamports: 5000n,
      priorityFeeLamports: 200_000n,
      dexFeeLamports: 0n,
      slippageBps: 300,
      quote: { outAmount: '1000000' },
      solUsdPrice: '180.5',
      quotedAt: T0,
      executedAt: T0,
      ...overrides,
    };
  }

  async function openTestPosition(signature = 'sig-buy') {
    const { walletId, swapEventId } = await seedSwap(signature);
    return openPosition(db, {
      signal: {
        swapEventId,
        trackedWalletId: walletId,
        mode: 'paper',
        decision: 'accepted',
        reasons: [],
        riskInputs: { liquidityUsd: '50000' },
        receivedAt: T0,
      },
      position: {
        mode: 'paper',
        status: 'open',
        tokenMint: MINT,
        tokenDecimals: 6,
        trackedWalletId: walletId,
        initialTokenAmountRaw: 1_000_000n,
        tokenAmountRaw: 1_000_000n,
        costLamports: 50_000_000n,
        proceedsLamports: 0n,
        feesLamports: 205_000n,
        realizedPnlLamports: 0n,
        openedAt: T0,
      },
      trade: buyTrade(),
    });
  }

  it('toggles the kill switch once per change and audits it', async () => {
    expect(await isTradingPaused(db)).toBe(false);
    expect(await setTradingPaused(db, true, { actor: 'telegram:1' })).toBe(true);
    expect(await setTradingPaused(db, true, { actor: 'telegram:1' })).toBe(false);
    expect(await isTradingPaused(db)).toBe(true);
    expect(await setTradingPaused(db, false, { actor: 'telegram:2' })).toBe(true);
    expect(await isTradingPaused(db)).toBe(false);
    const [rows] = await db.execute(sql`SELECT actor, action FROM audit_log ORDER BY id`);
    expect(rows).toEqual([
      { actor: 'telegram:1', action: 'trading.pause' },
      { actor: 'telegram:2', action: 'trading.resume' },
    ]);
  });

  it('stores string settings', async () => {
    expect(await getSettingString(db, 'last_daily_report')).toBeNull();
    await setSettingString(db, 'last_daily_report', '2026-10-30');
    await setSettingString(db, 'last_daily_report', '2026-10-31');
    expect(await getSettingString(db, 'last_daily_report')).toBe('2026-10-31');
  });

  it('opens a position with its signal and trade, then records partial and final sells', async () => {
    const opened = await openTestPosition();
    const position = await getPosition(db, opened.positionId);
    expect(position).toMatchObject({
      status: 'open',
      openedFromSignalId: opened.signalId,
      initialTokenAmountRaw: 1_000_000n,
      feesLamports: 205_000n,
    });
    expect((await listOpenPositions(db, 'paper')).map((p) => p.id)).toEqual([opened.positionId]);
    expect((await findOpenPositionByToken(db, 'paper', MINT))?.id).toBe(opened.positionId);
    expect(await findOpenPositionByToken(db, 'live', MINT)).toBeUndefined();

    const sellTrade = (tokens: bigint, sol: bigint, realized: bigint, at: Date) =>
      buyTrade({
        side: 'sell',
        reason: 'take_profit',
        tokenAmountRaw: tokens,
        solAmountLamports: sol,
        realizedPnlLamports: realized,
        executedAt: at,
      });
    const partialAt = new Date(T0.getTime() + 60_000);
    await recordSell(db, {
      signal: null,
      positionId: opened.positionId,
      trade: sellTrade(400_000n, 30_000_000n, 9_590_000n, partialAt),
      position: {
        tokenAmountRaw: 600_000n,
        proceedsLamports: 30_000_000n,
        feesLamports: 410_000n,
        realizedPnlLamports: 9_590_000n,
        status: 'open',
        closeReason: null,
        closedAt: null,
      },
    });
    const finalAt = new Date(T0.getTime() + 120_000);
    await recordSell(db, {
      signal: null,
      positionId: opened.positionId,
      trade: sellTrade(600_000n, 10_000_000n, -20_205_000n, finalAt),
      position: {
        tokenAmountRaw: 0n,
        proceedsLamports: 40_000_000n,
        feesLamports: 615_000n,
        realizedPnlLamports: -10_615_000n,
        status: 'closed',
        closeReason: 'take_profit',
        closedAt: finalAt,
      },
    });

    expect(await getPosition(db, opened.positionId)).toMatchObject({
      status: 'closed',
      closeReason: 'take_profit',
      realizedPnlLamports: -10_615_000n,
      closedAt: finalAt,
    });
    expect(await findOpenPositionByToken(db, 'paper', MINT)).toBeUndefined();
    const dayStart = new Date('2026-10-30T17:00:00Z');
    const dayEnd = new Date('2026-10-31T17:00:00Z');
    expect(await sumRealizedPnl(db, 'paper', dayStart, dayEnd)).toBe(-10_615_000n);
    expect(await sumRealizedPnl(db, 'paper', dayStart, finalAt)).toBe(9_590_000n);
    expect(await sumRealizedPnl(db, 'live', dayStart, dayEnd)).toBe(0n);
  });

  it('keeps raw amounts beyond 2^64 exact', async () => {
    const huge = 10n ** 30n + 7n;
    const opened = await openTestPosition();
    await recordSell(db, {
      signal: null,
      positionId: opened.positionId,
      trade: buyTrade({ side: 'sell', reason: 'max_hold', tokenAmountRaw: huge }),
      position: {
        tokenAmountRaw: huge,
        proceedsLamports: 0n,
        feesLamports: 0n,
        realizedPnlLamports: 0n,
        status: 'open',
        closeReason: null,
        closedAt: null,
      },
    });
    expect((await getPosition(db, opened.positionId))?.tokenAmountRaw).toBe(huge);
  });

  it('rolls back the signal and position when the trade insert fails', async () => {
    await openTestPosition('sig-a');
    const { swapEventId, walletId } = await seedSwap('sig-b');
    const failing = openPosition(db, {
      signal: {
        swapEventId,
        trackedWalletId: walletId,
        mode: 'paper',
        decision: 'accepted',
        reasons: [],
      },
      position: {
        mode: 'paper',
        status: 'open',
        tokenMint: 'Other1111111111111111111111111111111111111',
        tokenDecimals: 6,
        trackedWalletId: walletId,
        initialTokenAmountRaw: 1n,
        tokenAmountRaw: 1n,
        costLamports: 1n,
        proceedsLamports: 0n,
        feesLamports: 0n,
        realizedPnlLamports: 0n,
        openedAt: T0,
      },
      // Force the trade insert to fail with a token mint longer than the column.
      trade: buyTrade({ tokenMint: 'x'.repeat(100) }),
    });
    await expect(failing).rejects.toThrow();
    expect((await listOpenPositions(db, 'paper')).length).toBe(1);
    const [rows] = await db.execute(sql`SELECT COUNT(*) AS n FROM signals`);
    // Raw queries return BIGINT values as strings.
    expect(rows).toEqual([{ n: '1' }]);
  });

  it('records rejected signals with structured reasons', async () => {
    const { swapEventId, walletId } = await seedSwap('sig-r');
    const id = await insertSignal(db, {
      swapEventId,
      trackedWalletId: walletId,
      mode: 'paper',
      decision: 'rejected',
      reasons: [{ code: 'liquidity_below_min', detail: { actual: '12300', min: '20000' } }],
      receivedAt: T0,
    });
    const [rows] = await db.execute(sql`SELECT id, reasons FROM signals`);
    expect(rows).toEqual([
      {
        id: String(id),
        reasons: [{ code: 'liquidity_below_min', detail: { actual: '12300', min: '20000' } }],
      },
    ]);
  });

  it('reads wallet cooldowns and token blacklist flags', async () => {
    const { walletId } = await seedSwap('sig-c');
    expect(await getWalletCooldown(db, walletId)).toBeNull();
    await db.execute(sql`UPDATE tracked_wallets SET cooldown_until = '2026-11-01 00:00:00'`);
    expect(await getWalletCooldown(db, walletId)).toEqual(new Date('2026-11-01T00:00:00Z'));

    expect(await isTokenBlacklisted(db, MINT)).toBe(false);
    await upsertTokenMetadata(db, { mint: MINT, decimals: 6, symbol: 'AAA', name: 'Aaa' });
    await db.execute(sql`UPDATE tokens SET is_blacklisted = TRUE`);
    expect(await isTokenBlacklisted(db, MINT)).toBe(true);
  });

  it('saves token market data without touching its name and symbol', async () => {
    await upsertTokenMetadata(db, { mint: MINT, decimals: 6, symbol: 'AAA', name: 'Aaa' });
    await saveTokenMarketData(db, {
      mint: MINT,
      decimals: 6,
      liquidityUsd: new Decimal('12345.6789'),
      mintAuthorityActive: false,
      freezeAuthorityActive: true,
      tokenCreatedAt: T0,
      fetchedAt: T0,
    });
    expect(await findToken(db, MINT)).toMatchObject({
      symbol: 'AAA',
      name: 'Aaa',
      liquidityUsd: '12345.678900',
      mintAuthorityActive: false,
      freezeAuthorityActive: true,
      tokenCreatedAt: T0,
      marketDataFetchedAt: T0,
    });
    await saveTokenMarketData(db, {
      mint: 'New11111111111111111111111111111111111111111',
      decimals: 9,
      liquidityUsd: null,
      mintAuthorityActive: true,
      freezeAuthorityActive: false,
      tokenCreatedAt: null,
      fetchedAt: T0,
    });
    expect(await findToken(db, 'New11111111111111111111111111111111111111111')).toMatchObject({
      symbol: null,
      liquidityUsd: null,
      mintAuthorityActive: true,
    });
  });

  it('saves a valuation only while the position is open and unchanged', async () => {
    const { positionId } = await openTestPosition();
    const at = new Date('2026-10-31T03:05:00.000Z');
    expect(
      await savePositionValuation(db, {
        positionId,
        tokenAmountRaw: 1_000_000n,
        netValueLamports: 61_000_000n,
        at,
      }),
    ).toBe(true);
    expect(await getPosition(db, positionId)).toMatchObject({
      lastValueLamports: 61_000_000n,
      lastValuedAt: at,
    });
    // No route: the value is cleared but the time is kept.
    expect(
      await savePositionValuation(db, {
        positionId,
        tokenAmountRaw: 1_000_000n,
        netValueLamports: null,
        at,
      }),
    ).toBe(true);
    expect(await getPosition(db, positionId)).toMatchObject({ lastValueLamports: null });
    // A quote for an amount the position no longer holds is dropped.
    expect(
      await savePositionValuation(db, {
        positionId,
        tokenAmountRaw: 999n,
        netValueLamports: 1n,
        at,
      }),
    ).toBe(false);
    await db.execute(sql`UPDATE positions SET status = 'closed' WHERE id = ${positionId}`);
    expect(
      await savePositionValuation(db, {
        positionId,
        tokenAmountRaw: 1_000_000n,
        netValueLamports: 1n,
        at,
      }),
    ).toBe(false);
  });

  it('stores runtime limit overrides and audits only real changes', async () => {
    expect(await getRiskLimitOverrides(db)).toBeNull();
    const actor = { actor: 'dashboard' };
    expect(await setRiskLimitOverrides(db, { maxOpenPositions: '3' }, actor)).toEqual({
      changes: { maxOpenPositions: { from: null, to: '3' } },
    });
    expect(await getRiskLimitOverrides(db)).toEqual({ maxOpenPositions: '3' });
    expect(await setRiskLimitOverrides(db, { maxOpenPositions: '3' }, actor)).toEqual({
      changes: {},
    });
    expect(await setRiskLimitOverrides(db, { stopLossPct: '20' }, actor)).toEqual({
      changes: {
        maxOpenPositions: { from: '3', to: null },
        stopLossPct: { from: null, to: '20' },
      },
    });
    const [rows] = await db.execute(sql`SELECT actor, action, details FROM audit_log ORDER BY id`);
    expect(rows).toEqual([
      {
        actor: 'dashboard',
        action: 'limits.update',
        details: { changes: { maxOpenPositions: { from: null, to: '3' } } },
      },
      {
        actor: 'dashboard',
        action: 'limits.update',
        details: {
          changes: {
            maxOpenPositions: { from: '3', to: null },
            stopLossPct: { from: null, to: '20' },
          },
        },
      },
    ]);
  });
});
