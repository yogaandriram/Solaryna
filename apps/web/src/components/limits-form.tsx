'use client';

import { useActionState } from 'react';
import {
  resetLimitsAction,
  saveLimitsAction,
  type LimitsFormState,
} from '../app/(dashboard)/settings/actions';
import type { LimitRow } from '../lib/limits-form';

const initialState: LimitsFormState = { message: null, errors: {}, values: null };

async function submit(previous: LimitsFormState, formData: FormData): Promise<LimitsFormState> {
  return formData.get('intent') === 'reset'
    ? resetLimitsAction()
    : saveLimitsAction(previous, formData);
}

export function LimitsForm({ rows }: { rows: readonly LimitRow[] }) {
  const [state, action, pending] = useActionState(submit, initialState);
  return (
    <form action={action} className="space-y-4">
      <div className="divide-y divide-line">
        <div className="hidden gap-4 pb-2 text-xs text-muted md:grid md:grid-cols-[1.4fr_1fr_1fr_1.3fr]">
          <span>Batas</span>
          <span>Nilai .env</span>
          <span>Dipakai bot</span>
          <span>Ubah (kosong = ikut .env)</span>
        </div>
        {rows.map((row) => {
          const error = state.errors[row.key];
          const inputId = `limit-${row.key}`;
          return (
            <div
              key={row.key}
              className="grid gap-x-4 gap-y-1.5 py-3 md:grid-cols-[1.4fr_1fr_1fr_1.3fr] md:items-center"
            >
              <label htmlFor={inputId} className="text-sm font-medium">
                {row.label}
              </label>
              <p className="text-sm text-muted tabular-nums">
                <span className="md:hidden">.env: </span>
                {row.envText}
              </p>
              <p className="text-sm tabular-nums">
                <span className="text-muted md:hidden">Dipakai bot: </span>
                {row.activeText}
                {row.overridden && (
                  <span className="ml-2 rounded-md bg-accent/10 px-1.5 py-0.5 text-xs font-medium text-accent">
                    lebih ketat
                  </span>
                )}
              </p>
              <div>
                <div className="flex items-center gap-2">
                  <input
                    id={inputId}
                    name={row.key}
                    defaultValue={state.values?.[row.key] ?? row.inputValue}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="ikut .env"
                    aria-invalid={error !== undefined}
                    aria-describedby={error === undefined ? undefined : `${inputId}-error`}
                    className={`w-full min-w-0 rounded-lg border bg-canvas px-3 py-1.5 text-sm tabular-nums outline-none focus:ring-2 focus:ring-accent/30 ${
                      error === undefined
                        ? 'border-line focus:border-accent'
                        : 'border-negative focus:border-negative'
                    }`}
                  />
                  <span className="w-12 shrink-0 text-xs text-muted">{row.unit}</span>
                </div>
                {error !== undefined && (
                  <p id={`${inputId}-error`} className="mt-1 text-xs text-negative">
                    {error}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          name="intent"
          value="save"
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Menyimpan…' : 'Simpan batas'}
        </button>
        <button
          type="submit"
          name="intent"
          value="reset"
          disabled={pending}
          className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-muted hover:text-fg disabled:opacity-60"
        >
          Kembalikan semua ke .env
        </button>
        {state.message !== null && (
          <p role="status" className="text-sm text-positive">
            {state.message}
          </p>
        )}
        {Object.keys(state.errors).length > 0 && (
          <p role="alert" className="text-sm text-negative">
            Belum tersimpan. Perbaiki isian yang ditandai.
          </p>
        )}
      </div>
    </form>
  );
}
