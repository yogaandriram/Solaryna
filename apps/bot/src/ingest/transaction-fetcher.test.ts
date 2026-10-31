import type { RawTransaction } from '@solaryna/core';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { loadFixture } from './test-fixtures';
import { createTransactionFetcher } from './transaction-fetcher';

function setup(responses: unknown[]) {
  const getTransaction = vi.fn(() => Promise.resolve(responses.shift() ?? null));
  const onTransactions = vi.fn((_txs: RawTransaction[]) => Promise.resolve());
  const sleep = vi.fn(() => Promise.resolve());
  const enqueue = createTransactionFetcher({
    getTransaction,
    onTransactions,
    logger: pino({ level: 'silent' }),
    retryDelaysMs: [10, 20],
    sleep,
  });
  return { enqueue, getTransaction, onTransactions, sleep };
}

describe('createTransactionFetcher', () => {
  it('retries until the transaction is available, then ingests it', async () => {
    const { json } = loadFixture('meteora-sell');
    const { enqueue, getTransaction, onTransactions, sleep } = setup([null, json]);
    await enqueue('sig');
    expect(getTransaction).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
    expect(onTransactions).toHaveBeenCalledTimes(1);
  });

  it('gives up after the last retry', async () => {
    const { enqueue, getTransaction, onTransactions } = setup([]);
    await enqueue('sig');
    expect(getTransaction).toHaveBeenCalledTimes(3);
    expect(onTransactions).not.toHaveBeenCalled();
  });

  it('fetches a signature once even if several wallets report it', async () => {
    const { json } = loadFixture('meteora-sell');
    const { enqueue, getTransaction } = setup([json, json]);
    await Promise.all([enqueue('sig'), enqueue('sig')]);
    expect(getTransaction).toHaveBeenCalledTimes(1);
  });

  it('skips payloads that are not transactions and survives fetch errors', async () => {
    const malformed = setup([{ not: 'a transaction' }]);
    await malformed.enqueue('sig');
    expect(malformed.onTransactions).not.toHaveBeenCalled();

    const failing = setup([]);
    failing.getTransaction.mockRejectedValueOnce(new Error('HTTP 429'));
    await expect(failing.enqueue('sig')).resolves.toBeUndefined();
  });
});
