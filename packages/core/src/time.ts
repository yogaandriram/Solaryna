// Calendar periods in the display time zone (WIB by default). Instants are stored in UTC; these
// helpers find where a zoned day or week starts and ends. Keys are `YYYY-MM-DD` in that zone.

/** A period `[from, to)`; `key` is the zoned date of its first day. */
export interface PeriodRange {
  key: string;
  from: Date;
  to: Date;
}

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function zonedParts(epochMs: number, timeZone: string) {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(epochMs)) {
    if (part.type !== 'literal') {
      parts[part.type] = Number(part.value);
    }
  }
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** Zone offset from UTC at an instant, in milliseconds (WIB: +7 h). */
function offsetMs(epochMs: number, timeZone: string): number {
  const p = zonedParts(epochMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

function parseKey(dateKey: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (match === null) {
    throw new RangeError(`Invalid date key: ${dateKey}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function addDays(dateKey: string, days: number): string {
  const [year, month, day] = parseKey(dateKey);
  return new Date(Date.UTC(year, month - 1, day) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** The calendar date (`YYYY-MM-DD`) of an instant in a time zone. */
export function zonedDateKey(date: Date, timeZone: string): string {
  const p = zonedParts(date.getTime(), timeZone);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** The instant a zoned calendar day starts (local midnight). */
export function startOfZonedDay(dateKey: string, timeZone: string): Date {
  const [year, month, day] = parseKey(dateKey);
  const guess = Date.UTC(year, month - 1, day);
  // Correct by the offset at the guess, then again at the result in case it crossed a DST change.
  const first = guess - offsetMs(guess, timeZone);
  return new Date(guess - offsetMs(first, timeZone));
}

function dayRange(dateKey: string, timeZone: string): PeriodRange {
  return {
    key: dateKey,
    from: startOfZonedDay(dateKey, timeZone),
    to: startOfZonedDay(addDays(dateKey, 1), timeZone),
  };
}

function weekRange(mondayKey: string, timeZone: string): PeriodRange {
  return {
    key: mondayKey,
    from: startOfZonedDay(mondayKey, timeZone),
    to: startOfZonedDay(addDays(mondayKey, 7), timeZone),
  };
}

function mondayOf(dateKey: string): string {
  const [year, month, day] = parseKey(dateKey);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = Sunday
  return addDays(dateKey, -((weekday + 6) % 7));
}

/** The zoned calendar day containing `date`. */
export function zonedDayRange(date: Date, timeZone: string): PeriodRange {
  return dayRange(zonedDateKey(date, timeZone), timeZone);
}

/** The zoned Monday-to-Monday week containing `date`. */
export function zonedWeekRange(date: Date, timeZone: string): PeriodRange {
  return weekRange(mondayOf(zonedDateKey(date, timeZone)), timeZone);
}

export interface DueReportsInput {
  now: Date;
  timeZone: string;
  /** Local hour when the report for the previous day/week is sent. */
  reportHour: number;
  lastDailyKey: string | null;
  lastWeeklyKey: string | null;
}

export interface DueReports {
  daily: PeriodRange | null;
  weekly: PeriodRange | null;
  /** Set when a cursor was missing: store these keys without sending anything. */
  initialize: { dailyKey: string; weeklyKey: string } | null;
}

/**
 * Which reports are due. Only the newest finished period whose report time has passed is
 * reported; older missed periods are skipped. A missing cursor (first start) is initialized to
 * that period instead of sending a report for it.
 */
export function dueReports(input: DueReportsInput): DueReports {
  const { now, timeZone } = input;
  const reportTime = (dateKey: string) =>
    startOfZonedDay(dateKey, timeZone).getTime() + input.reportHour * MS_PER_HOUR;

  const today = zonedDateKey(now, timeZone);
  const latestDaily = addDays(today, now.getTime() >= reportTime(today) ? -1 : -2);
  const thisMonday = mondayOf(today);
  const latestWeekly = addDays(thisMonday, now.getTime() >= reportTime(thisMonday) ? -7 : -14);

  const initialize =
    input.lastDailyKey === null || input.lastWeeklyKey === null
      ? {
          dailyKey: input.lastDailyKey ?? latestDaily,
          weeklyKey: input.lastWeeklyKey ?? latestWeekly,
        }
      : null;
  const isDue = (last: string | null, latest: string) => last !== null && last < latest;

  return {
    daily: isDue(input.lastDailyKey, latestDaily) ? dayRange(latestDaily, timeZone) : null,
    weekly: isDue(input.lastWeeklyKey, latestWeekly) ? weekRange(latestWeekly, timeZone) : null,
    initialize,
  };
}
