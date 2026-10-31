import type { Logger } from 'pino';
import type { WalletRegistry } from '../wallets/registry';

/** Where the tracked addresses must be registered for events to arrive. */
export interface SubscriptionTarget {
  name: string;
  apply(addresses: string[]): Promise<void>;
}

export interface WalletSyncOptions {
  registry: Pick<WalletRegistry, 'refresh' | 'addresses'>;
  target: SubscriptionTarget;
  logger: Logger;
  intervalMs?: number;
}

/**
 * Keeps the subscription target in line with active wallets in the database, whether they
 * changed via Telegram, the import script, or (later) the dashboard. Runs are serialized.
 */
export function createWalletSync(options: WalletSyncOptions) {
  const { registry, target, logger } = options;
  let applied: string | null = null;
  let chain: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;

  async function run(): Promise<void> {
    await registry.refresh();
    const addresses = registry.addresses();
    const key = addresses.join(',');
    if (key === applied) {
      return;
    }
    await target.apply(addresses);
    applied = key;
    logger.info({ target: target.name, wallets: addresses.length }, 'Tracked wallets synced');
  }

  /** Runs a sync after any in-flight one; rejects if this run fails. */
  function syncNow(): Promise<void> {
    const next = chain.then(run);
    chain = next.catch(() => undefined);
    return next;
  }

  return {
    syncNow,
    start(): void {
      timer = setInterval(() => {
        syncNow().catch((error: unknown) => {
          logger.error({ err: error, target: target.name }, 'Wallet sync failed; will retry');
        });
      }, options.intervalMs ?? 60_000);
    },
    stop(): void {
      clearInterval(timer);
    },
  };
}

export type WalletSync = ReturnType<typeof createWalletSync>;
