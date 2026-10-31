import type { RiskLimits } from '@solaryna/config';
import { Decimal, WSOL_MINT, type SwapEvent, type TokenMarketData } from '@solaryna/core';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createPaperExecutor } from '../executor/paper';
import type { NewSwapContext } from '../ingest/ingestor';
import { JupiterApiError, type JupiterClient, type JupiterToken } from '../jupiter/client';
import { RequestExpiredError } from '../jupiter/rate-limiter';
import type { TrackedWalletInfo } from '../wallets/registry';
import { createEngine, type SignalOutcome, type TradingEvents } from './engine';
import { createFakeTradingStore } from './fake-store';
import { createKeyedMutex } from './locks';

const MINT_A = 'AbrEhdN9Zsb5AvE5Pubd9VkUUr6ufAHfZ9zo7KAppump';
const MINT_B = '4CLJSkwJ7JsNvrtZrVwqcXecYrAwUTSkTC1p7gzqpump';
const START = new Date('2026-10-31T05:00:00Z').getTime();
const WALLET_A: TrackedWalletInfo = { id: 1, address: 'WalletA', label: 'alpha' };
const WALLET_B: TrackedWalletInfo = { id: 2, address: 'WalletB', label: null };

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

const cleanToken: TokenMarketData = {
  liquidityUsd: new Decimal(50_000),
  mintAuthorityActive: false,
  freezeAuthorityActive: false,
  suspicious: false,
  createdAt: null,
};

function setup(options: { limits?: Partial<RiskLimits>; market?: Partial<TokenMarketData> } = {}) {
  let time = START;
  const now = () => new Date(time);
  const store = createFakeTradingStore();
  const onSleep = vi.fn<(ms: number) => void>();
  const sleep = vi.fn(async (ms: number) => {
    time += ms;
    onSleep(ms);
    await Promise.resolve();
  });
  const getToken = vi.fn<JupiterClient['getToken']>((mint) =>
    Promise.resolve<JupiterToken>({
      mint,
      decimals: 6,
      market: { ...cleanToken, ...options.market },
      usdPrice: null,
    }),
  );
  // 1 lamport buys 20 raw tokens; selling returns the same rate.
  const getOrder = vi.fn<JupiterClient['getOrder']>((params) => {
    const buy = params.inputMint === WSOL_MINT;
    const out = buy ? params.amountRaw * 20n : params.amountRaw / 20n;
    return Promise.resolve({
      inAmountRaw: params.amountRaw,
      outAmountRaw: out,
      minOutAmountRaw: out,
      priceImpactPct: new Decimal('-0.5'),
      slippageBps: params.slippageBps,
      feeBps: 0,
      platformFee: null,
      inUsdValue: null,
      outUsdValue: null,
      router: 'metis',
      snapshot: {},
    });
  });
  const executor = createPaperExecutor({
    jupiter: { getOrder },
    priorityFeeLamports: 200_000n,
    now,
  });
  const events = {
    tradeExecuted: vi.fn<TradingEvents['tradeExecuted']>(),
    positionClosed: vi.fn<TradingEvents['positionClosed']>(),
    executionError: vi.fn<TradingEvents['executionError']>(),
  };
  let currentLimits: RiskLimits = { ...limits, ...options.limits };
  const setLimits = (changes: Partial<RiskLimits>) => {
    currentLimits = { ...currentLimits, ...changes };
  };
  const engine = createEngine({
    store,
    executor,
    jupiter: { getToken },
    locks: createKeyedMutex(),
    limits: () => currentLimits,
    displayTimeZone: 'Asia/Jakarta',
    now,
    sleep,
    events,
    logger: pino({ level: 'silent' }),
  });

  let nextId = 1;
  function swap(
    wallet: TrackedWalletInfo,
    side: SwapEvent['side'],
    overrides: Partial<SwapEvent> = {},
    balanceBefore = 0n,
  ): [SwapEvent, TrackedWalletInfo, NewSwapContext] {
    const id = nextId++;
    return [
      {
        signature: `sig-${id}`,
        slot: 1n,
        blockTime: new Date(time - 2000),
        wallet: wallet.address,
        side,
        tokenMint: MINT_A,
        tokenAmountRaw: 1000n,
        tokenDecimals: 6,
        quoteMint: WSOL_MINT,
        quoteAmountRaw: 40_000_000n,
        quoteDecimals: 9,
        source: 'pumpfun',
        ...overrides,
      },
      wallet,
      { swapEventId: id, receivedAt: now(), walletTokenBalanceBeforeRaw: balanceBefore },
    ];
  }

  return { engine, store, sleep, onSleep, getToken, getOrder, events, swap, now, setLimits };
}

const codes = (outcome: SignalOutcome) =>
  outcome.decision === 'rejected' ? outcome.reasons.map((r) => r.code) : [];

describe('engine: buy signals', () => {
  it('follows a buy that passes every rule after the copy delay', async () => {
    const { engine, store, sleep, events, swap } = setup();
    const outcome = await engine.handleSwap(...swap(WALLET_A, 'buy'));

    expect(outcome.decision).toBe('accepted');
    expect(sleep).toHaveBeenCalledWith(3000);
    expect(store.positions).toHaveLength(1);
    expect(store.positions[0]).toMatchObject({
      mode: 'paper',
      status: 'open',
      tokenMint: MINT_A,
      tokenDecimals: 6,
      trackedWalletId: 1,
      initialTokenAmountRaw: 1_000_000_000n,
      tokenAmountRaw: 1_000_000_000n,
      costLamports: 50_000_000n,
      proceedsLamports: 0n,
      feesLamports: 205_000n,
      realizedPnlLamports: 0n,
    });
    expect(store.trades[0]).toMatchObject({
      side: 'buy',
      reason: 'copy_buy',
      status: 'simulated',
      solAmountLamports: 50_000_000n,
      // 0.05 SOL for 1000 whole tokens.
      priceSol: '0.00005',
    });
    expect(store.signals[0]).toMatchObject({ decision: 'accepted', reasons: [], swapEventId: 1 });
    expect(store.signals[0]?.riskInputs).toMatchObject({
      openPositionCount: 0,
      liquidityUsd: '50000',
    });
    expect(events.tradeExecuted).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'copy_buy', realizedPnlLamports: null }),
    );
  });

  it('rejects locally while paused without calling Jupiter', async () => {
    const { engine, store, getToken, getOrder, sleep, swap } = setup();
    store.settings.set('trading_paused', true);
    const outcome = await engine.handleSwap(...swap(WALLET_A, 'buy'));
    expect(codes(outcome)).toEqual(['trading_paused']);
    expect(getToken).not.toHaveBeenCalled();
    expect(getOrder).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
    expect(store.signals[0]).toMatchObject({ decision: 'rejected' });
  });

  it('rejects once the daily loss limit is reached', async () => {
    const { engine, store, swap, now } = setup();
    store.trades.push({
      id: 99,
      positionId: 1,
      mode: 'paper',
      side: 'sell',
      reason: 'stop_loss',
      status: 'simulated',
      tokenMint: MINT_B,
      tokenAmountRaw: 1n,
      tokenDecimals: 6,
      solAmountLamports: 1n,
      networkFeeLamports: 0n,
      priorityFeeLamports: 0n,
      dexFeeLamports: 0n,
      realizedPnlLamports: -200_000_000n,
      executedAt: now(),
    });
    expect(codes(await engine.handleSwap(...swap(WALLET_A, 'buy')))).toEqual(['daily_loss_limit']);
  });

  it('rejects low liquidity at the market stage without executing', async () => {
    const { engine, store, swap } = setup({ market: { liquidityUsd: new Decimal(12_300) } });
    const outcome = await engine.handleSwap(...swap(WALLET_A, 'buy'));
    expect(outcome).toEqual({
      decision: 'rejected',
      side: 'buy',
      reasons: [{ code: 'liquidity_below_min', detail: { actual: '12300', min: '20000' } }],
    });
    expect(store.positions).toHaveLength(0);
    expect(store.trades).toHaveLength(0);
  });

  it('checks the kill switch again right before executing', async () => {
    const { engine, store, onSleep, swap } = setup();
    onSleep.mockImplementation(() => store.settings.set('trading_paused', true));
    expect(codes(await engine.handleSwap(...swap(WALLET_A, 'buy')))).toEqual(['trading_paused']);
    expect(store.positions).toHaveLength(0);
  });

  it('opens only one position when two wallets buy the same token at once', async () => {
    const { engine, store, swap } = setup();
    const outcomes = await Promise.all([
      engine.handleSwap(...swap(WALLET_A, 'buy')),
      engine.handleSwap(...swap(WALLET_B, 'buy')),
    ]);
    expect(outcomes.map((o) => o.decision).sort()).toEqual(['accepted', 'rejected']);
    expect(outcomes.flatMap(codes)).toEqual(['already_holding']);
    expect(store.positions).toHaveLength(1);
  });

  it('counts buys in flight against the open position limit', async () => {
    const { engine, store, swap } = setup({ limits: { maxOpenPositions: 1 } });
    const outcomes = await Promise.all([
      engine.handleSwap(...swap(WALLET_A, 'buy', { tokenMint: MINT_A })),
      engine.handleSwap(...swap(WALLET_B, 'buy', { tokenMint: MINT_B })),
    ]);
    expect(outcomes.flatMap(codes)).toEqual(['max_open_positions']);
    expect(store.positions).toHaveLength(1);
  });

  it('reads the runtime limits again for every signal', async () => {
    const { engine, store, swap, setLimits } = setup();
    await engine.handleSwap(...swap(WALLET_A, 'buy', { tokenMint: MINT_A }));
    setLimits({ maxOpenPositions: 1 });
    const second = await engine.handleSwap(...swap(WALLET_B, 'buy', { tokenMint: MINT_B }));
    expect(codes(second)).toEqual(['max_open_positions']);
    expect(store.positions).toHaveLength(1);
  });

  it('quotes buys and follow-sells with the runtime slippage limit', async () => {
    const { engine, swap, getOrder, setLimits } = setup();
    setLimits({ maxSlippageBps: 120 });
    await engine.handleSwap(...swap(WALLET_A, 'buy', { tokenMint: MINT_A }));
    setLimits({ maxSlippageBps: 80 });
    await engine.handleSwap(
      ...swap(WALLET_A, 'sell', { tokenMint: MINT_A, tokenAmountRaw: 250n }, 1000n),
    );
    expect(getOrder.mock.calls.map(([params]) => params.slippageBps)).toEqual([120, 80]);
  });

  it('rejects a stale signal before the delay, after the delay, or while queued', async () => {
    const stale = setup();
    const [event, wallet, context] = stale.swap(WALLET_A, 'buy');
    const old = { ...event, blockTime: new Date(START - 31_000) };
    expect(codes(await stale.engine.handleSwap(old, wallet, context))).toEqual(['signal_too_old']);
    expect(stale.getToken).not.toHaveBeenCalled();

    const late = setup();
    const [event2, wallet2, context2] = late.swap(WALLET_A, 'buy');
    const almost = { ...event2, blockTime: new Date(START - 28_000) };
    expect(codes(await late.engine.handleSwap(almost, wallet2, context2))).toEqual([
      'signal_too_old',
    ]);
    expect(late.getToken).not.toHaveBeenCalled();

    const queued = setup();
    queued.getToken.mockRejectedValueOnce(new RequestExpiredError());
    expect(codes(await queued.engine.handleSwap(...queued.swap(WALLET_A, 'buy')))).toEqual([
      'signal_too_old',
    ]);
    expect(queued.getToken.mock.calls[0]?.[2]).toEqual({ expiresAt: START - 2000 + 30_000 });
    expect(queued.getOrder).not.toHaveBeenCalled();
  });

  it('records a failed quote and reports the error', async () => {
    const { engine, store, getOrder, events, swap } = setup();
    getOrder.mockRejectedValueOnce(new JupiterApiError('getOrder', 500, 'internal'));
    const outcome = await engine.handleSwap(...swap(WALLET_A, 'buy'));
    expect(outcome.decision).toBe('failed');
    expect(store.signals[0]).toMatchObject({
      decision: 'rejected',
      reasons: [
        { code: 'quote_failed', detail: { error: 'Jupiter getOrder failed (HTTP 500): internal' } },
      ],
    });
    expect(events.executionError).toHaveBeenCalledWith(
      expect.objectContaining({ tokenMint: MINT_A, side: 'buy' }),
    );
  });

  it('treats a token data error as unavailable token data', async () => {
    const { engine, getToken, swap } = setup();
    getToken.mockRejectedValueOnce(new JupiterApiError('getToken', null, 'network error'));
    expect(codes(await engine.handleSwap(...swap(WALLET_A, 'buy')))).toEqual([
      'token_data_unavailable',
    ]);
  });
});

describe('engine: follow-sell', () => {
  async function withPosition() {
    const ctx = setup();
    await ctx.engine.handleSwap(...ctx.swap(WALLET_A, 'buy'));
    ctx.sleep.mockClear();
    ctx.getOrder.mockClear();
    return ctx;
  }

  it('sells the same share of the position as the wallet sold', async () => {
    const { engine, store, sleep, events, swap } = await withPosition();
    const outcome = await engine.handleSwap(
      ...swap(WALLET_A, 'sell', { tokenAmountRaw: 250n }, 1000n),
    );
    expect(outcome.decision).toBe('accepted');
    expect(outcome.decision === 'accepted' && outcome.soldPct?.toString()).toBe('25');
    expect(sleep).toHaveBeenCalledWith(3000);
    expect(store.trades[1]).toMatchObject({
      side: 'sell',
      reason: 'follow_sell',
      tokenAmountRaw: 250_000_000n,
      solAmountLamports: 12_500_000n,
      // 12.5M - 12.5M cost - 205k sell fees - 205k buy fees.
      realizedPnlLamports: -410_000n,
    });
    expect(store.positions[0]).toMatchObject({ status: 'open', tokenAmountRaw: 750_000_000n });
    expect(store.signals[1]).toMatchObject({ decision: 'accepted', swapEventId: 2 });
    expect(events.positionClosed).not.toHaveBeenCalled();
  });

  it('closes the position when the wallet sells everything', async () => {
    const { engine, store, events, swap } = await withPosition();
    await engine.handleSwap(...swap(WALLET_A, 'sell', { tokenAmountRaw: 1000n }, 1000n));
    expect(store.positions[0]).toMatchObject({ status: 'closed', closeReason: 'follow_sell' });
    expect(events.positionClosed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'follow_sell' }),
    );
  });

  it('ignores sells by other wallets or of tokens we do not hold', async () => {
    const { engine, store, getOrder, swap } = await withPosition();
    expect(codes(await engine.handleSwap(...swap(WALLET_B, 'sell')))).toEqual(['not_holding']);
    expect(
      codes(await engine.handleSwap(...swap(WALLET_A, 'sell', { tokenMint: MINT_B }))),
    ).toEqual(['not_holding']);
    expect(getOrder).not.toHaveBeenCalled();
    expect(store.positions[0]?.status).toBe('open');
  });

  it('skips a share that rounds down to zero without calling Jupiter', async () => {
    const { engine, getOrder, swap } = await withPosition();
    const outcome = await engine.handleSwap(
      ...swap(WALLET_A, 'sell', { tokenAmountRaw: 1n }, 10n ** 20n),
    );
    expect(codes(outcome)).toEqual(['sell_amount_zero']);
    expect(getOrder).not.toHaveBeenCalled();
  });

  it('does not sell while paused and leaves the position open', async () => {
    const { engine, store, swap } = await withPosition();
    store.settings.set('trading_paused', true);
    expect(codes(await engine.handleSwap(...swap(WALLET_A, 'sell', {}, 1000n)))).toEqual([
      'trading_paused',
    ]);
    expect(store.positions[0]?.status).toBe('open');
    expect(store.trades).toHaveLength(1);
  });

  it('does nothing when the monitor closed the position during the delay', async () => {
    const { engine, store, onSleep, swap } = await withPosition();
    onSleep.mockImplementation(() => {
      const position = store.positions[0];
      if (position !== undefined) {
        store.positions[0] = { ...position, status: 'closed', closeReason: 'take_profit' };
      }
    });
    expect(codes(await engine.handleSwap(...swap(WALLET_A, 'sell', {}, 1000n)))).toEqual([
      'not_holding',
    ]);
    expect(store.trades).toHaveLength(1);
  });

  it('follows a sell that arrives while the copy of its buy is still in flight', async () => {
    const { engine, store, swap } = setup();
    const buy = engine.handleSwap(...swap(WALLET_A, 'buy'));
    const sell = engine.handleSwap(...swap(WALLET_A, 'sell', { tokenAmountRaw: 1000n }, 1000n));
    expect((await buy).decision).toBe('accepted');
    expect((await sell).decision).toBe('accepted');
    expect(store.positions[0]).toMatchObject({ status: 'closed', closeReason: 'follow_sell' });
  });

  it('retries a follow-sell quote that failed once', async () => {
    const { engine, store, getOrder, swap } = await withPosition();
    getOrder.mockRejectedValueOnce(new JupiterApiError('getOrder', null, 'timed out'));
    const outcome = await engine.handleSwap(
      ...swap(WALLET_A, 'sell', { tokenAmountRaw: 1000n }, 1000n),
    );
    expect(outcome.decision).toBe('accepted');
    expect(getOrder).toHaveBeenCalledTimes(2);
    expect(store.positions[0]?.status).toBe('closed');
  });

  it('records the sell signal and reports the error when the quote keeps failing', async () => {
    const { engine, store, getOrder, events, swap } = await withPosition();
    getOrder.mockRejectedValue(new JupiterApiError('getOrder', 500, 'internal'));
    const outcome = await engine.handleSwap(...swap(WALLET_A, 'sell', {}, 1000n));
    expect(outcome.decision).toBe('failed');
    expect(store.signals[1]).toMatchObject({ decision: 'rejected', swapEventId: 2 });
    expect(store.signals[1]?.reasons.map((r) => r.code)).toEqual(['quote_failed']);
    expect(events.executionError).toHaveBeenCalledWith(
      expect.objectContaining({ tokenMint: MINT_A, side: 'sell' }),
    );
    expect(store.positions[0]?.status).toBe('open');
  });
});
