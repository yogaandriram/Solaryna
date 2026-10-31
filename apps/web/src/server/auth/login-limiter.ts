export type LoginCheck = { allowed: true } | { allowed: false; retryAfterMs: number };

/**
 * Counts failed logins in a sliding window. It is global rather than per client: the dashboard
 * has a single user, and a client address can't be trusted behind an unknown proxy.
 */
export function createLoginLimiter(options: { maxFailures?: number; windowMs?: number } = {}) {
  const maxFailures = options.maxFailures ?? 10;
  const windowMs = options.windowMs ?? 15 * 60_000;
  let failures: number[] = [];

  function prune(nowMs: number): void {
    failures = failures.filter((at) => at + windowMs > nowMs);
  }

  return {
    check(nowMs: number): LoginCheck {
      prune(nowMs);
      const oldest = failures[failures.length - maxFailures];
      return failures.length < maxFailures || oldest === undefined
        ? { allowed: true }
        : { allowed: false, retryAfterMs: oldest + windowMs - nowMs };
    },
    recordFailure(nowMs: number): void {
      prune(nowMs);
      failures.push(nowMs);
    },
    reset(): void {
      failures = [];
    },
  };
}
