import type { createLoginLimiter } from './login-limiter';

export type LoginAttempt = { ok: true } | { ok: false; error: string };

export interface LoginAttemptDeps {
  limiter: ReturnType<typeof createLoginLimiter>;
  isPassword(password: string): boolean;
  /** Slows down failed attempts. */
  delay(): Promise<void>;
  now(): number;
}

export async function attemptLogin(
  deps: LoginAttemptDeps,
  password: unknown,
): Promise<LoginAttempt> {
  const gate = deps.limiter.check(deps.now());
  if (!gate.allowed) {
    const minutes = Math.max(1, Math.ceil(gate.retryAfterMs / 60_000));
    return {
      ok: false,
      error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${minutes} menit.`,
    };
  }
  if (typeof password !== 'string' || !deps.isPassword(password)) {
    // Record before awaiting: check, compare and record then run without a gap, so parallel
    // requests can't all pass the check while the first ones are still waiting.
    deps.limiter.recordFailure(deps.now());
    await deps.delay();
    return { ok: false, error: 'Password salah.' };
  }
  deps.limiter.reset();
  return { ok: true };
}
