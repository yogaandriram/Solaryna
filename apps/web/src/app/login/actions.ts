'use server';

import { redirect } from 'next/navigation';
import { attemptLogin } from '../../server/auth/login-attempt';
import { createLoginLimiter } from '../../server/auth/login-limiter';
import { createSession, isDashboardPassword } from '../../server/auth/session';

export interface LoginState {
  error: string | null;
}

const FAILURE_DELAY_MS = 500;
const limiter = createLoginLimiter();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const result = await attemptLogin(
    {
      limiter,
      isPassword: isDashboardPassword,
      delay: () => sleep(FAILURE_DELAY_MS),
      now: () => Date.now(),
    },
    formData.get('password'),
  );
  if (!result.ok) {
    return { error: result.error };
  }
  await createSession();
  redirect('/');
}
