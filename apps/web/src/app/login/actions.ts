'use server';

import { redirect } from 'next/navigation';
import { createLoginLimiter } from '../../server/auth/login-limiter';
import { createSession, deleteSession, isDashboardPassword } from '../../server/auth/session';

export interface LoginState {
  error: string | null;
}

const FAILURE_DELAY_MS = 500;
const limiter = createLoginLimiter();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const gate = limiter.check(Date.now());
  if (!gate.allowed) {
    const minutes = Math.max(1, Math.ceil(gate.retryAfterMs / 60_000));
    return { error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${minutes} menit.` };
  }
  const password = formData.get('password');
  if (typeof password !== 'string' || !isDashboardPassword(password)) {
    await sleep(FAILURE_DELAY_MS);
    limiter.recordFailure(Date.now());
    return { error: 'Password salah.' };
  }
  limiter.reset();
  await createSession();
  redirect('/');
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect('/login');
}
