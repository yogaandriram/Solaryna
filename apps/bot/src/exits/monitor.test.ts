import type { RiskLimits } from '@solaryna/config';
import { Decimal, WSOL_MINT } from '@solaryna/core';
import type { PositionRow } from '@solaryna/db';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createFakeTradingStore } from '../engine/fake-store';
import { createKeyedMutex } from '../engine/locks';
import type { TradingEvents } from '../engine/sell';
import { createPaperExecutor } from '../executor/paper';
import { JupiterApiError, type JupiterClient } from '../jupiter/client';
import { UNROUTABLE_AFTER_CLIENT_ERRORS, createPositionMonitor } from './monitor';

const MINT_A = 'AbrEhdN9Zsb5AvE5Pubd9VkUUr6ufAHfZ9zo7KAppump';
const MINT_B = '4CLJSkwJ7JsNvrtZrVwqcXecYrAwUTSkTC1p7gzqpump';
const OPENED_AT = new Date('2026-10-31T05:00:00Z');

const limits: RiskLimits = {
  maxSolPerTradeLamports: 50_000_000n,
  maxOpenPositions: 5,
  dailyLossLimitLamports: 200_000_000n,
  minLiquidityUsd: new Decimal(20_000),
  maxSlippageBps: 300,
  maxPriorityFeeLamports: 200_000n,
  copyDelayMs: 3000,
  takeProfitPct: new Decimal(100),
  stopLossPct: new Decimal(30),
  maxHoldMinutes: 240,
  maxSignalAgeSeconds: 30,
};

function position(id: number, tokenMint: string): PositionRow {
  return {
    id,
    mode: 'paper',
    status: 'open',
    tokenMint,
    tokenDecimals: 6,
    trackedWalletId: 1,
    openedFromSignalId: id,
    initialTokenAmountRaw: 1_000_000_000n,
    tokenAmountRaw: 1_000_000_000n,
    costLamports: 50_000_000n,
    proceedsLamports: 0n,
    feesLamports: 205_000n,
    realizedPnlLamports: 0n,
    closeReason: null,
    lastValueLamports: null,
    lastValuedAt: null,
    openedAt: OPENED_AT,
    closedAt: null,
    createdAt: OPENED_AT,
    updatedAt: OPENED_AT,
  };
}

function setup(
  sellOut: (mint: string) => bigint | null | Error,
  currentLimits: () => RiskLimits = () => limits,
) {
  let time = OPENED_AT.getTime() + 10 * 60_000;
  const now = () => new Date(time);
  const store = createFakeTradingStore();
  const getOrder = vi.fn<JupiterClient['getOrder']>((params) => {
    const out = sellOut(params.inputMint);
    if (out instanceof Error) {
      return Promise.reject(out);
    }
    if (out === null) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      inAmountRaw: params.amountRaw,
      outAmountRaw: out,
      minOutAmountRaw: out,
      priceImpactPct: new Decimal(0),
      slippageBps: params.slippageBps,
      feeBps: 0,
      platformFee: null,
      inUsdValue: null,
      outUsdValue: null,
      router: 'metis',
      snapshot: {},
    });
  });
  const events = {
    tradeExecuted: vi.fn<TradingEvents['tradeExecuted']>(),
    positionClosed: vi.fn<TradingEvents['positionClosed']>(),
    executionError: vi.fn<TradingEvents['executionError']>(),
  };
  const locks = createKeyedMutex();
  const monitor = createPositionMonitor({
    store,
    executor: createPaperExecutor({
      jupiter: { getOrder },
      priorityFeeLamports: 200_000n,
      now,
    }),
    locks,
    limits: currentLimits,
    priorityFeeLamports: 200_000n,
    now,
    events,
    logger: pino({ level: 'silent' }),
  });
  return {
    monitor,
    store,
    getOrder,
    events,
    locks,
    advanceMinutes: (minutes: number) => {
      time += minutes * 60_000;
    },
  };
}

describe('createPositionMonitor', () => {
  it('takes profit with the same quote it valued the position with', async () => {
    const { monitor, store, getOrder, events } = setup(() => 101_000_000n);
    store.positions.push(position(1, MINT_A));
    await monitor.runOnce();

    expect(getOrder).toHaveBeenCalledTimes(1);
    expect(getOrder.mock.calls[0]?.[0]).toMatchObject({
      inputMint: MINT_A,
      outputMint: WSOL_MINT,
      amountRaw: 1_000_000_000n,
    });
    expect(getOrder.mock.calls[0]?.[1]).toBe('monitor');
    expect(store.positions[0]).toMatchObject({
      status: 'closed',
      closeReason: 'take_profit',
      tokenAmountRaw: 0n,
      proceedsLamports: 101_000_000n,
      realizedPnlLamports: 101_000_000n - 50_000_000n - 410_000n,
    });
    expect(store.trades[0]).toMatchObject({ reason: 'take_profit', signalId: null });
    expect(events.positionClosed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'take_profit' }),
    );
    expect(monitor.valuation(1)).toBeUndefined();
  });

  it('reads the runtime limits every cycle, for the quote and the thresholds', async () => {
    let current: RiskLimits = { ...limits, maxSlippageBps: 150 };
    const { monitor, store, getOrder } = setup(
      () => 60_000_000n,
      () => current,
    );
    store.positions.push(position(1, MINT_A));
    await monitor.runOnce();
    expect(store.positions[0]?.status).toBe('open');
    current = { ...limits, maxSlippageBps: 90, takeProfitPct: new Decimal(10) };
    await monitor.runOnce();
    expect(getOrder.mock.calls.map(([params]) => params.slippageBps)).toEqual([150, 90]);
    expect(store.positions[0]).toMatchObject({ status: 'closed', closeReason: 'take_profit' });
  });

  it('keeps a position between the thresholds and remembers its valuation', async () => {
    const { monitor, store } = setup(() => 60_000_000n);
    store.positions.push(position(1, MINT_A));
    await monitor.runOnce();
    expect(store.trades).toHaveLength(0);
    expect(monitor.valuation(1)).toMatchObject({
      positionId: 1,
      netValueLamports: 60_000_000n - 205_000n,
      remainingCostLamports: 50_000_000n,
    });
  });

  it('saves every valuation it computes, null when there is no route', async () => {
    const { monitor, store } = setup(() => 60_000_000n);
    store.positions.push(position(1, MINT_A));
    await monitor.runOnce();
    expect(store.valuations).toEqual([
      {
        positionId: 1,
        tokenAmountRaw: 1_000_000_000n,
        netValueLamports: 60_000_000n - 205_000n,
        at: expect.any(Date) as Date,
      },
    ]);

    const noRoute = setup(() => null);
    noRoute.store.positions.push(position(1, MINT_A));
    await noRoute.monitor.runOnce();
    expect(noRoute.store.valuations[0]?.netValueLamports).toBeNull();
  });

  it('still takes profit when saving the valuation fails', async () => {
    const { monitor, store } = setup(() => 101_000_000n);
    store.savePositionValuation = () => Promise.reject(new Error('db down'));
    store.positions.push(position(1, MINT_A));
    await monitor.runOnce();
    expect(store.positions[0]?.closeReason).toBe('take_profit');
  });

  it('stops the loss and exits at max hold', async () => {
    const loss = setup(() => 35_000_000n);
    loss.store.positions.push(position(1, MINT_A));
    await loss.monitor.runOnce();
    expect(loss.store.positions[0]?.closeReason).toBe('stop_loss');

    const old = setup(() => 60_000_000n);
    old.store.positions.push(position(1, MINT_A));
    old.advanceMinutes(231);
    await old.monitor.runOnce();
    expect(old.store.positions[0]?.closeReason).toBe('max_hold');
  });

  it('waits for /resume before selling', async () => {
    const { monitor, store } = setup(() => 10_000_000n);
    store.positions.push(position(1, MINT_A));
    store.settings.set('trading_paused', true);
    await monitor.runOnce();
    expect(store.positions[0]?.status).toBe('open');
    expect(store.trades).toHaveLength(0);
  });

  it('keeps an unroutable position until max hold, then closes it at zero', async () => {
    const { monitor, store, advanceMinutes } = setup(() => null);
    store.positions.push(position(1, MINT_A));
    await monitor.runOnce();
    expect(store.positions[0]?.status).toBe('open');
    expect(monitor.valuation(1)?.netValueLamports).toBeNull();

    advanceMinutes(231);
    await monitor.runOnce();
    expect(store.positions[0]).toMatchObject({
      status: 'closed',
      closeReason: 'unsellable',
      proceedsLamports: 0n,
      realizedPnlLamports: -50_000_000n - 205_000n,
    });
    expect(store.trades[0]).toMatchObject({ reason: 'unsellable', solAmountLamports: 0n });
  });

  it('skips a position the engine closed while the monitor waited for its lock', async () => {
    const { monitor, store, getOrder, locks } = setup(() => 101_000_000n);
    store.positions.push(position(1, MINT_A));
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = locks.run(MINT_A, async () => {
      await gate;
      const current = store.positions[0];
      if (current !== undefined) {
        store.positions[0] = { ...current, status: 'closed', closeReason: 'follow_sell' };
      }
    });
    const run = monitor.runOnce();
    release();
    await Promise.all([holder, run]);
    // Quoted without the lock, but the re-read under the lock sees it closed: no second sale.
    expect(getOrder).toHaveBeenCalledTimes(1);
    expect(store.trades).toHaveLength(0);
    expect(store.positions[0]).toMatchObject({ status: 'closed', closeReason: 'follow_sell' });
    expect(monitor.valuation(1)).toBeUndefined();
  });

  it('keeps checking other positions when one fails, without alerting', async () => {
    const { monitor, store, events } = setup((mint) =>
      mint === MINT_A ? new JupiterApiError('getOrder', 500, 'internal') : 60_000_000n,
    );
    store.positions.push(position(1, MINT_A), position(2, MINT_B));
    await monitor.runOnce();
    expect(monitor.valuation(2)?.netValueLamports).toBe(59_795_000n);
    expect(events.executionError).not.toHaveBeenCalled();
  });

  it('does not overlap runs', async () => {
    const { monitor, store, getOrder } = setup(() => 60_000_000n);
    store.positions.push(position(1, MINT_A));
    await Promise.all([monitor.runOnce(), monitor.runOnce()]);
    expect(getOrder).toHaveBeenCalledTimes(1);
  });

  it('quotes every position without waiting for a token lock', async () => {
    const { monitor, store, getOrder, locks } = setup(() => 60_000_000n);
    store.positions.push(position(1, MINT_A), position(2, MINT_B));
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = locks.run(MINT_A, () => gate);
    const run = monitor.runOnce();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getOrder).toHaveBeenCalledTimes(2);
    release();
    await Promise.all([holder, run]);
    expect(monitor.valuation(1)?.netValueLamports).toBe(59_795_000n);
  });

  it('discards a quote when the position was sold while it was being quoted', async () => {
    const { monitor, store } = setup((mint) => {
      // A follow-sell halves the position while this take-profit quote is in flight.
      const current = store.positions[0];
      if (mint === MINT_A && current !== undefined) {
        store.positions[0] = { ...current, tokenAmountRaw: 500_000_000n };
      }
      return 101_000_000n;
    });
    store.positions.push(position(1, MINT_A));
    await monitor.runOnce();
    expect(store.trades).toHaveLength(0);
    expect(store.positions[0]).toMatchObject({ status: 'open', tokenAmountRaw: 500_000_000n });
  });

  it('writes off a position past max hold whose quotes keep failing with a client error', async () => {
    const { monitor, store, advanceMinutes } = setup(
      () => new JupiterApiError('getOrder', 400, 'token not tradable'),
    );
    store.positions.push(position(1, MINT_A));
    advanceMinutes(231);
    for (let i = 1; i < UNROUTABLE_AFTER_CLIENT_ERRORS; i++) {
      await monitor.runOnce();
    }
    expect(store.positions[0]?.status).toBe('open');
    await monitor.runOnce();
    expect(store.positions[0]).toMatchObject({ status: 'closed', closeReason: 'unsellable' });
  });

  it('keeps a position open while Jupiter itself is failing', async () => {
    const { monitor, store, advanceMinutes } = setup(
      () => new JupiterApiError('getOrder', 429, 'rate limited'),
    );
    store.positions.push(position(1, MINT_A));
    advanceMinutes(231);
    for (let i = 0; i < UNROUTABLE_AFTER_CLIENT_ERRORS + 2; i++) {
      await monitor.runOnce();
    }
    expect(store.positions[0]?.status).toBe('open');
  });
});
