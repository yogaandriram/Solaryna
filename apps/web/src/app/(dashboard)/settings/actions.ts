'use server';

import { DASHBOARD_ACTOR, setRiskLimitOverrides } from '@solaryna/db';
import { revalidatePath } from 'next/cache';
import { LIMIT_FIELDS, parseLimitsForm, type LimitErrors } from '../../../lib/limits-form';
import { requireSession } from '../../../server/auth/session';
import { getWebConfig } from '../../../server/config';
import { getDb } from '../../../server/db';

// Runtime risk limits. Saving writes `limits.update` to audit_log; the bot reloads the limits
// within 15 s and announces the change in Telegram.

export interface LimitsFormState {
  message: string | null;
  errors: LimitErrors;
  /** The submitted inputs, echoed back on error so the reset form keeps them. */
  values: Record<string, string> | null;
}

const SAVED = 'Tersimpan. Bot memakai batas baru dalam ±15 detik.';
const RESET = 'Semua batas kembali ikut .env. Bot memakainya dalam ±15 detik.';
const UNCHANGED = 'Tidak ada perubahan.';

function submittedValues(formData: FormData): Record<string, string> {
  return Object.fromEntries(
    LIMIT_FIELDS.map(({ key }) => {
      const value = formData.get(key);
      return [key, typeof value === 'string' ? value : ''];
    }),
  );
}

async function store(
  overrides: Record<string, string>,
  changedMessage: string,
): Promise<LimitsFormState> {
  const { changes } = await setRiskLimitOverrides(getDb(), overrides, { actor: DASHBOARD_ACTOR });
  revalidatePath('/', 'layout');
  return {
    message: Object.keys(changes).length === 0 ? UNCHANGED : changedMessage,
    errors: {},
    values: null,
  };
}

export async function saveLimitsAction(
  _previous: LimitsFormState,
  formData: FormData,
): Promise<LimitsFormState> {
  await requireSession();
  const parsed = parseLimitsForm(formData, getWebConfig().risk);
  if (!parsed.ok) {
    return { message: null, errors: parsed.errors, values: submittedValues(formData) };
  }
  return store(parsed.overrides, SAVED);
}

/** Drops every override, so each limit follows `.env` again. */
export async function resetLimitsAction(): Promise<LimitsFormState> {
  await requireSession();
  return store({}, RESET);
}
