import { describe, expect, it } from 'vitest';
import { createLoginLimiter } from './login-limiter';

const T0 = 1_000_000;
const WINDOW = 15 * 60_000;

describe('createLoginLimiter', () => {
  it('allows 10 failures and blocks the next attempt until the window passes', () => {
    const limiter = createLoginLimiter();
    for (let i = 0; i < 10; i++) {
      expect(limiter.check(T0 + i)).toEqual({ allowed: true });
      limiter.recordFailure(T0 + i);
    }
    expect(limiter.check(T0 + 60_000)).toEqual({ allowed: false, retryAfterMs: WINDOW - 60_000 });
    expect(limiter.check(T0 + WINDOW - 1).allowed).toBe(false);
    // The oldest failure leaves the window first.
    expect(limiter.check(T0 + WINDOW)).toEqual({ allowed: true });
  });

  it('honours custom limits', () => {
    const limiter = createLoginLimiter({ maxFailures: 2, windowMs: 1000 });
    limiter.recordFailure(T0);
    expect(limiter.check(T0).allowed).toBe(true);
    limiter.recordFailure(T0 + 10);
    expect(limiter.check(T0 + 10)).toEqual({ allowed: false, retryAfterMs: 990 });
    expect(limiter.check(T0 + 1000)).toEqual({ allowed: true });
  });

  it('reset() clears the failures', () => {
    const limiter = createLoginLimiter({ maxFailures: 1 });
    limiter.recordFailure(T0);
    expect(limiter.check(T0).allowed).toBe(false);
    limiter.reset();
    expect(limiter.check(T0)).toEqual({ allowed: true });
  });
});
