import type { SwapEvent } from '@solaryna/core';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { TrackedWalletInfo } from '../wallets/registry';
import { createIngestor } from './ingestor';
import { loadFixture } from './test-fixtures';

const logger = pino({ level: 'silent' });

function setup(trackedAddresses: string[]) {
  const wallets = new Map<string, TrackedWalletInfo>(
    trackedAddresses.map((address, i) => [address, { id: i + 1, address, label: null }]),
  );
  const stored = new Set<string>();
  const saveSwapEvent = vi.fn((event: SwapEvent, _raw: unknown) => {
    const key = `${event.signature}:${event.wallet}`;
    const status: 'inserted' | 'duplicate' = stored.has(key) ? 'duplicate' : 'inserted';
    stored.add(key);
    return Promise.resolve(status);
  });
  const onNewSwap = vi.fn();
  const ingest = createIngestor({
    registry: { get: (address) => wallets.get(address) },
    saveSwapEvent,
    onNewSwap,
    logger,
  });
  return { ingest, saveSwapEvent, onNewSwap };
}

describe('createIngestor', () => {
  it('stores and announces a swap by a tracked wallet exactly once across redeliveries', async () => {
    const { tx, feePayer } = loadFixture('pumpfun-sell-v1');
    const { ingest, saveSwapEvent, onNewSwap } = setup([feePayer]);

    expect(await ingest([tx])).toEqual({ swaps: 1, duplicates: 0, skipped: 0 });
    expect(await ingest([tx])).toEqual({ swaps: 0, duplicates: 1, skipped: 0 });

    expect(saveSwapEvent).toHaveBeenCalledTimes(2);
    expect(onNewSwap).toHaveBeenCalledTimes(1);
    const [event, wallet] = onNewSwap.mock.calls[0] as [SwapEvent, TrackedWalletInfo];
    expect(event).toMatchObject({ side: 'sell', wallet: feePayer, source: 'pumpfun' });
    expect(wallet.address).toBe(feePayer);
    expect(saveSwapEvent.mock.calls[0]?.[1]).toMatchObject({ version: 1, feeLamports: '9000' });
  });

  it('ignores transactions where no tracked wallet signed', async () => {
    const { tx } = loadFixture('pumpswap-buy-reverse-pool-token2022');
    // The pool owner's balances changed, but it did not sign.
    const poolOwner = tx.meta.postTokenBalances?.find(
      (b) => b.owner !== undefined && b.owner !== tx.transaction.message.accountKeys[0],
    )?.owner;
    const { ingest, saveSwapEvent } = setup([poolOwner ?? 'none']);
    expect(await ingest([tx])).toEqual({ swaps: 0, duplicates: 0, skipped: 0 });
    expect(saveSwapEvent).not.toHaveBeenCalled();
  });

  it('counts tracked-wallet transactions that are not swaps as skipped', async () => {
    const failed = loadFixture('failed-transaction');
    const arb = loadFixture('arbitrage-no-token-change');
    const { ingest, onNewSwap } = setup([failed.feePayer, arb.feePayer]);
    expect(await ingest([failed.tx, arb.tx])).toEqual({ swaps: 0, duplicates: 0, skipped: 2 });
    expect(onNewSwap).not.toHaveBeenCalled();
  });
});
