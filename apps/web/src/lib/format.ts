import {
  Decimal,
  SOL_DECIMALS,
  USDC_MINT,
  WSOL_MINT,
  formatAmount,
  shortAddress,
} from '@solaryna/core';

// Display formatting for the dashboard (id-ID). Amounts stay bigint/Decimal until Intl formats
// their exact decimal string; nothing passes through a JS number.

const LOCALE = 'id-ID';
const MINUS = '−';

export type PnlTone = 'pos' | 'neg' | 'zero';

const abs = (value: bigint) => (value < 0n ? -value : value);

export const formatSol = (lamports: bigint): string =>
  `${formatAmount(lamports, SOL_DECIMALS, 4)} SOL`;

/** "+0,01 SOL", "−0,02 SOL" (U+2212) or "0 SOL". */
export function formatSignedSol(lamports: bigint): string {
  const sign = lamports > 0n ? '+' : lamports < 0n ? MINUS : '';
  return `${sign}${formatSol(abs(lamports))}`;
}

export const pnlTone = (lamports: bigint): PnlTone =>
  lamports > 0n ? 'pos' : lamports < 0n ? 'neg' : 'zero';

/** PnL as a percent of cost; null when there is no positive cost to compare with. */
export function pnlPct(pnlLamports: bigint, costLamports: bigint): Decimal | null {
  return costLamports <= 0n
    ? null
    : new Decimal(pnlLamports.toString()).div(costLamports.toString()).times(100);
}

function formatDecimal(value: Decimal, options: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(LOCALE, options).format(
    value.toFixed() as Intl.StringNumericLiteral,
  );
}

/** "12,3%", "+12,3%" when signed, "−5%"; "—" when there is no value. */
export function formatPct(value: Decimal | null, signed = false): string {
  if (value === null) {
    return '—';
  }
  const rounded = value.toDecimalPlaces(1);
  if (rounded.isZero()) {
    return '0%';
  }
  const sign = rounded.isNegative() ? MINUS : signed ? '+' : '';
  return `${sign}${formatDecimal(rounded.abs(), { maximumFractionDigits: 1 })}%`;
}

/** "$20.000" for large values, "$12,50" for small ones, "—" when unknown. */
export function formatUsd(value: string | Decimal | null): string {
  if (value === null) {
    return '—';
  }
  const amount = new Decimal(value);
  const options: Intl.NumberFormatOptions = amount.abs().gte(1000)
    ? { maximumFractionDigits: 0 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return `$${formatDecimal(amount, options)}`;
}

/** SOL per whole token with 4 significant digits ("0,00001235 SOL"); "—" when unknown. */
export function formatPriceSol(value: string | null): string {
  return value === null
    ? '—'
    : `${formatDecimal(new Decimal(value), { maximumSignificantDigits: 4 })} SOL`;
}

export const formatTokenAmount = (raw: bigint, decimals: number): string =>
  formatAmount(raw, decimals, 2);

/** "0,5 SOL", "12,5 USDC", or the amount with the short mint for other quotes. */
export function formatQuoteAmount(raw: bigint, decimals: number, mint: string): string {
  if (mint === WSOL_MINT) {
    return `${formatAmount(raw, decimals, 4)} SOL`;
  }
  if (mint === USDC_MINT) {
    return `${formatAmount(raw, decimals, 2)} USDC`;
  }
  return `${formatAmount(raw, decimals, 4)} ${shortAddress(mint)}`;
}

/** "31 Okt 2026, 10.53 WIB" in the display time zone. */
export function formatDateTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

/** "10.53.41 WIB" in the display time zone. */
export function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

/** "Sab, 31 Okt" for a zoned date key `YYYY-MM-DD`. */
export function formatDayKey(key: string): string {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(Date.UTC(year, month - 1, day));
}

/** "45 dtk", "12 m", "3 j 5 m", "2 h 4 j" (rounded down). */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) {
    return `${seconds} dtk`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} j ${minutes % 60} m`;
  }
  return `${Math.floor(hours / 24)} h ${hours % 24} j`;
}

export const tokenLabel = (symbol: string | null, mint: string): string =>
  symbol ?? shortAddress(mint);

export const walletName = (label: string | null, address: string): string =>
  label ?? shortAddress(address);
