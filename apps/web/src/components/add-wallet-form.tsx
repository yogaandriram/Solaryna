'use client';

import { useActionState } from 'react';
import { addWalletAction, type AddWalletState } from '../app/(dashboard)/wallets/actions';

const initialState: AddWalletState = {
  message: null,
  error: null,
  values: { address: '', label: '' },
};

const INPUT =
  'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';

export function AddWalletForm() {
  const [state, action, pending] = useActionState(addWalletAction, initialState);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 md:grid-cols-[2fr_1fr_auto] md:items-end">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Alamat wallet</span>
          <input
            name="address"
            defaultValue={state.values.address}
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="Alamat Solana (base58)"
            className={`${INPUT} font-mono`}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">
            Label <span className="font-normal text-muted">(opsional)</span>
          </span>
          <input
            name="label"
            defaultValue={state.values.label}
            maxLength={100}
            autoComplete="off"
            className={INPUT}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Menyimpan…' : 'Tambah wallet'}
        </button>
      </div>
      {state.error !== null && (
        <p role="alert" className="text-sm text-negative">
          {state.error}
        </p>
      )}
      {state.message !== null && (
        <p role="status" className="text-sm text-positive">
          {state.message}
        </p>
      )}
    </form>
  );
}
