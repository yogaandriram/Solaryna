import type { TradingMode } from '@solaryna/core';
import type { Page, SignalFilter } from '@solaryna/db';

// Parsing of URL search params. Anything unexpected falls back to the default instead of
// erroring: these values come straight from the address bar.

export type SearchParams = Record<string, string | string[] | undefined>;

export const PAGE_SIZE = 50;
const MAX_PAGE = 10_000;

const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);

export const parseMode = (value: unknown): TradingMode =>
  first(value) === 'live' ? 'live' : 'paper';

export function parsePage(value: unknown): number {
  const page = parseId(value);
  return page !== null && page <= MAX_PAGE ? page : 1;
}

/** A positive safe integer, or null. */
export function parseId(value: unknown): number | null {
  const text = first(value);
  if (typeof text !== 'string' || !/^[1-9]\d{0,15}$/.test(text)) {
    return null;
  }
  const id = Number(text);
  return Number.isSafeInteger(id) ? id : null;
}

export function parseSignalFilter(params: SearchParams): SignalFilter {
  const filter: SignalFilter = {};
  const decision = first(params.decision);
  if (decision === 'accepted' || decision === 'rejected') {
    filter.decision = decision;
  }
  const side = first(params.side);
  if (side === 'buy' || side === 'sell') {
    filter.side = side;
  }
  const walletId = parseId(params.wallet);
  if (walletId !== null) {
    filter.walletId = walletId;
  }
  return filter;
}

/** Fetches one row more than a page so the page can tell whether a next one exists. */
export const pageToOffset = (page: number): Page => ({
  limit: PAGE_SIZE + 1,
  offset: (page - 1) * PAGE_SIZE,
});

export function splitPage<T>(rows: T[]): { items: T[]; hasNext: boolean } {
  return { items: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE };
}

export function withParams(path: string, params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      query.set(key, String(value));
    }
  }
  const text = query.toString();
  return text === '' ? path : `${path}?${text}`;
}
