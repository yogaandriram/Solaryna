import type { RiskLimits } from '@solaryna/config';
import {
  RUNTIME_LIMIT_KEYS,
  effectiveRiskLimits,
  parseRiskLimitOverrides,
  serializeRiskLimitOverrides,
} from '@solaryna/core';
import type { Logger } from 'pino';

export const RISK_LIMITS_REFRESH_MS = 15_000;

export interface RiskLimitsSource {
  /** The limits in force: `.env` tightened by the dashboard's overrides. */
  current(): RiskLimits;
  refresh(): Promise<void>;
  start(): void;
  stop(): void;
}

/**
 * Keeps the effective risk limits: the `.env` values (the ceiling) with the stricter runtime
 * overrides from the dashboard applied. Reloaded every 15 s and on demand; a failed load keeps
 * the previous limits.
 */
export function createRiskLimitsSource(options: {
  base: RiskLimits;
  load: () => Promise<unknown>;
  logger: Logger;
  intervalMs?: number;
}): RiskLimitsSource {
  const { base, logger } = options;
  let limits = base;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh(): Promise<void> {
    let next: RiskLimits;
    try {
      next = effectiveRiskLimits(base, parseRiskLimitOverrides(await options.load()));
    } catch (error) {
      logger.warn({ err: error }, 'Loading runtime risk limits failed; keeping the current ones');
      return;
    }
    const before = serializeRiskLimitOverrides(limits);
    const after = serializeRiskLimitOverrides(next);
    const changed = RUNTIME_LIMIT_KEYS.filter((key) => before[key] !== after[key]);
    limits = next;
    if (changed.length > 0) {
      logger.info({ changed, limits: after }, 'Risk limits updated');
    }
  }

  return {
    current: () => limits,
    refresh,
    start() {
      timer ??= setInterval(() => void refresh(), options.intervalMs ?? RISK_LIMITS_REFRESH_MS);
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
