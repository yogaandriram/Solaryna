import {
  Decimal,
  RUNTIME_LIMIT_LABELS,
  SOL_DECIMALS,
  effectiveRiskLimits,
  formatRuntimeLimit,
  formatUnits,
  isWithinCeiling,
  parseRiskLimitOverrides,
  parseUnits,
  type RuntimeLimitKey,
  type RuntimeLimits,
  type SerializedRiskLimitOverrides,
} from '@solaryna/core';

// The runtime risk limit form on Pengaturan. An empty field means "follow .env"; a filled one
// must be at least as strict as the .env value (the ceiling) and pass the env schema's minimums.

export type LimitUnit = 'SOL' | 'USD' | 'bps' | '%' | 'menit' | 'detik' | '';

export interface LimitField {
  key: RuntimeLimitKey;
  label: string;
  unit: LimitUnit;
}

const field = (key: RuntimeLimitKey, unit: LimitUnit): LimitField => ({
  key,
  label: RUNTIME_LIMIT_LABELS[key],
  unit,
});

export const LIMIT_FIELDS: readonly LimitField[] = [
  field('maxSolPerTradeLamports', 'SOL'),
  field('maxOpenPositions', ''),
  field('dailyLossLimitLamports', 'SOL'),
  field('minLiquidityUsd', 'USD'),
  field('maxSlippageBps', 'bps'),
  field('takeProfitPct', '%'),
  field('stopLossPct', '%'),
  field('maxHoldMinutes', 'menit'),
  field('maxSignalAgeSeconds', 'detik'),
];

export type LimitErrors = Partial<Record<RuntimeLimitKey, string>>;

export type ParsedLimitsForm =
  { ok: true; overrides: SerializedRiskLimitOverrides } | { ok: false; errors: LimitErrors };

const NUMBER = /^-?\d+(\.\d+)?$/;

type Parsed = { ok: true; value: RuntimeLimits[RuntimeLimitKey] } | { ok: false; error: string };

const fail = (error: string): Parsed => ({ ok: false, error });

function parseField(key: RuntimeLimitKey, text: string): Parsed {
  if (!NUMBER.test(text)) {
    return fail('Harus angka.');
  }
  const number = new Decimal(text);
  if (key !== 'minLiquidityUsd' && number.lte(0)) {
    return fail('Harus lebih dari 0.');
  }
  switch (key) {
    case 'maxSolPerTradeLamports':
    case 'dailyLossLimitLamports':
      return number.decimalPlaces() > SOL_DECIMALS
        ? fail('Maksimal 9 angka di belakang koma.')
        : { ok: true, value: parseUnits(text, SOL_DECIMALS) };
    case 'maxOpenPositions':
    case 'maxSlippageBps':
    case 'maxHoldMinutes':
    case 'maxSignalAgeSeconds':
      return number.isInteger()
        ? { ok: true, value: number.toNumber() }
        : fail('Harus bilangan bulat.');
    case 'stopLossPct':
      return number.gt(100) ? fail('Harus di antara 0 dan 100.') : { ok: true, value: number };
    case 'minLiquidityUsd':
    case 'takeProfitPct':
      return { ok: true, value: number };
  }
}

function serialize(value: RuntimeLimits[RuntimeLimitKey]): string {
  return value instanceof Decimal ? value.toFixed() : value.toString();
}

export function parseLimitsForm(formData: FormData, ceilings: RuntimeLimits): ParsedLimitsForm {
  const overrides: SerializedRiskLimitOverrides = {};
  const errors: LimitErrors = {};
  for (const { key } of LIMIT_FIELDS) {
    const raw = formData.get(key);
    const text = (typeof raw === 'string' ? raw : '').trim().replace(',', '.');
    if (text === '') {
      continue;
    }
    const parsed = parseField(key, text);
    if (!parsed.ok) {
      errors[key] = parsed.error;
      continue;
    }
    const ceiling = ceilings[key];
    if (!isWithinCeiling(key, parsed.value, ceiling)) {
      const limit = formatRuntimeLimit(key, serialize(ceiling));
      errors[key] =
        key === 'minLiquidityUsd'
          ? `Tidak boleh di bawah batas .env (${limit}).`
          : `Tidak boleh melebihi batas .env (${limit}).`;
      continue;
    }
    if (serialize(parsed.value) !== serialize(ceiling)) {
      overrides[key] = serialize(parsed.value);
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, overrides };
}

export interface LimitRow extends LimitField {
  /** The .env value (the ceiling), formatted. */
  envText: string;
  /** The value the bot uses now, formatted. */
  activeText: string;
  /** True when a stricter override is in effect. */
  overridden: boolean;
  /** The override in effect as the input shows it; '' follows .env. */
  inputValue: string;
}

/**
 * One row per limit from the .env ceilings and the raw `risk_limits` settings value. Overrides
 * the bot would ignore (looser than .env, malformed) are left out, as the bot leaves them out.
 */
export function limitRows(ceilings: RuntimeLimits, stored: unknown): LimitRow[] {
  const effective = effectiveRiskLimits(ceilings, parseRiskLimitOverrides(stored));
  return LIMIT_FIELDS.map((field) => {
    const envValue = serialize(ceilings[field.key]);
    const activeValue = serialize(effective[field.key]);
    const overridden = activeValue !== envValue;
    return {
      ...field,
      envText: formatRuntimeLimit(field.key, envValue),
      activeText: formatRuntimeLimit(field.key, activeValue),
      overridden,
      inputValue: overridden ? limitInputValue(field.key, activeValue) : '',
    };
  });
}

/** A stored override as the form input shows it (SOL instead of lamports); '' when unset. */
export function limitInputValue(key: RuntimeLimitKey, stored: string | undefined): string {
  if (stored === undefined) {
    return '';
  }
  return (key === 'maxSolPerTradeLamports' || key === 'dailyLossLimitLamports') &&
    /^\d+$/.test(stored)
    ? formatUnits(BigInt(stored), SOL_DECIMALS)
    : stored;
}
