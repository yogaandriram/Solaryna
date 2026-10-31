import {
  buildDailySummary,
  buildWeeklyReport,
  dueReports,
  zonedDateKey,
  zonedDayRange,
  type OpenPositionValue,
  type PeriodRange,
  type ReportPosition,
  type ReportSignal,
  type ReportTrade,
} from '@solaryna/core';
import type { Logger } from 'pino';
import type { TradingStore } from '../engine/store';
import { formatDailyReport, formatWeeklyReport } from '../telegram/trading-format';

export const DAILY_REPORT_CURSOR = 'last_daily_report';
export const WEEKLY_REPORT_CURSOR = 'last_weekly_report';
/** Local hour (TZ_DISPLAY) when the previous day's and week's reports go out. */
export const REPORT_HOUR = 7;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Report data for one trading mode; `from` inclusive, `to` exclusive. */
export interface ReportSource {
  trades(from: Date, to: Date): Promise<ReportTrade[]>;
  buySignals(from: Date, to: Date): Promise<ReportSignal[]>;
  closedPositions(from: Date, to: Date): Promise<ReportPosition[]>;
  /** Open positions valued with the monitor's latest quotes. */
  openForSummary(): Promise<OpenPositionValue[]>;
}

export interface ReportJobDeps {
  source: ReportSource;
  store: Pick<TradingStore, 'getSettingString' | 'setSettingString'>;
  /** Sends the messages; must reject when they were not delivered, so the report is retried. */
  send(messages: string[]): Promise<void>;
  timeZone: string;
  now: () => Date;
  logger: Logger;
  intervalMs?: number;
}

export interface ReportJob {
  tick(): Promise<void>;
  start(): void;
  /** Stops the timer and waits for a running tick to finish. */
  stop(): Promise<void>;
  /** Today so far, or the last 7 × 24 hours, for /report. */
  render(kind: 'day' | 'week'): Promise<string[]>;
}

/**
 * Sends the daily report and the Monday weekly report at 07:00 WIB. Cursors in `settings`
 * remember the last period sent and only move after a successful send; on the first start they
 * are initialized without sending, so a new install does not report empty history.
 */
export function createReportJob(deps: ReportJobDeps): ReportJob {
  const { source, store, timeZone } = deps;
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function daily(range: PeriodRange, partial: boolean): Promise<string[]> {
    const [trades, signals, closedPositions, open] = await Promise.all([
      source.trades(range.from, range.to),
      source.buySignals(range.from, range.to),
      source.closedPositions(range.from, range.to),
      source.openForSummary(),
    ]);
    const summary = buildDailySummary({ trades, closedPositions, signals, open });
    return formatDailyReport(summary, range, timeZone, { partial });
  }

  async function weekly(range: PeriodRange): Promise<string[]> {
    const [trades, signals, closedPositions] = await Promise.all([
      source.trades(range.from, range.to),
      source.buySignals(range.from, range.to),
      source.closedPositions(range.from, range.to),
    ]);
    return formatWeeklyReport(
      buildWeeklyReport({ trades, closedPositions, signals }),
      range,
      timeZone,
    );
  }

  async function deliver(
    cursor: string,
    range: PeriodRange,
    render: () => Promise<string[]>,
  ): Promise<void> {
    try {
      await deps.send(await render());
      await store.setSettingString(cursor, range.key);
      deps.logger.info({ cursor, period: range.key }, 'Report sent');
    } catch (error) {
      deps.logger.error({ err: error, cursor, period: range.key }, 'Report failed; will retry');
    }
  }

  async function runTick(): Promise<void> {
    const [lastDailyKey, lastWeeklyKey] = await Promise.all([
      store.getSettingString(DAILY_REPORT_CURSOR),
      store.getSettingString(WEEKLY_REPORT_CURSOR),
    ]);
    const due = dueReports({
      now: deps.now(),
      timeZone,
      reportHour: REPORT_HOUR,
      lastDailyKey,
      lastWeeklyKey,
    });
    if (due.initialize !== null) {
      await store.setSettingString(DAILY_REPORT_CURSOR, due.initialize.dailyKey);
      await store.setSettingString(WEEKLY_REPORT_CURSOR, due.initialize.weeklyKey);
      deps.logger.info(due.initialize, 'Report cursors initialized');
      return;
    }
    const { daily: dailyRange, weekly: weeklyRange } = due;
    if (dailyRange !== null) {
      await deliver(DAILY_REPORT_CURSOR, dailyRange, () => daily(dailyRange, false));
    }
    if (weeklyRange !== null) {
      await deliver(WEEKLY_REPORT_CURSOR, weeklyRange, () => weekly(weeklyRange));
    }
  }

  function tick(): Promise<void> {
    if (running !== null) {
      return running;
    }
    running = runTick()
      .catch((error: unknown) => {
        deps.logger.error({ err: error }, 'Report job tick failed');
      })
      .finally(() => {
        running = null;
      });
    return running;
  }

  return {
    tick,
    start() {
      if (timer === null) {
        void tick();
        timer = setInterval(() => void tick(), deps.intervalMs ?? 60_000);
      }
    },
    async stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      await running;
    },
    render(kind) {
      const now = deps.now();
      if (kind === 'day') {
        return daily({ ...zonedDayRange(now, timeZone), to: now }, true);
      }
      const from = new Date(now.getTime() - WEEK_MS);
      return weekly({ key: zonedDateKey(from, timeZone), from, to: now });
    },
  };
}
