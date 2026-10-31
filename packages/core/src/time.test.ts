import { describe, expect, it } from 'vitest';
import { dueReports, startOfZonedDay, zonedDateKey, zonedDayRange, zonedWeekRange } from './time';

const WIB = 'Asia/Jakarta';

describe('zoned day and week ranges', () => {
  it('finds the UTC instant of a WIB midnight', () => {
    expect(startOfZonedDay('2026-10-31', WIB).toISOString()).toBe('2026-10-30T17:00:00.000Z');
  });

  it('handles zones with daylight saving time', () => {
    // New York switched back to EST on 2026-11-01.
    expect(startOfZonedDay('2026-11-01', 'America/New_York').toISOString()).toBe(
      '2026-11-01T04:00:00.000Z',
    );
    expect(startOfZonedDay('2026-11-02', 'America/New_York').toISOString()).toBe(
      '2026-11-02T05:00:00.000Z',
    );
  });

  it('keys a date by its calendar day in the zone', () => {
    expect(zonedDateKey(new Date('2026-10-30T16:59:59Z'), WIB)).toBe('2026-10-30');
    expect(zonedDateKey(new Date('2026-10-30T17:00:00Z'), WIB)).toBe('2026-10-31');
  });

  it('returns the WIB day containing a date', () => {
    const range = zonedDayRange(new Date('2026-10-30T18:00:00Z'), WIB);
    expect(range.key).toBe('2026-10-31');
    expect(range.from.toISOString()).toBe('2026-10-30T17:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-10-31T17:00:00.000Z');
  });

  it('returns the Monday-to-Monday WIB week containing a date', () => {
    // Sunday 2026-11-01 17:00 WIB belongs to the week starting Monday 2026-10-26.
    const range = zonedWeekRange(new Date('2026-11-01T10:00:00Z'), WIB);
    expect(range.key).toBe('2026-10-26');
    expect(range.from.toISOString()).toBe('2026-10-25T17:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-11-01T17:00:00.000Z');
    // Monday 00:00 WIB starts a new week.
    expect(zonedWeekRange(new Date('2026-11-01T17:00:00Z'), WIB).key).toBe('2026-11-02');
  });
});

describe('dueReports', () => {
  const base = { timeZone: WIB, reportHour: 7 };

  it('reports the previous day and week after 07:00 WIB on Monday', () => {
    const due = dueReports({
      ...base,
      now: new Date('2026-11-02T00:30:00Z'), // Monday 07:30 WIB
      lastDailyKey: '2026-10-31',
      lastWeeklyKey: '2026-10-19',
    });
    expect(due.daily?.key).toBe('2026-11-01');
    expect(due.daily?.from.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(due.daily?.to.toISOString()).toBe('2026-11-01T17:00:00.000Z');
    expect(due.weekly?.key).toBe('2026-10-26');
    expect(due.weekly?.to.toISOString()).toBe('2026-11-01T17:00:00.000Z');
    expect(due.initialize).toBeNull();
  });

  it('waits until the report hour', () => {
    const due = dueReports({
      ...base,
      now: new Date('2026-11-01T23:59:00Z'), // Monday 06:59 WIB
      lastDailyKey: '2026-10-30',
      lastWeeklyKey: '2026-10-19',
    });
    // The newest finished day whose report time has passed is Saturday 2026-10-31.
    expect(due.daily?.key).toBe('2026-10-31');
    expect(due.weekly).toBeNull();
  });

  it('reports nothing when the cursors are current', () => {
    const due = dueReports({
      ...base,
      now: new Date('2026-11-02T00:30:00Z'),
      lastDailyKey: '2026-11-01',
      lastWeeklyKey: '2026-10-26',
    });
    expect(due).toEqual({ daily: null, weekly: null, initialize: null });
  });

  it('only initializes the cursors on the first start', () => {
    const due = dueReports({
      ...base,
      now: new Date('2026-11-02T00:30:00Z'),
      lastDailyKey: null,
      lastWeeklyKey: null,
    });
    expect(due.daily).toBeNull();
    expect(due.weekly).toBeNull();
    expect(due.initialize).toEqual({ dailyKey: '2026-11-01', weeklyKey: '2026-10-26' });
  });

  it('sends only the newest missed period, not every missed day', () => {
    const due = dueReports({
      ...base,
      now: new Date('2026-11-04T03:00:00Z'), // Wednesday 10:00 WIB
      lastDailyKey: '2026-10-28',
      lastWeeklyKey: '2026-10-12',
    });
    expect(due.daily?.key).toBe('2026-11-03');
    expect(due.weekly?.key).toBe('2026-10-26');
  });
});
