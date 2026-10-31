// One queue for every Jupiter request: the free tier allows 60 requests per 60 s, shared by the
// Swap, Price and Tokens APIs. Exits go first so take-profit/stop-loss are never starved by buys.

/** `exit`: quotes for sells that must happen; `buy`: buy signals; `monitor`: routine checks. */
export type RequestPriority = 'exit' | 'buy' | 'monitor';

const RANK: Record<RequestPriority, number> = { exit: 0, buy: 1, monitor: 2 };

/** The request was still queued at its `expiresAt`; it was dropped without being sent. */
export class RequestExpiredError extends Error {
  constructor() {
    super('Request expired while waiting for the rate limiter');
    this.name = 'RequestExpiredError';
  }
}

export interface ScheduleOptions {
  /** Epoch ms; if the request has not started by then it is rejected with RequestExpiredError. */
  expiresAt?: number;
}

export interface RateLimiter {
  schedule<T>(
    priority: RequestPriority,
    task: () => Promise<T>,
    options?: ScheduleOptions,
  ): Promise<T>;
  /** Holds every request until this time (epoch ms), e.g. after a 429. */
  pauseUntil(epochMs: number): void;
  readonly pending: number;
}

export interface RateLimiterOptions {
  /** Minimum time between request starts. */
  minIntervalMs?: number;
  /** Monitoring requests that waited this long are served like exits. */
  promoteAfterMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface Entry {
  priority: RequestPriority;
  enqueuedAt: number;
  seq: number;
  expiresAt: number;
  run: () => void;
  expire: () => void;
}

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const minIntervalMs = options.minIntervalMs ?? 1000;
  const promoteAfterMs = options.promoteAfterMs ?? 30_000;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const queue: Entry[] = [];
  let seq = 0;
  let lastStart = Number.NEGATIVE_INFINITY;
  let pausedUntil = 0;
  let pumping = false;

  const rank = (entry: Entry, at: number) =>
    entry.priority === 'monitor' && at - entry.enqueuedAt >= promoteAfterMs
      ? RANK.exit
      : RANK[entry.priority];

  function takeNext(): Entry | undefined {
    const at = now();
    let bestIndex = -1;
    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i];
      const best = queue[bestIndex];
      if (
        entry !== undefined &&
        (best === undefined ||
          rank(entry, at) < rank(best, at) ||
          (rank(entry, at) === rank(best, at) && entry.seq < best.seq))
      ) {
        bestIndex = i;
      }
    }
    return bestIndex < 0 ? undefined : queue.splice(bestIndex, 1)[0];
  }

  function dropExpired(): void {
    const at = now();
    for (let i = queue.length - 1; i >= 0; i--) {
      const entry = queue[i];
      if (entry !== undefined && entry.expiresAt < at) {
        queue.splice(i, 1);
        entry.expire();
      }
    }
  }

  async function pump(): Promise<void> {
    if (pumping) {
      return;
    }
    pumping = true;
    try {
      // Let requests scheduled in the same tick queue up before choosing the first one.
      await Promise.resolve();
      while (queue.length > 0) {
        dropExpired();
        if (queue.length === 0) {
          break;
        }
        const wait = Math.max(lastStart + minIntervalMs, pausedUntil) - now();
        if (wait > 0) {
          await sleep(wait);
          continue;
        }
        const entry = takeNext();
        if (entry === undefined) {
          break;
        }
        lastStart = now();
        entry.run();
      }
    } finally {
      pumping = false;
    }
  }

  return {
    schedule<T>(
      priority: RequestPriority,
      task: () => Promise<T>,
      options: ScheduleOptions = {},
    ): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push({
          priority,
          enqueuedAt: now(),
          seq: seq++,
          expiresAt: options.expiresAt ?? Number.POSITIVE_INFINITY,
          expire: () => {
            reject(new RequestExpiredError());
          },
          // Starts the task without waiting for it: the limit is on request starts.
          run: () => {
            try {
              task().then(resolve, reject);
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          },
        });
        void pump();
      });
    },
    pauseUntil(epochMs: number) {
      pausedUntil = Math.max(pausedUntil, epochMs);
    },
    get pending() {
      return queue.length;
    },
  };
}
