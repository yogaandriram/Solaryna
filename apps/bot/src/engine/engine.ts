import type { RiskLimits } from '@solaryna/config';
import {
  Decimal,
  evaluateLocalRisk,
  evaluateMarketRisk,
  followSellTokenAmount,
  zonedDayRange,
  type RiskReason,
  type SwapEvent,
  type SwapSide,
} from '@solaryna/core';
import type { NewSignal } from '@solaryna/db';
import type { Logger } from 'pino';
import type { Executor, PrepareResult, TradeFill } from '../executor/types';
import type { NewSwapContext } from '../ingest/ingestor';
import type { JupiterClient, JupiterToken } from '../jupiter/client';
import { RequestExpiredError } from '../jupiter/rate-limiter';
import type { TrackedWalletInfo } from '../wallets/registry';
import type { KeyedMutex } from './locks';
import { chargedFeesLamports, recordSale, tradeValues, type TradingEvents } from './sell';
import type { TradingStore } from './store';

export type { TradingEvents } from './sell';

export type SignalOutcome =
  | { decision: 'accepted'; side: SwapSide; fill: TradeFill; soldPct: Decimal | null }
  | { decision: 'rejected'; side: SwapSide; reasons: RiskReason[] }
  | { decision: 'failed'; side: SwapSide; message: string };

export interface EngineDeps {
  store: TradingStore;
  executor: Executor;
  jupiter: Pick<JupiterClient, 'getToken'>;
  locks: KeyedMutex;
  limits: RiskLimits;
  displayTimeZone: string;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  events: TradingEvents;
  logger: Logger;
}

export interface Engine {
  handleSwap(
    event: SwapEvent,
    wallet: TrackedWalletInfo,
    context: NewSwapContext,
  ): Promise<SignalOutcome>;
}

const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 300);

/**
 * Turns tracked-wallet swaps into signals. Buys pass a database-only risk stage, wait
 * COPY_DELAY_MS, then a market stage judged on the one quote that is executed. Sells follow the
 * wallet that opened the position, in proportion. Every signal is stored with its decision.
 */
export function createEngine(deps: EngineDeps): Engine {
  const { store, executor, limits } = deps;
  const mode = executor.mode;
  /** Tokens with a buy in flight: they count as held and as open positions. */
  const pendingBuys = new Set<string>();

  function signalRow(
    event: SwapEvent,
    wallet: TrackedWalletInfo,
    context: NewSwapContext,
    decision: 'accepted' | 'rejected',
    reasons: RiskReason[],
    riskInputs: Record<string, unknown>,
  ): NewSignal {
    return {
      swapEventId: context.swapEventId,
      trackedWalletId: wallet.id,
      mode,
      decision,
      reasons,
      riskInputs,
      receivedAt: context.receivedAt,
    };
  }

  async function reject(
    event: SwapEvent,
    wallet: TrackedWalletInfo,
    context: NewSwapContext,
    reasons: RiskReason[],
    riskInputs: Record<string, unknown>,
  ): Promise<SignalOutcome> {
    await store.insertSignal(signalRow(event, wallet, context, 'rejected', reasons, riskInputs));
    deps.logger.info(
      { signature: event.signature, side: event.side, reasons: reasons.map((r) => r.code) },
      'Signal rejected',
    );
    return { decision: 'rejected', side: event.side, reasons };
  }

  async function handleBuy(
    event: SwapEvent,
    wallet: TrackedWalletInfo,
    context: NewSwapContext,
  ): Promise<SignalOutcome> {
    const token = event.tokenMint;
    // Claimed synchronously, before any await, so a simultaneous buy of the same token sees it.
    const claimed = !pendingBuys.has(token);
    const otherPending = [...pendingBuys].filter((mint) => mint !== token);
    pendingBuys.add(token);
    try {
      const day = zonedDayRange(deps.now(), deps.displayTimeZone);
      const [paused, open, realizedToday, blacklisted, cooldownUntil] = await Promise.all([
        store.isTradingPaused(),
        store.listOpenPositions(mode),
        store.sumRealizedPnl(mode, day.from, day.to),
        store.isTokenBlacklisted(token),
        store.getWalletCooldown(wallet.id),
      ]);
      const heldTokens = new Set([...open.map((p) => p.tokenMint), ...otherPending]);
      const holdingToken = !claimed || heldTokens.has(token);
      heldTokens.delete(token);

      const riskInputs: Record<string, unknown> = {
        tradingPaused: paused,
        openPositionCount: heldTokens.size,
        holdingToken,
        realizedPnlTodayLamports: realizedToday.toString(),
        tokenBlacklisted: blacklisted,
        walletCooldownUntil: cooldownUntil?.toISOString() ?? null,
        signalAgeMs: deps.now().getTime() - event.blockTime.getTime(),
        quoteMint: event.quoteMint,
      };
      const local = evaluateLocalRisk({
        limits,
        tradingPaused: paused,
        openPositionCount: heldTokens.size,
        holdingToken,
        realizedPnlTodayLamports: realizedToday,
        tokenBlacklisted: blacklisted,
        walletCooldownUntil: cooldownUntil,
        signalBlockTime: event.blockTime,
        now: deps.now(),
      });
      if (local.decision === 'rejected') {
        return await reject(event, wallet, context, local.reasons, riskInputs);
      }

      await deps.sleep(limits.copyDelayMs);

      const expiresAt = event.blockTime.getTime() + limits.maxSignalAgeSeconds * 1000;
      const tooOld = (): RiskReason => ({
        code: 'signal_too_old',
        detail: {
          ageSeconds: Math.floor((deps.now().getTime() - event.blockTime.getTime()) / 1000),
          maxSeconds: limits.maxSignalAgeSeconds,
        },
      });
      if (deps.now().getTime() > expiresAt) {
        return await reject(event, wallet, context, [tooOld()], riskInputs);
      }

      let tokenInfo: JupiterToken | null;
      try {
        tokenInfo = await deps.jupiter.getToken(token, 'buy', { expiresAt });
      } catch (error) {
        if (error instanceof RequestExpiredError) {
          return await reject(event, wallet, context, [tooOld()], riskInputs);
        }
        deps.logger.warn({ err: error, tokenMint: token }, 'Token data lookup failed');
        tokenInfo = null;
      }
      if (tokenInfo !== null) {
        const market = tokenInfo.market;
        Object.assign(riskInputs, {
          liquidityUsd: market.liquidityUsd?.toString() ?? null,
          mintAuthorityActive: market.mintAuthorityActive,
          freezeAuthorityActive: market.freezeAuthorityActive,
          suspicious: market.suspicious,
          tokenCreatedAt: market.createdAt?.toISOString() ?? null,
        });
        await store
          .saveTokenMarketData({
            mint: token,
            decimals: tokenInfo.decimals,
            liquidityUsd: market.liquidityUsd,
            mintAuthorityActive: market.mintAuthorityActive,
            freezeAuthorityActive: market.freezeAuthorityActive,
            tokenCreatedAt: market.createdAt,
            fetchedAt: deps.now(),
          })
          .catch((error: unknown) => {
            deps.logger.warn({ err: error, tokenMint: token }, 'Saving token market data failed');
          });
      }

      let prepared: PrepareResult;
      try {
        prepared = await executor.prepareBuy(
          { tokenMint: token, solAmountLamports: limits.maxSolPerTradeLamports },
          'buy',
          { expiresAt },
        );
      } catch (error) {
        if (error instanceof RequestExpiredError) {
          return await reject(event, wallet, context, [tooOld()], riskInputs);
        }
        const message = errorText(error);
        await reject(
          event,
          wallet,
          context,
          [{ code: 'quote_failed', detail: { error: message } }],
          riskInputs,
        );
        deps.events.executionError({ tokenMint: token, side: 'buy', message });
        return { decision: 'failed', side: 'buy', message };
      }
      if (prepared.ok) {
        Object.assign(riskInputs, {
          priceImpactPct: prepared.order.priceImpactPct.toString(),
          quoteOutAmountRaw: prepared.order.outAmountRaw.toString(),
          quotedAt: prepared.order.quotedAt.toISOString(),
        });
      }

      const market = evaluateMarketRisk({
        limits,
        token: tokenInfo?.market ?? null,
        quote: prepared.ok ? { priceImpactPct: prepared.order.priceImpactPct } : null,
      });
      if (market.decision === 'rejected' || !prepared.ok) {
        return await reject(event, wallet, context, market.reasons, riskInputs);
      }
      if (prepared.order.outAmountRaw <= 0n) {
        return await reject(event, wallet, context, [{ code: 'no_route' }], riskInputs);
      }
      if (await store.isTradingPaused()) {
        return await reject(event, wallet, context, [{ code: 'trading_paused' }], riskInputs);
      }

      const fill = await executor.execute(prepared.order);
      const opened = await store.openPosition({
        signal: signalRow(event, wallet, context, 'accepted', [], riskInputs),
        position: {
          mode,
          status: 'open',
          tokenMint: token,
          tokenDecimals: event.tokenDecimals,
          trackedWalletId: wallet.id,
          initialTokenAmountRaw: fill.tokenAmountRaw,
          tokenAmountRaw: fill.tokenAmountRaw,
          costLamports: fill.solAmountLamports,
          proceedsLamports: 0n,
          feesLamports: chargedFeesLamports(fill),
          realizedPnlLamports: 0n,
          openedAt: fill.executedAt,
        },
        trade: tradeValues(mode, fill, 'copy_buy', event.tokenDecimals, null),
      });
      const position = await store.getPosition(opened.positionId);
      if (position !== undefined) {
        deps.events.tradeExecuted({
          fill,
          position,
          walletEvent: event,
          reason: 'copy_buy',
          realizedPnlLamports: null,
        });
      }
      deps.logger.info(
        { signature: event.signature, tokenMint: token, positionId: opened.positionId },
        'Paper buy executed',
      );
      return { decision: 'accepted', side: 'buy', fill, soldPct: null };
    } finally {
      if (claimed) {
        pendingBuys.delete(token);
      }
    }
  }

  async function handleSell(
    event: SwapEvent,
    wallet: TrackedWalletInfo,
    context: NewSwapContext,
  ): Promise<SignalOutcome> {
    const token = event.tokenMint;
    const riskInputs: Record<string, unknown> = {
      walletSoldRaw: event.tokenAmountRaw.toString(),
      walletBalanceBeforeRaw: context.walletTokenBalanceBeforeRaw.toString(),
    };
    const held = await store.findOpenPositionByToken(mode, token);
    if (held === undefined || held.trackedWalletId !== wallet.id) {
      return reject(event, wallet, context, [{ code: 'not_holding' }], riskInputs);
    }

    await deps.sleep(limits.copyDelayMs);

    return deps.locks.run(token, async () => {
      // Re-read inside the lock: the monitor may have sold or closed it meanwhile.
      const position = await store.getPosition(held.id);
      if (position?.status !== 'open') {
        return reject(event, wallet, context, [{ code: 'not_holding' }], riskInputs);
      }
      const amount = followSellTokenAmount(
        position.tokenAmountRaw,
        event.tokenAmountRaw,
        context.walletTokenBalanceBeforeRaw,
      );
      riskInputs.sellAmountRaw = amount.toString();
      if (amount <= 0n) {
        return reject(event, wallet, context, [{ code: 'sell_amount_zero' }], riskInputs);
      }
      if (await store.isTradingPaused()) {
        return reject(event, wallet, context, [{ code: 'trading_paused' }], riskInputs);
      }
      const prepared = await executor.prepareSell(
        { tokenMint: token, tokenAmountRaw: amount },
        'exit',
      );
      if (!prepared.ok) {
        return reject(event, wallet, context, [{ code: 'no_route' }], riskInputs);
      }
      if (await store.isTradingPaused()) {
        return reject(event, wallet, context, [{ code: 'trading_paused' }], riskInputs);
      }
      const fill = await executor.execute(prepared.order);
      await recordSale(
        { store, events: deps.events, mode },
        {
          position,
          fill,
          reason: 'follow_sell',
          signal: signalRow(event, wallet, context, 'accepted', [], riskInputs),
          walletEvent: event,
        },
      );
      const soldPct = new Decimal(amount.toString())
        .div(position.tokenAmountRaw.toString())
        .mul(100)
        .toDecimalPlaces(2);
      return { decision: 'accepted', side: 'sell', fill, soldPct } satisfies SignalOutcome;
    });
  }

  return {
    async handleSwap(event, wallet, context) {
      try {
        return event.side === 'buy'
          ? await handleBuy(event, wallet, context)
          : await handleSell(event, wallet, context);
      } catch (error) {
        const message = errorText(error);
        deps.logger.error(
          { err: error, signature: event.signature, tokenMint: event.tokenMint, side: event.side },
          'Signal handling failed',
        );
        deps.events.executionError({ tokenMint: event.tokenMint, side: event.side, message });
        return { decision: 'failed', side: event.side, message };
      }
    },
  };
}
