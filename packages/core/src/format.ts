import { formatUnits } from './units';

const LOCALE = 'id-ID';

/**
 * Formats a raw amount for people (id-ID: "1.234,56"). Amounts of at least one whole unit keep
 * up to `maxFractionDigits`; smaller ones keep 4 significant digits so dust stays visible.
 * Intl formats the exact decimal string, so nothing passes through a JS number.
 */
export function formatAmount(raw: bigint, decimals: number, maxFractionDigits: number): string {
  const exact = formatUnits(raw, decimals);
  const magnitude = raw < 0n ? -raw : raw;
  const options: Intl.NumberFormatOptions =
    magnitude >= 10n ** BigInt(decimals)
      ? { maximumFractionDigits: maxFractionDigits }
      : { maximumSignificantDigits: 4 };
  return new Intl.NumberFormat(LOCALE, options).format(exact as Intl.StringNumericLiteral);
}

/** "31 Okt 2026, 10.53.41 WIB" in the given IANA time zone. */
export function formatDateTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}
