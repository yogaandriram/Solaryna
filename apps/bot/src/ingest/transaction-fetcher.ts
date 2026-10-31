import { rawTransactionSchema, type RawTransaction } from '@solaryna/core';
import type { Logger } from 'pino';

export interface TransactionFetcherOptions {
  getTransaction(signature: string): Promise<unknown>;
  onTransactions(transactions: RawTransaction[]): Promise<unknown>;
  logger: Logger;
  /** A confirmed transaction may not be queryable yet; wait and retry. */
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  /** How many recent signatures to remember, so a tx mentioning two wallets is fetched once. */
  dedupeWindow?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Turns signatures from the WebSocket source into parsed transactions for the ingestor. */
export function createTransactionFetcher(options: TransactionFetcherOptions) {
  const retryDelays = options.retryDelaysMs ?? [500, 1000, 2000, 4000, 8000];
  const sleep = options.sleep ?? defaultSleep;
  const window = options.dedupeWindow ?? 5000;
  const recent = new Set<string>();
  const { logger } = options;

  async function fetchAndIngest(signature: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const json = await options.getTransaction(signature);
      if (json !== null && json !== undefined) {
        const parsed = rawTransactionSchema.safeParse(json);
        if (!parsed.success) {
          logger.warn({ signature }, 'Fetched transaction has an unexpected shape');
          return;
        }
        await options.onTransactions([parsed.data]);
        return;
      }
      const delay = retryDelays[attempt];
      if (delay === undefined) {
        logger.warn({ signature }, 'Transaction not available after retries; skipped');
        return;
      }
      await sleep(delay);
    }
  }

  return function enqueue(signature: string): Promise<void> {
    if (recent.has(signature)) {
      return Promise.resolve();
    }
    recent.add(signature);
    if (recent.size > window) {
      const oldest = recent.values().next().value;
      if (oldest !== undefined) {
        recent.delete(oldest);
      }
    }
    return fetchAndIngest(signature).catch((error: unknown) => {
      // Allow a later notification for the same signature to try again.
      recent.delete(signature);
      logger.error({ err: error, signature }, 'Failed to fetch or ingest transaction');
    });
  };
}
