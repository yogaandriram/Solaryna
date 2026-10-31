import {
  positionStateOf,
  remainingCostLamports,
  tradeReasonLabel,
  type Decimal,
} from '@solaryna/core';
import type { DashboardPosition } from '@solaryna/db';
import { pnlPct } from './format';
import { positionEstimate } from './overview';

export interface PositionRowView {
  /** Remaining cost of an open position; the whole cost of a closed one. */
  costLamports: bigint;
  /** Last valuation of an open position (null without one); proceeds of a closed one. */
  valueLamports: bigint | null;
  /** Estimated PnL of an open position (null without a valuation); realized PnL when closed. */
  pnlLamports: bigint | null;
  pnlPct: Decimal | null;
  ageMs: number;
  durationMs: number | null;
  closeReasonLabel: string | null;
}

export function positionRow({ position }: DashboardPosition, now: Date): PositionRowView {
  const ageMs = now.getTime() - position.openedAt.getTime();
  if (position.status === 'open') {
    const costLamports = remainingCostLamports(positionStateOf(position));
    const pnlLamports = positionEstimate(position);
    return {
      costLamports,
      valueLamports: position.lastValueLamports,
      pnlLamports,
      pnlPct: pnlLamports === null ? null : pnlPct(pnlLamports, costLamports),
      ageMs,
      durationMs: null,
      closeReasonLabel: null,
    };
  }
  const pnlLamports = position.realizedPnlLamports;
  return {
    costLamports: position.costLamports,
    valueLamports: position.proceedsLamports,
    pnlLamports,
    pnlPct: pnlLamports === null ? null : pnlPct(pnlLamports, position.costLamports),
    ageMs,
    durationMs:
      position.closedAt === null ? null : position.closedAt.getTime() - position.openedAt.getTime(),
    closeReasonLabel: position.closeReason === null ? null : tradeReasonLabel(position.closeReason),
  };
}
