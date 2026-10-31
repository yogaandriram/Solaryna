import type { RiskLimits } from '@solaryna/config';
import { Decimal } from '@solaryna/core';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createRiskLimitsSource } from './limits-source';

const base: RiskLimits = {
  maxSolPerTradeLamports: 50_000_000n,
  maxOpenPositions: 5,
  dailyLossLimitLamports: 200_000_000n,
  minLiquidityUsd: new Decimal(20000),
  maxSlippageBps: 300,
  maxPriorityFeeLamports: 200_000n,
  copyDelayMs: 3000,
  takeProfitPct: new Decimal(100),
  stopLossPct: new Decimal(30),
  maxHoldMinutes: 240,
  maxSignalAgeSeconds: 30,
};

describe('createRiskLimitsSource', () => {
  it('starts from .env and applies only stricter overrides on refresh', async () => {
    const load = vi.fn<() => Promise<unknown>>();
    const source = createRiskLimitsSource({ base, load, logger: pino({ level: 'silent' }) });
    expect(source.current()).toBe(base);

    load.mockResolvedValueOnce({ maxOpenPositions: '2', maxSolPerTradeLamports: '900000000' });
    await source.refresh();
    expect(source.current().maxOpenPositions).toBe(2);
    expect(source.current().maxSolPerTradeLamports).toBe(50_000_000n);
    expect(source.current().copyDelayMs).toBe(3000);

    load.mockResolvedValueOnce(null);
    await source.refresh();
    expect(source.current().maxOpenPositions).toBe(5);
  });

  it('keeps the previous limits when loading fails', async () => {
    const load = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce({ maxHoldMinutes: '60' })
      .mockRejectedValueOnce(new Error('db down'));
    const source = createRiskLimitsSource({ base, load, logger: pino({ level: 'silent' }) });
    await source.refresh();
    await source.refresh();
    expect(source.current().maxHoldMinutes).toBe(60);
  });
});
