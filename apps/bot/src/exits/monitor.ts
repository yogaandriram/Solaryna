import type { RiskLimits } from '@solaryna/config';
import { BASE_NETWORK_FEE_LAMPORTS, evaluateExit, remainingCostLamports } from '@solaryna/core';
import type { PositionRow } from '@solaryna/db';
import type { Logger } from 'pino';
import type { KeyedMutex } from '../engine/locks';
import { positionState, recordSale, type TradingEvents } from '../engine/sell';
import type { TradingStore } from '../engine/store';
import type { Executor, PrepareResult, TradeFill } from '../executor/types';
import { JupiterApiError } from '../jupiter/client';

/**
 * Consecutive client errors (HTTP 4xx other than 429) after which a token counts as having no
 * route: Jupiter rejecting a rugged token with a message we do not recognize as "no route".
 */
export const UNROUTABLE_AFTER_CLIENT_ERRORS = 10;

export interface Valuation {
  positionId: number;
  /** Sell quote for the whole remainder minus sell fees; null when there was no route. */
  netValueLamports: bigint | null;
  remainingCostLamports: bigint;
  at: Date;
}

export interface PositionMonitor {
  runOnce(): Promise<void>;
  start(): void;
  /** Stops the timer and waits for a running check to finish. */
  stop(): Promise<void>;
  valuation(positionId: number): Valuation | undefined;
}

export interface PositionMonitorDeps {
  store: TradingStore;
  executor: Executor;
  locks: KeyedMutex;
  /** Read once per cycle: the dashboard can tighten them at runtime. */
  limits: () => RiskLimits;
  priorityFeeLamports: bigint;
  now: () => Date;
  events: TradingEvents;
  logger: Logger;
  intervalMs?: number;
}

type Quote =
  { position: PositionRow; prepared: PrepareResult } | { position: PositionRow; error: unknown };

const isClientError = (error: unknown) =>
  error instanceof JupiterApiError &&
  error.status !== null &&
  error.status >= 400 &&
  error.status < 500 &&
  error.status !== 429;

/**
 * Every 30 s: quotes a sale of each open position's remainder (monitor priority) and exits on
 * take-profit, stop-loss or max hold with that same quote. All positions are quoted at once and
 * without a lock, so a busy rate limiter delays them together and never blocks a follow-sell;
 * each one is then re-read under its token lock and its quote dropped if the position changed.
 * A position without a route past max hold is closed at value 0 (`unsellable`). While paused,
 * exits wait for /resume.
 */
export function createPositionMonitor(deps: PositionMonitorDeps): PositionMonitor {
  const { store, executor } = deps;
  const mode = executor.mode;
  const valuations = new Map<number, Valuation>();
  const clientErrors = new Map<number, number>();
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function quote(position: PositionRow): Promise<Quote> {
    try {
      const prepared = await executor.prepareSell(
        { tokenMint: position.tokenMint, tokenAmountRaw: position.tokenAmountRaw },
        'monitor',
      );
      return { position, prepared };
    } catch (error) {
      return { position, error };
    }
  }

  async function check(quoted: Quote, limits: RiskLimits): Promise<void> {
    const positionId = quoted.position.id;
    const position = await store.getPosition(positionId);
    if (position?.status !== 'open') {
      valuations.delete(positionId);
      clientErrors.delete(positionId);
      return;
    }
    if (position.tokenAmountRaw !== quoted.position.tokenAmountRaw) {
      // Sold while it was quoted: the quote is for another amount. Next cycle quotes again.
      return;
    }

    let prepared: PrepareResult;
    if ('error' in quoted) {
      const count = isClientError(quoted.error) ? (clientErrors.get(positionId) ?? 0) + 1 : 0;
      clientErrors.set(positionId, count);
      if (count < UNROUTABLE_AFTER_CLIENT_ERRORS) {
        throw quoted.error;
      }
      prepared = { ok: false, reason: 'no_route' };
    } else {
      clientErrors.delete(positionId);
      prepared = quoted.prepared;
    }

    const remainingCost = remainingCostLamports(positionState(position));
    const now = deps.now();
    // The DEX fee is already deducted in outAmount; only the per-transaction fees remain.
    const netValue = prepared.ok
      ? prepared.order.outAmountRaw - BASE_NETWORK_FEE_LAMPORTS - deps.priorityFeeLamports
      : null;
    valuations.set(positionId, {
      positionId,
      netValueLamports: netValue,
      remainingCostLamports: remainingCost,
      at: now,
    });
    try {
      await store.savePositionValuation({
        positionId,
        tokenAmountRaw: position.tokenAmountRaw,
        netValueLamports: netValue,
        at: now,
      });
    } catch (error) {
      deps.logger.warn({ err: error, positionId }, 'Saving position valuation failed');
    }

    const trigger = evaluateExit({
      remainingCostLamports: remainingCost,
      netValueLamports: netValue,
      openedAt: position.openedAt,
      now,
      takeProfitPct: limits.takeProfitPct,
      stopLossPct: limits.stopLossPct,
      maxHoldMinutes: limits.maxHoldMinutes,
    });
    if (trigger === null) {
      return;
    }
    if (await store.isTradingPaused()) {
      deps.logger.info({ positionId, trigger }, 'Exit waiting for /resume');
      return;
    }

    try {
      let fill: TradeFill;
      if (prepared.ok) {
        fill = await executor.execute(prepared.order);
      } else {
        // No route past max hold: written off at zero so reports do not count it as value.
        fill = {
          side: 'sell',
          tokenMint: position.tokenMint,
          tokenAmountRaw: position.tokenAmountRaw,
          solAmountLamports: 0n,
          networkFeeLamports: 0n,
          priorityFeeLamports: 0n,
          dexFeeLamports: 0n,
          slippageBps: 0,
          solUsdPrice: null,
          quotedAt: now,
          executedAt: now,
          quoteSnapshot: null,
          txSignature: null,
        };
      }
      await recordSale(
        { store, events: deps.events, mode },
        { position, fill, reason: trigger, signal: null, walletEvent: null },
      );
      valuations.delete(positionId);
      clientErrors.delete(positionId);
      deps.logger.info({ positionId, trigger }, 'Position exited');
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      deps.events.executionError({ tokenMint: position.tokenMint, side: 'sell', message });
      throw error;
    }
  }

  async function runCycle(): Promise<void> {
    const limits = deps.limits();
    const open = await store.listOpenPositions(mode);
    const openIds = new Set(open.map((p) => p.id));
    for (const tracked of [valuations, clientErrors]) {
      for (const id of tracked.keys()) {
        if (!openIds.has(id)) {
          tracked.delete(id);
        }
      }
    }
    const quotes = await Promise.all(open.map(quote));
    for (const quoted of quotes) {
      try {
        await deps.locks.run(quoted.position.tokenMint, () => check(quoted, limits));
      } catch (error) {
        deps.logger.warn({ err: error, positionId: quoted.position.id }, 'Position check failed');
      }
    }
  }

  function runOnce(): Promise<void> {
    if (running !== null) {
      return Promise.resolve();
    }
    running = runCycle()
      .catch((error: unknown) => {
        deps.logger.error({ err: error }, 'Position monitor cycle failed');
      })
      .finally(() => {
        running = null;
      });
    return running;
  }

  return {
    runOnce,
    start() {
      if (timer === null) {
        void runOnce();
        timer = setInterval(() => void runOnce(), deps.intervalMs ?? 30_000);
      }
    },
    async stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      await running;
    },
    valuation: (positionId) => valuations.get(positionId),
  };
}
