import { SOL_DECIMALS } from './constants';
import { Decimal } from './decimal';

const DECIMAL_STRING = /^(-)?(\d+)(?:\.(\d+))?$/;

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError(`Invalid token decimals: ${decimals}`);
  }
}

/**
 * Parses a human-readable amount ("0.05") into raw units (lamports, raw token amount).
 * Throws instead of rounding when the value has more fractional digits than `decimals`.
 */
export function parseUnits(value: string, decimals: number): bigint {
  assertDecimals(decimals);
  const match = DECIMAL_STRING.exec(value.trim());
  if (!match) {
    throw new RangeError('Invalid decimal amount');
  }
  const negative = match[1] === '-';
  const whole = match[2] ?? '0';
  const fraction = match[3] ?? '';
  if (fraction.length > decimals) {
    throw new RangeError(`Amount has more than ${decimals} decimal places`);
  }
  const raw = BigInt(whole + fraction.padEnd(decimals, '0'));
  return negative ? -raw : raw;
}

/** Formats raw units as an exact decimal string without trailing zeros. */
export function formatUnits(raw: bigint, decimals: number): string {
  assertDecimals(decimals);
  const negative = raw < 0n;
  const digits = (negative ? -raw : raw).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`;
}

export function toDecimal(raw: bigint, decimals: number): Decimal {
  return new Decimal(formatUnits(raw, decimals));
}

export function lamportsToSol(lamports: bigint): Decimal {
  return toDecimal(lamports, SOL_DECIMALS);
}
