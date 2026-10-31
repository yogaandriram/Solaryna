import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createFakeTradingStore } from '../engine/fake-store';
import { createReportJob, type ReportSource } from './reports';

const DAILY = 'last_daily_report';
const WEEKLY = 'last_weekly_report';
// Monday 2 Nov 2026, 07:05 WIB.
const MONDAY_MORNING = new Date('2026-11-02T00:05:00Z');

function setup(now: Date) {
  let time = now.getTime();
  const store = createFakeTradingStore();
  const source = {
    trades: vi.fn<ReportSource['trades']>(() => Promise.resolve([])),
    buySignals: vi.fn<ReportSource['buySignals']>(() => Promise.resolve([])),
    closedPositions: vi.fn<ReportSource['closedPositions']>(() => Promise.resolve([])),
    openForSummary: vi.fn<ReportSource['openForSummary']>(() => Promise.resolve([])),
  };
  const send = vi.fn<(messages: string[]) => Promise<void>>(() => Promise.resolve());
  const job = createReportJob({
    source,
    store,
    send,
    timeZone: 'Asia/Jakarta',
    now: () => new Date(time),
    logger: pino({ level: 'silent' }),
  });
  return {
    job,
    store,
    source,
    send,
    advanceMinutes: (minutes: number) => {
      time += minutes * 60_000;
    },
  };
}

describe('createReportJob', () => {
  it('only initializes the cursors on the first start', async () => {
    const { job, store, send } = setup(new Date('2026-10-31T05:00:00Z'));
    await job.tick();
    expect(send).not.toHaveBeenCalled();
    expect(await store.getSettingString(DAILY)).toBe('2026-10-30');
    expect(await store.getSettingString(WEEKLY)).toBe('2026-10-19');
  });

  it('sends the daily and weekly reports once when they are due', async () => {
    const { job, store, source, send, advanceMinutes } = setup(MONDAY_MORNING);
    await store.setSettingString(DAILY, '2026-10-30');
    await store.setSettingString(WEEKLY, '2026-10-19');

    await job.tick();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0].join('\n')).toContain('1 Nov 2026');
    expect(send.mock.calls[1]?.[0].join('\n')).toContain('Laporan mingguan PAPER');
    // The daily report covers Sunday 1 Nov in WIB.
    expect(source.trades.mock.calls[0]).toEqual([
      new Date('2026-10-31T17:00:00Z'),
      new Date('2026-11-01T17:00:00Z'),
    ]);
    expect(await store.getSettingString(DAILY)).toBe('2026-11-01');
    expect(await store.getSettingString(WEEKLY)).toBe('2026-10-26');

    advanceMinutes(1);
    await job.tick();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('keeps the cursor when sending fails, so the next tick retries', async () => {
    const { job, store, send } = setup(MONDAY_MORNING);
    await store.setSettingString(DAILY, '2026-10-31');
    await store.setSettingString(WEEKLY, '2026-10-26');
    send.mockRejectedValueOnce(new Error('telegram down'));

    await job.tick();
    expect(await store.getSettingString(DAILY)).toBe('2026-10-31');

    await job.tick();
    expect(send).toHaveBeenCalledTimes(2);
    expect(await store.getSettingString(DAILY)).toBe('2026-11-01');
  });

  it('renders today so far and the last seven days for /report', async () => {
    const { job, source } = setup(MONDAY_MORNING);
    const [day] = await job.render('day');
    expect(day).toContain('2 Nov 2026');
    expect(source.trades.mock.calls[0]).toEqual([new Date('2026-11-01T17:00:00Z'), MONDAY_MORNING]);

    const week = await job.render('week');
    expect(week.join('\n')).toContain('Laporan mingguan PAPER');
    expect(source.trades.mock.calls[1]).toEqual([
      new Date(MONDAY_MORNING.getTime() - 7 * 24 * 3_600_000),
      MONDAY_MORNING,
    ]);
  });
});
