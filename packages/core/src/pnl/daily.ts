import { zonedDateKey, zonedDayKeys } from '../time';

export interface DailyPnl {
  /** Zoned date `YYYY-MM-DD`. */
  key: string;
  pnlLamports: bigint;
}

/**
 * Realized PnL per zoned day for the last `days` days ending today, oldest first. Days without
 * a sale are zero; points outside the window are ignored.
 */
export function dailyPnlSeries(
  points: readonly { at: Date; pnlLamports: bigint }[],
  now: Date,
  days: number,
  timeZone: string,
): DailyPnl[] {
  const totals = new Map(zonedDayKeys(now, days, timeZone).map((key) => [key, 0n]));
  for (const point of points) {
    const key = zonedDateKey(point.at, timeZone);
    const total = totals.get(key);
    if (total !== undefined) {
      totals.set(key, total + point.pnlLamports);
    }
  }
  return [...totals].map(([key, pnlLamports]) => ({ key, pnlLamports }));
}
