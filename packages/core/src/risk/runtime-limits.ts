import { Decimal } from '../decimal';
import { formatAmount } from '../format';

// Risk limits the dashboard can change at runtime (settings row `risk_limits`). The `.env` value
// is the ceiling: an override only counts when it is stricter, so neither the dashboard nor a
// hand-edited row can loosen a limit. Loosening means editing `.env` and restarting the bot.

export const RUNTIME_LIMIT_KEYS = [
  'maxSolPerTradeLamports',
  'maxOpenPositions',
  'dailyLossLimitLamports',
  'minLiquidityUsd',
  'maxSlippageBps',
  'takeProfitPct',
  'stopLossPct',
  'maxHoldMinutes',
  'maxSignalAgeSeconds',
] as const;
export type RuntimeLimitKey = (typeof RUNTIME_LIMIT_KEYS)[number];

export interface RuntimeLimits {
  maxSolPerTradeLamports: bigint;
  maxOpenPositions: number;
  dailyLossLimitLamports: bigint;
  minLiquidityUsd: Decimal;
  maxSlippageBps: number;
  takeProfitPct: Decimal;
  stopLossPct: Decimal;
  maxHoldMinutes: number;
  maxSignalAgeSeconds: number;
}

export type RiskLimitOverrides = Partial<RuntimeLimits>;

/** Stored form: lamports, integers and decimals as strings. */
export type SerializedRiskLimitOverrides = Partial<Record<RuntimeLimitKey, string>>;

export const RUNTIME_LIMIT_LABELS: Record<RuntimeLimitKey, string> = {
  maxSolPerTradeLamports: 'Maks SOL per trade',
  maxOpenPositions: 'Maks posisi terbuka',
  dailyLossLimitLamports: 'Batas rugi harian',
  minLiquidityUsd: 'Likuiditas minimum',
  maxSlippageBps: 'Maks slippage',
  takeProfitPct: 'Take-profit',
  stopLossPct: 'Stop-loss',
  maxHoldMinutes: 'Maks lama hold',
  maxSignalAgeSeconds: 'Maks umur sinyal',
};

type Kind = 'lamports' | 'integer' | 'decimal';

interface KeySpec {
  kind: Kind;
  /** Higher is stricter (only the minimum liquidity); every other limit is stricter when lower. */
  higherIsStricter: boolean;
  valid(value: bigint | number | Decimal): boolean;
}

const positiveLamports = (value: bigint | number | Decimal) =>
  typeof value === 'bigint' && value > 0n;
const integerAtLeast = (min: number, max = Number.MAX_SAFE_INTEGER) => {
  return (value: bigint | number | Decimal) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
};
const decimalAbove = (min: number, max?: number) => {
  return (value: bigint | number | Decimal) =>
    value instanceof Decimal && value.gt(min) && (max === undefined || value.lte(max));
};

// Same minimums as the env schema (packages/config/src/env.ts).
const SPECS: Record<RuntimeLimitKey, KeySpec> = {
  maxSolPerTradeLamports: { kind: 'lamports', higherIsStricter: false, valid: positiveLamports },
  maxOpenPositions: { kind: 'integer', higherIsStricter: false, valid: integerAtLeast(1, 100) },
  dailyLossLimitLamports: { kind: 'lamports', higherIsStricter: false, valid: positiveLamports },
  minLiquidityUsd: {
    kind: 'decimal',
    higherIsStricter: true,
    valid: (value) => value instanceof Decimal && value.gte(0),
  },
  maxSlippageBps: { kind: 'integer', higherIsStricter: false, valid: integerAtLeast(1, 10_000) },
  takeProfitPct: { kind: 'decimal', higherIsStricter: false, valid: decimalAbove(0) },
  stopLossPct: { kind: 'decimal', higherIsStricter: false, valid: decimalAbove(0, 100) },
  maxHoldMinutes: { kind: 'integer', higherIsStricter: false, valid: integerAtLeast(1, 43_200) },
  maxSignalAgeSeconds: { kind: 'integer', higherIsStricter: false, valid: integerAtLeast(1, 3600) },
};

/** -1, 0 or 1, like a comparator, for two values of the same key. */
function compare(a: bigint | number | Decimal, b: bigint | number | Decimal): number {
  if (a instanceof Decimal && b instanceof Decimal) {
    return a.comparedTo(b);
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/** True when `value` is as strict as `ceiling` or stricter, in the key's direction. */
export function isWithinCeiling<K extends RuntimeLimitKey>(
  key: K,
  value: RuntimeLimits[K],
  ceiling: RuntimeLimits[K],
): boolean {
  const order = compare(value, ceiling);
  return SPECS[key].higherIsStricter ? order >= 0 : order <= 0;
}

/** The base limits with each override applied only where it is stricter. */
export function effectiveRiskLimits<T extends RuntimeLimits>(
  base: T,
  overrides: RiskLimitOverrides,
): T {
  const result: T = { ...base };
  for (const key of RUNTIME_LIMIT_KEYS) {
    const override = overrides[key];
    if (override !== undefined && isWithinCeiling(key, override, base[key])) {
      (result as RuntimeLimits)[key] = override as never;
    }
  }
  return result;
}

function parseValue(kind: Kind, text: string): bigint | number | Decimal | null {
  switch (kind) {
    case 'lamports':
      return /^\d+$/.test(text) ? BigInt(text) : null;
    case 'integer':
      return /^\d+$/.test(text) ? Number(text) : null;
    case 'decimal':
      return /^\d+(\.\d+)?$/.test(text) ? new Decimal(text) : null;
  }
}

/** Reads the stored overrides leniently: unknown keys and invalid values are dropped. */
export function parseRiskLimitOverrides(value: unknown): RiskLimitOverrides {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const stored = value as Record<string, unknown>;
  const result: RiskLimitOverrides = {};
  for (const key of RUNTIME_LIMIT_KEYS) {
    const raw = stored[key];
    if (typeof raw !== 'string') {
      continue;
    }
    const spec = SPECS[key];
    const parsed = parseValue(spec.kind, raw.trim());
    if (parsed !== null && spec.valid(parsed)) {
      (result as Record<RuntimeLimitKey, unknown>)[key] = parsed;
    }
  }
  return result;
}

export function serializeRiskLimitOverrides(
  overrides: RiskLimitOverrides,
): SerializedRiskLimitOverrides {
  const result: SerializedRiskLimitOverrides = {};
  for (const key of RUNTIME_LIMIT_KEYS) {
    const value = overrides[key];
    if (value !== undefined) {
      result[key] = value instanceof Decimal ? value.toFixed() : value.toString();
    }
  }
  return result;
}

const LOCALE = 'id-ID';

function plainNumber(text: string): string {
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 6 }).format(
    text as Intl.StringNumericLiteral,
  );
}

/** A stored value with its unit, e.g. "0,05 SOL", "$20.000", "300 bps", "240 menit". */
export function formatRuntimeLimit(key: RuntimeLimitKey, serialized: string): string {
  switch (key) {
    case 'maxSolPerTradeLamports':
    case 'dailyLossLimitLamports':
      return /^\d+$/.test(serialized)
        ? `${formatAmount(BigInt(serialized), 9, 9)} SOL`
        : serialized;
    case 'minLiquidityUsd':
      return `$${plainNumber(serialized)}`;
    case 'maxSlippageBps':
      return `${plainNumber(serialized)} bps`;
    case 'takeProfitPct':
    case 'stopLossPct':
      return `${plainNumber(serialized)}%`;
    case 'maxHoldMinutes':
      return `${plainNumber(serialized)} menit`;
    case 'maxSignalAgeSeconds':
      return `${plainNumber(serialized)} dtk`;
    case 'maxOpenPositions':
      return plainNumber(serialized);
  }
}
