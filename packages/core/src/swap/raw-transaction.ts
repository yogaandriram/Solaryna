import { z } from 'zod';

// Shape of a transaction as returned by RPC `getTransaction` (encoding "json") and delivered by
// Helius "raw" webhooks. Only the fields the parser reads are validated; the rest is dropped.
// Works for legacy, v0 (address lookup tables), and v1 transactions.

const instruction = z.object({ programIdIndex: z.number().int().nonnegative() });

const tokenBalance = z.object({
  accountIndex: z.number().int().nonnegative(),
  mint: z.string(),
  owner: z.string().optional(),
  uiTokenAmount: z.object({
    amount: z.string().regex(/^\d+$/),
    decimals: z.number().int().min(0).max(255),
  }),
});

const lamports = z.array(z.number().int().nonnegative());

export const rawTransactionSchema = z.object({
  slot: z.number().int().nonnegative(),
  blockTime: z.number().int().nullish(),
  version: z.union([z.literal('legacy'), z.number().int()]).optional(),
  meta: z.object({
    err: z.unknown(),
    fee: z.number().int().nonnegative(),
    preBalances: lamports,
    postBalances: lamports,
    preTokenBalances: z.array(tokenBalance).nullish(),
    postTokenBalances: z.array(tokenBalance).nullish(),
    innerInstructions: z
      .array(z.object({ index: z.number().int(), instructions: z.array(instruction) }))
      .nullish(),
    loadedAddresses: z
      .object({ writable: z.array(z.string()), readonly: z.array(z.string()) })
      .nullish(),
  }),
  transaction: z.object({
    signatures: z.array(z.string()).min(1),
    message: z.object({
      accountKeys: z.array(z.string()).min(1),
      header: z.object({ numRequiredSignatures: z.number().int().positive() }),
      instructions: z.array(instruction),
    }),
  }),
});

export type RawTransaction = z.infer<typeof rawTransactionSchema>;

/** Static keys followed by lookup-table addresses (writable, then readonly), as indexed by meta. */
export function allAccountKeys(tx: RawTransaction): string[] {
  const loaded = tx.meta.loadedAddresses;
  return [
    ...tx.transaction.message.accountKeys,
    ...(loaded?.writable ?? []),
    ...(loaded?.readonly ?? []),
  ];
}

export function transactionSigners(tx: RawTransaction): string[] {
  const { accountKeys, header } = tx.transaction.message;
  return accountKeys.slice(0, header.numRequiredSignatures);
}

export function invokedProgramIds(tx: RawTransaction, keys = allAccountKeys(tx)): Set<string> {
  const programIds = new Set<string>();
  const add = (index: number) => {
    const key = keys[index];
    if (key !== undefined) {
      programIds.add(key);
    }
  };
  for (const ix of tx.transaction.message.instructions) {
    add(ix.programIdIndex);
  }
  for (const group of tx.meta.innerInstructions ?? []) {
    for (const ix of group.instructions) {
      add(ix.programIdIndex);
    }
  }
  return programIds;
}
