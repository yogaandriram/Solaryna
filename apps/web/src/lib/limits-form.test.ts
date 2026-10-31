import { Decimal, type RuntimeLimits } from '@solaryna/core';
import { describe, expect, it } from 'vitest';
import { LIMIT_FIELDS, limitInputValue, limitRows, parseLimitsForm } from './limits-form';

const CEILINGS: RuntimeLimits = {
  maxSolPerTradeLamports: 50_000_000n,
  maxOpenPositions: 5,
  dailyLossLimitLamports: 200_000_000n,
  minLiquidityUsd: new Decimal(20_000),
  maxSlippageBps: 300,
  takeProfitPct: new Decimal(100),
  stopLossPct: new Decimal(30),
  maxHoldMinutes: 240,
  maxSignalAgeSeconds: 30,
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const field of LIMIT_FIELDS) {
    data.set(field.key, '');
  }
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

describe('LIMIT_FIELDS', () => {
  it('lists every runtime limit once with its unit', () => {
    expect(LIMIT_FIELDS.map((field) => field.key)).toEqual([
      'maxSolPerTradeLamports',
      'maxOpenPositions',
      'dailyLossLimitLamports',
      'minLiquidityUsd',
      'maxSlippageBps',
      'takeProfitPct',
      'stopLossPct',
      'maxHoldMinutes',
      'maxSignalAgeSeconds',
    ]);
    expect(LIMIT_FIELDS[0]).toEqual({
      key: 'maxSolPerTradeLamports',
      label: 'Maks SOL per trade',
      unit: 'SOL',
    });
    expect(LIMIT_FIELDS.find((field) => field.key === 'maxSignalAgeSeconds')?.unit).toBe('detik');
  });
});

describe('parseLimitsForm', () => {
  it('gives no overrides for an all-empty form', () => {
    expect(parseLimitsForm(form({}), CEILINGS)).toEqual({ ok: true, overrides: {} });
  });

  it('parses SOL into lamports within the .env ceiling', () => {
    expect(parseLimitsForm(form({ maxSolPerTradeLamports: '0.03' }), CEILINGS)).toEqual({
      ok: true,
      overrides: { maxSolPerTradeLamports: '30000000' },
    });
    expect(parseLimitsForm(form({ maxSolPerTradeLamports: '0,03' }), CEILINGS)).toEqual({
      ok: true,
      overrides: { maxSolPerTradeLamports: '30000000' },
    });
  });

  it('rejects a value looser than the .env ceiling', () => {
    expect(parseLimitsForm(form({ maxSolPerTradeLamports: '0.1' }), CEILINGS)).toEqual({
      ok: false,
      errors: { maxSolPerTradeLamports: 'Tidak boleh melebihi batas .env (0,05 SOL).' },
    });
    expect(parseLimitsForm(form({ minLiquidityUsd: '10000' }), CEILINGS)).toEqual({
      ok: false,
      errors: { minLiquidityUsd: 'Tidak boleh di bawah batas .env ($20.000).' },
    });
  });

  it('leaves out a value equal to the ceiling', () => {
    expect(
      parseLimitsForm(form({ maxSolPerTradeLamports: '0.05', maxOpenPositions: '5' }), CEILINGS),
    ).toEqual({ ok: true, overrides: {} });
  });

  it('accepts stricter values for every kind', () => {
    expect(
      parseLimitsForm(
        form({
          maxOpenPositions: '3',
          minLiquidityUsd: '25000',
          takeProfitPct: '50.50',
          maxSignalAgeSeconds: ' 10 ',
        }),
        CEILINGS,
      ),
    ).toEqual({
      ok: true,
      overrides: {
        maxOpenPositions: '3',
        minLiquidityUsd: '25000',
        takeProfitPct: '50.5',
        maxSignalAgeSeconds: '10',
      },
    });
  });

  it('rejects numbers written with thousands separators instead of misreading them', () => {
    const error = 'Tulis tanpa pemisah ribuan, mis. 20000 atau 0,5.';
    expect(
      parseLimitsForm(
        form({
          maxHoldMinutes: '1.000',
          minLiquidityUsd: '25.000',
          takeProfitPct: '1.000',
          maxSlippageBps: '1,000',
        }),
        {
          ...CEILINGS,
          maxHoldMinutes: 1440,
          maxSlippageBps: 2000,
          takeProfitPct: new Decimal(2000),
        },
      ),
    ).toEqual({
      ok: false,
      errors: {
        maxHoldMinutes: error,
        minLiquidityUsd: error,
        takeProfitPct: error,
        maxSlippageBps: error,
      },
    });
  });

  it('still reads decimals with three digits after a leading zero', () => {
    expect(parseLimitsForm(form({ dailyLossLimitLamports: '0.100' }), CEILINGS)).toEqual({
      ok: true,
      overrides: { dailyLossLimitLamports: '100000000' },
    });
  });

  it('keeps the stop-loss between 0 and 100', () => {
    expect(parseLimitsForm(form({ stopLossPct: '150' }), CEILINGS)).toEqual({
      ok: false,
      errors: { stopLossPct: 'Harus di antara 0 dan 100.' },
    });
  });

  it('reports malformed numbers per field', () => {
    const result = parseLimitsForm(
      form({
        maxSolPerTradeLamports: 'abc',
        maxOpenPositions: '2.5',
        dailyLossLimitLamports: '0.0000000001',
        maxHoldMinutes: '0',
        maxSlippageBps: '-5',
      }),
      CEILINGS,
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        maxSolPerTradeLamports: 'Harus angka.',
        maxOpenPositions: 'Harus bilangan bulat.',
        dailyLossLimitLamports: 'Maksimal 9 angka di belakang koma.',
        maxHoldMinutes: 'Harus lebih dari 0.',
        maxSlippageBps: 'Harus lebih dari 0.',
      },
    });
  });
});

describe('limitRows', () => {
  it('shows the .env value, the value in effect, and stricter overrides only', () => {
    const rows = limitRows(CEILINGS, {
      maxSolPerTradeLamports: '30000000',
      maxOpenPositions: '9',
      junk: 'x',
    });
    expect(rows).toHaveLength(LIMIT_FIELDS.length);
    expect(rows[0]).toEqual({
      key: 'maxSolPerTradeLamports',
      label: 'Maks SOL per trade',
      unit: 'SOL',
      envText: '0,05 SOL',
      activeText: '0,03 SOL',
      overridden: true,
      inputValue: '0.03',
    });
    expect(rows[1]).toMatchObject({
      key: 'maxOpenPositions',
      envText: '5',
      activeText: '5',
      overridden: false,
      inputValue: '',
    });
  });

  it('treats a missing or malformed settings row as no overrides', () => {
    expect(limitRows(CEILINGS, null).every((row) => !row.overridden)).toBe(true);
    expect(limitRows(CEILINGS, 'bad').every((row) => row.inputValue === '')).toBe(true);
  });
});

describe('limitInputValue', () => {
  it('shows a stored override the way the form accepts it', () => {
    expect(limitInputValue('maxSolPerTradeLamports', '30000000')).toBe('0.03');
    expect(limitInputValue('takeProfitPct', '50.5')).toBe('50.5');
    expect(limitInputValue('maxOpenPositions', undefined)).toBe('');
  });
});
