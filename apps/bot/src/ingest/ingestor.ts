import {
  normalizeSwap,
  transactionSigners,
  type RawTransaction,
  type SwapBreakdown,
  type SwapEvent,
} from '@solaryna/core';
import type { Logger } from 'pino';
import type { TrackedWalletInfo, WalletRegistry } from '../wallets/registry';

export interface IngestorDeps {
  registry: Pick<WalletRegistry, 'get'>;
  saveSwapEvent(event: SwapEvent, raw: unknown): Promise<'inserted' | 'duplicate'>;
  /** Called once per newly stored swap. Must not throw; runs after the swap is persisted. */
  onNewSwap(event: SwapEvent, wallet: TrackedWalletInfo): void;
  logger: Logger;
}

export interface IngestStats {
  swaps: number;
  duplicates: number;
  skipped: number;
}

/** Compact record kept with each swap for debugging the parser (JSON: bigints as strings). */
function compactRaw(tx: RawTransaction, breakdown: SwapBreakdown) {
  return {
    version: tx.version ?? null,
    feeLamports: breakdown.feeLamports.toString(),
    nativeDeltaLamports: breakdown.nativeDeltaLamports.toString(),
    wsolDeltaLamports: breakdown.wsolDeltaLamports.toString(),
    rentAdjustmentLamports: breakdown.rentAdjustmentLamports.toString(),
    programIds: breakdown.programIds,
  };
}

export function createIngestor(deps: IngestorDeps) {
  return async function ingest(transactions: readonly RawTransaction[]): Promise<IngestStats> {
    const stats: IngestStats = { swaps: 0, duplicates: 0, skipped: 0 };
    for (const tx of transactions) {
      const signature = tx.transaction.signatures[0];
      // Only wallets that signed can have made a swap; others merely received something.
      for (const signer of transactionSigners(tx)) {
        const wallet = deps.registry.get(signer);
        if (wallet === undefined) {
          continue;
        }
        const result = normalizeSwap(tx, signer);
        if (!result.ok) {
          stats.skipped++;
          const log = result.reason === 'invalid_balances' ? deps.logger.warn : deps.logger.debug;
          log.call(
            deps.logger,
            { signature, wallet: signer, reason: result.reason },
            'Not a supported swap',
          );
          continue;
        }
        const status = await deps.saveSwapEvent(result.event, compactRaw(tx, result.breakdown));
        if (status === 'duplicate') {
          stats.duplicates++;
          deps.logger.debug({ signature, wallet: signer }, 'Duplicate swap delivery ignored');
          continue;
        }
        stats.swaps++;
        deps.logger.info(
          {
            signature,
            wallet: signer,
            side: result.event.side,
            tokenMint: result.event.tokenMint,
            source: result.event.source,
          },
          'Swap ingested',
        );
        deps.onNewSwap(result.event, wallet);
      }
    }
    return stats;
  };
}

export type Ingest = ReturnType<typeof createIngestor>;
