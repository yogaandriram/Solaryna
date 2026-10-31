import { describe, expect, it } from 'vitest';
import { attemptLogin, type LoginAttemptDeps } from './login-attempt';
import { createLoginLimiter } from './login-limiter';

const PASSWORD = 'correct-horse-battery';

function deps(delay: () => Promise<void> = () => Promise.resolve()): LoginAttemptDeps {
  return {
    limiter: createLoginLimiter({ maxFailures: 10, windowMs: 15 * 60_000 }),
    isPassword: (password) => password === PASSWORD,
    delay,
    now: () => 1_000_000,
  };
}

describe('attemptLogin', () => {
  it('accepts the right password', async () => {
    expect(await attemptLogin(deps(), PASSWORD)).toEqual({ ok: true });
  });

  it('rejects a wrong or missing password', async () => {
    expect(await attemptLogin(deps(), 'nope')).toEqual({ ok: false, error: 'Password salah.' });
    expect(await attemptLogin(deps(), null)).toEqual({ ok: false, error: 'Password salah.' });
  });

  it('locks after 10 failures even when the attempts arrive in parallel', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const shared = deps(() => gate);
    const attempts = Array.from({ length: 25 }, () => attemptLogin(shared, 'nope'));
    release();
    const results = await Promise.all(attempts);
    const checked = results.filter((result) => !result.ok && result.error === 'Password salah.');
    expect(checked).toHaveLength(10);
    expect(await attemptLogin(shared, PASSWORD)).toEqual({
      ok: false,
      error: 'Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit.',
    });
  });
});
