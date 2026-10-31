import { Decimal } from '@solaryna/core';

/** Window for the per-wallet signal counts on the wallet pages. */
export const STATS_DAYS = 30;

/** The bot reloads the tracked-wallet list on a timer, not on every dashboard change. */
export const RELOAD_NOTE = 'Bot memuat perubahan wallet dalam ±1 menit.';

/** Share of closed positions that won, in percent; null before any position closed. */
export function winRatePct(wins: number, closedPositions: number): Decimal | null {
  return closedPositions === 0 ? null : new Decimal(wins).div(closedPositions).times(100);
}
