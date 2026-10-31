'use client';

import { useActionState } from 'react';
import { login, type LoginState } from './actions';

const initialState: LoginState = { error: null };

export function LoginForm() {
  const [state, action, pending] = useActionState(login, initialState);
  return (
    <form action={action} className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Password</span>
        <input
          type="password"
          name="password"
          required
          autoFocus
          autoComplete="current-password"
          className="w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
      </label>
      {state.error !== null && (
        <p role="alert" className="text-sm text-negative">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-accent px-4 py-2.5 font-medium text-accent-fg hover:opacity-90 disabled:opacity-60"
      >
        {pending ? 'Memeriksa…' : 'Masuk'}
      </button>
    </form>
  );
}
