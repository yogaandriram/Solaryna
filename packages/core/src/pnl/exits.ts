import { Decimal } from '../decimal';

export type ExitTrigger = 'take_profit' | 'stop_loss' | 'max_hold' | 'unsellable';

export interface ExitInput {
  remainingCostLamports: bigint;
  /** Sell quote for the whole remainder minus sell fees; null when there is no route. */
  netValueLamports: bigint | null;
  openedAt: Date;
  now: Date;
  takeProfitPct: Decimal;
  stopLossPct: Decimal;
  maxHoldMinutes: number;
}

/** Checks take-profit, then stop-loss, then max hold. Unpriced positions only exit at max hold. */
export function evaluateExit(input: ExitInput): ExitTrigger | null {
  const maxHoldReached =
    input.now.getTime() - input.openedAt.getTime() >= input.maxHoldMinutes * 60_000;
  if (input.netValueLamports === null) {
    return maxHoldReached ? 'unsellable' : null;
  }
  const net = new Decimal(input.netValueLamports.toString());
  const cost = new Decimal(input.remainingCostLamports.toString());
  if (net.gte(cost.mul(input.takeProfitPct.plus(100)).div(100))) {
    return 'take_profit';
  }
  if (net.lte(cost.mul(new Decimal(100).minus(input.stopLossPct)).div(100))) {
    return 'stop_loss';
  }
  return maxHoldReached ? 'max_hold' : null;
}
