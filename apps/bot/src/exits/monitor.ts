import type { RiskLimits } from '@solaryna/config';
import { BASE_NETWORK_FEE_LAMPORTS, evaluateExit, remainingCostLamports } from '@solaryna/core';
import type { Logger } from 'pino';
import type { KeyedMutex } from '../engine/locks';
import { positionState, recordSale, type TradingEvents } from '../engine/sell';
import type { TradingStore } from '../engine/store';
import type { Executor, TradeFill } from '../executor/types';

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
  limits: RiskLimits;
  priorityFeeLamports: bigint;
  now: () => Date;
  events: TradingEvents;
  logger: Logger;
  intervalMs?: number;
}

/**
 * Every 30 s: quotes a sale of each open position's remainder (monitor priority) and exits on
 * take-profit, stop-loss or max hold with that same quote. A position without a route past max
 * hold is closed at value 0 (`unsellable`). While paused, exits wait for /resume.
 */
export function createPositionMonitor(deps: PositionMonitorDeps): PositionMonitor {
  const { store, executor, limits } = deps;
  const mode = executor.mode;
  const valuations = new Map<number, Valuation>();
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function check(positionId: number): Promise<void> {
    const position = await store.getPosition(positionId);
    if (position?.status !== 'open') {
      valuations.delete(positionId);
      return;
    }
    const remainingCost = remainingCostLamports(positionState(position));
    const prepared = await executor.prepareSell(
      { tokenMint: position.tokenMint, tokenAmountRaw: position.tokenAmountRaw },
      'monitor',
    );
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
      deps.logger.info({ positionId, trigger }, 'Position exited');
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      deps.events.executionError({ tokenMint: position.tokenMint, side: 'sell', message });
      throw error;
    }
  }

  async function runCycle(): Promise<void> {
    const open = await store.listOpenPositions(mode);
    const openIds = new Set(open.map((p) => p.id));
    for (const id of valuations.keys()) {
      if (!openIds.has(id)) {
        valuations.delete(id);
      }
    }
    for (const position of open) {
      try {
        await deps.locks.run(position.tokenMint, () => check(position.id));
      } catch (error) {
        deps.logger.warn({ err: error, positionId: position.id }, 'Position check failed');
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
