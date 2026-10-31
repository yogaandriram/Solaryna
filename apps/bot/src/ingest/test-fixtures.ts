import { readFileSync } from 'node:fs';
import { rawTransactionSchema, transactionSigners, type RawTransaction } from '@solaryna/core';

/** Loads a real-transaction fixture from packages/core/test/fixtures (tests only). */
export function loadFixture(name: string): { json: unknown; tx: RawTransaction; feePayer: string } {
  const url = new URL(`../../../../packages/core/test/fixtures/${name}.json`, import.meta.url);
  const json: unknown = JSON.parse(readFileSync(url, 'utf8'));
  const tx = rawTransactionSchema.parse(json);
  const [feePayer] = transactionSigners(tx);
  if (feePayer === undefined) {
    throw new Error(`fixture ${name} has no signer`);
  }
  return { json, tx, feePayer };
}
