import type { DashboardPosition, PositionRow } from '@solaryna/db';
import { describe, expect, it } from 'vitest';
import { positionRow } from './positions';

const NOW = new Date('2026-10-31T05:00:00Z');

function position(overrides: Partial<PositionRow>): DashboardPosition {
  return {
    position: {
      id: 1,
      mode: 'paper',
      status: 'open',
      tokenMint: 'J8M2wM8vtBLZJfajpczrjbs78PWhW1sqVFVJdE5d43jX',
      tokenDecimals: 6,
      trackedWalletId: 1,
      openedFromSignalId: 1,
      initialTokenAmountRaw: 1_000n,
      tokenAmountRaw: 1_000n,
      costLamports: 100_000_000n,
      proceedsLamports: 0n,
      feesLamports: 1_000_000n,
      realizedPnlLamports: null,
      closeReason: null,
      lastValueLamports: null,
      lastValuedAt: null,
      openedAt: new Date('2026-10-31T02:00:00Z'),
      closedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    },
    tokenSymbol: null,
    walletId: 1,
    walletAddress: 'Fake1111111111111111111111111111111111111111',
    walletLabel: null,
  };
}

describe('positionRow', () => {
  it('has no value or PnL for an open position without a route', () => {
    const row = positionRow(position({ lastValuedAt: NOW }), NOW);
    expect(row.costLamports).toBe(100_000_000n);
    expect(row.valueLamports).toBeNull();
    expect(row.pnlLamports).toBeNull();
    expect(row.pnlPct).toBeNull();
    expect(row.ageMs).toBe(3 * 3_600_000);
    expect(row.durationMs).toBeNull();
    expect(row.closeReasonLabel).toBeNull();
  });

  it('estimates PnL for a valued open position against its remaining cost', () => {
    const row = positionRow(
      position({ lastValueLamports: 61_000_000n, lastValuedAt: NOW, tokenAmountRaw: 500n }),
      NOW,
    );
    // Half sold: remaining cost 50_000_000, buy fees already realized.
    expect(row.costLamports).toBe(50_000_000n);
    expect(row.valueLamports).toBe(61_000_000n);
    expect(row.pnlLamports).toBe(11_000_000n);
    expect(row.pnlPct?.toString()).toBe('22');
  });

  it('shows the realized loss, the duration and the reason of a closed position', () => {
    const row = positionRow(
      position({
        status: 'closed',
        tokenAmountRaw: 0n,
        proceedsLamports: 70_000_000n,
        feesLamports: 2_000_000n,
        realizedPnlLamports: -32_000_000n,
        closeReason: 'stop_loss',
        closedAt: new Date('2026-10-31T04:30:00Z'),
      }),
      NOW,
    );
    expect(row.costLamports).toBe(100_000_000n);
    expect(row.valueLamports).toBe(70_000_000n);
    expect(row.pnlLamports).toBe(-32_000_000n);
    expect(row.pnlPct?.toString()).toBe('-32');
    expect(row.durationMs).toBe(2.5 * 3_600_000);
    expect(row.closeReasonLabel).toBe('stop-loss');
  });
});
