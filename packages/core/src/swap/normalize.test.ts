import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { USDC_MINT, WSOL_MINT } from '../constants';
import { normalizeSwap } from './normalize';
import { detectSwapSource } from './programs';
import { rawTransactionSchema, transactionSigners, type RawTransaction } from './raw-transaction';

// Real mainnet transactions (public data) fetched with scripts/fetch-tx-fixture.ts.
// Expected quote amounts were cross-checked against the counterparty pool vault's balance change.
function fixture(name: string): RawTransaction {
  const url = new URL(`../../test/fixtures/${name}.json`, import.meta.url);
  return rawTransactionSchema.parse(JSON.parse(readFileSync(url, 'utf8')));
}

function feePayer(tx: RawTransaction): string {
  const [payer] = transactionSigners(tx);
  if (payer === undefined) {
    throw new Error('fixture has no signer');
  }
  return payer;
}

function swapOf(name: string) {
  const tx = fixture(name);
  const result = normalizeSwap(tx, feePayer(tx));
  if (!result.ok) {
    throw new Error(`expected a swap, got ${result.reason}`);
  }
  return result;
}

describe('normalizeSwap with real transactions', () => {
  it.each([
    {
      name: 'pumpfun-buy-v1-new-ata',
      side: 'buy',
      source: 'pumpfun',
      tokenMint: 'AbrEhdN9Zsb5AvE5Pubd9VkUUr6ufAHfZ9zo7KAppump',
      tokenAmountRaw: 1_129_709_550_122n,
      quoteMint: WSOL_MINT,
      quoteAmountRaw: 10_366_732n,
    },
    {
      name: 'pumpfun-sell-v1',
      side: 'sell',
      source: 'pumpfun',
      tokenMint: '4CLJSkwJ7JsNvrtZrVwqcXecYrAwUTSkTC1p7gzqpump',
      tokenAmountRaw: 27_483_996_149_265n,
      quoteMint: WSOL_MINT,
      quoteAmountRaw: 3_639_046_262n,
    },
    {
      name: 'pumpswap-sell-legacy',
      side: 'sell',
      source: 'pumpswap',
      tokenMint: '9RTLWC7rYkmkzzCaqzYUcRkZxJaRE66hSDAQKTBMpump',
      tokenAmountRaw: 1_007_342_635_143n,
      quoteMint: WSOL_MINT,
      quoteAmountRaw: 719_011_314n,
    },
    {
      name: 'raydium-buy-usdc',
      side: 'buy',
      source: 'raydium',
      tokenMint: 'iGG7XyyxGKSR6x5j365S9kcSy6o5kDP3XdqkuayGex6',
      tokenAmountRaw: 265_743_014n,
      quoteMint: USDC_MINT,
      quoteAmountRaw: 4_402_076n,
    },
    {
      name: 'meteora-buy',
      side: 'buy',
      source: 'meteora',
      tokenMint: '8M8sLzU5EruvYRNEnmxqhS1zCyn4aAjZtohfMEcNWEH4',
      tokenAmountRaw: 290_047_856_130n,
      quoteMint: WSOL_MINT,
      quoteAmountRaw: 135_363_834n,
    },
    {
      name: 'meteora-sell',
      side: 'sell',
      source: 'meteora',
      tokenMint: 'HiDTeGjkCxNgLUNtnm1MKoU9Hjoybnp2bFN2H3aKa8V6',
      tokenAmountRaw: 171_868_147_624n,
      quoteMint: WSOL_MINT,
      quoteAmountRaw: 1_150_781_204n,
    },
    {
      name: 'jupiter-sell',
      side: 'sell',
      source: 'jupiter',
      tokenMint: '7SL2VnfYsChvog5oQY9Nmtqu1wceaMiQzWoqoLQpump',
      tokenAmountRaw: 20_399_765n,
      quoteMint: WSOL_MINT,
      quoteAmountRaw: 231_981n,
    },
    {
      // Jupiter route that also pays a 1% platform fee: the quote is what the wallet spent.
      name: 'jupiter-buy-v1-platform-fee',
      side: 'buy',
      source: 'jupiter',
      tokenMint: '2XeCaN9PzGGqm6j1nbpDq5rSZUiUtK8A1B6zqsB88DmY',
      tokenAmountRaw: 57_992_762_348_767_840n,
      quoteMint: WSOL_MINT,
      quoteAmountRaw: 505_000_000n,
    },
  ] as const)('$name → $side on $source', (expected) => {
    const { event } = swapOf(expected.name);
    expect(event).toMatchObject({
      side: expected.side,
      source: expected.source,
      tokenMint: expected.tokenMint,
      tokenAmountRaw: expected.tokenAmountRaw,
      tokenDecimals: 6,
      quoteMint: expected.quoteMint,
      quoteAmountRaw: expected.quoteAmountRaw,
      quoteDecimals: expected.quoteMint === USDC_MINT ? 6 : 9,
    });
  });

  it('reads a reverse PumpSwap pool correctly even though the program logs "Sell"', () => {
    // Pool base is WSOL, so the AMM's "Sell" (of base) is a token buy. The wallet paid
    // 1,563,044 lamports = 5,000 fee + 1,513,840 rent for a new Token-2022 account + 44,204
    // to the pool, and the pool's WSOL vault grew by exactly 44,204.
    const { event, breakdown } = swapOf('pumpswap-buy-reverse-pool-token2022');
    expect(event.side).toBe('buy');
    expect(event.source).toBe('pumpswap');
    expect(event.tokenAmountRaw).toBe(582_246_961n);
    expect(event.quoteAmountRaw).toBe(44_204n);
    expect(breakdown).toMatchObject({
      feeLamports: 5_000n,
      nativeDeltaLamports: -1_558_044n,
      rentAdjustmentLamports: 1_513_840n,
    });
  });

  it('fills the event identity fields from the transaction', () => {
    const { event } = swapOf('pumpfun-sell-v1');
    expect(event).toMatchObject({
      signature:
        'ZZmZgznrDWqm2fGnWiSjQfU1XHPbhC6arvAVDnhNsFoJ9GQGvuBBf9wiwFejKkTitn8y5Xvkh3gZQCrRNUxgTHQ',
      slot: 463_539_517n,
      wallet: 'J8M2wM8vtBLZJfajpczrjbs78PWhW1sqVFVJdE5d43jX',
    });
    expect(event.blockTime.toISOString()).toBe('2026-10-31T03:36:40.000Z');
  });

  it.each([
    ['failed-transaction', 'failed_transaction'],
    ['arbitrage-no-token-change', 'no_token_change'],
    ['multiple-token-changes', 'multiple_token_changes'],
  ] as const)('skips %s (%s)', (name, reason) => {
    const tx = fixture(name);
    expect(normalizeSwap(tx, feePayer(tx))).toEqual({ ok: false, reason });
  });

  it('ignores wallets that did not sign, even if their balances changed', () => {
    const tx = fixture('pumpswap-buy-reverse-pool-token2022');
    const signers = new Set(transactionSigners(tx));
    const poolOwner = tx.meta.postTokenBalances?.find(
      (balance) => balance.owner !== undefined && !signers.has(balance.owner),
    )?.owner;
    expect(poolOwner).toBeDefined();
    expect(normalizeSwap(tx, poolOwner ?? '')).toEqual({ ok: false, reason: 'wallet_not_signer' });
    expect(normalizeSwap(tx, WSOL_MINT)).toEqual({ ok: false, reason: 'wallet_not_signer' });
  });

  it('skips transactions without a block time', () => {
    const tx = { ...fixture('meteora-buy'), blockTime: null };
    expect(normalizeSwap(tx, feePayer(tx))).toEqual({ ok: false, reason: 'missing_block_time' });
  });
});

describe('normalizeSwap with synthetic transactions', () => {
  const wallet = 'J8M2wM8vtBLZJfajpczrjbs78PWhW1sqVFVJdE5d43jX';
  const mint = '4CLJSkwJ7JsNvrtZrVwqcXecYrAwUTSkTC1p7gzqpump';
  const friend = '7Qo2h635jRHeezk9sJTC8iVrSzUG7tbeyQowVRJbxDzb';

  function transfer(overrides: { walletPost?: number } = {}): RawTransaction {
    const balance = (accountIndex: number, owner: string, amount: string) => ({
      accountIndex,
      mint,
      owner,
      uiTokenAmount: { amount, decimals: 6 },
    });
    return {
      slot: 1,
      blockTime: 1_793_000_000,
      meta: {
        err: null,
        fee: 5_000,
        preBalances: [1_000_000_000, 2_039_280, 2_039_280],
        postBalances: [overrides.walletPost ?? 999_995_000, 2_039_280, 2_039_280],
        preTokenBalances: [balance(1, wallet, '500'), balance(2, friend, '0')],
        postTokenBalances: [balance(1, wallet, '0'), balance(2, friend, '500')],
      },
      transaction: {
        signatures: ['sig'],
        message: {
          accountKeys: [wallet, 'walletAta', 'friendAta'],
          header: { numRequiredSignatures: 1 },
          instructions: [],
        },
      },
    };
  }

  it('does not treat a plain token transfer as a sell', () => {
    expect(normalizeSwap(transfer(), wallet)).toEqual({ ok: false, reason: 'no_quote_change' });
  });

  it('does not treat a transfer that also pays SOL as a swap', () => {
    // Token out and SOL out: both legs move the same direction.
    expect(normalizeSwap(transfer({ walletPost: 997_000_000 }), wallet)).toEqual({
      ok: false,
      reason: 'not_a_swap',
    });
  });

  it('rejects balances outside the safe integer range instead of losing precision', () => {
    expect(normalizeSwap(transfer({ walletPost: Number.MAX_SAFE_INTEGER + 2 }), wallet)).toEqual({
      ok: false,
      reason: 'invalid_balances',
    });
  });
});

describe('rawTransactionSchema', () => {
  it('accepts legacy, v0, and v1 transactions', () => {
    const versions = [
      'pumpswap-sell-legacy',
      'pumpswap-buy-reverse-pool-token2022',
      'pumpfun-sell-v1',
    ].map((name) => fixture(name).version);
    expect(versions).toEqual(['legacy', 0, 1]);
  });

  it('rejects payloads that are not transactions', () => {
    expect(rawTransactionSchema.safeParse({ type: 'SWAP', description: 'x' }).success).toBe(false);
    expect(rawTransactionSchema.safeParse(null).success).toBe(false);
  });
});

describe('detectSwapSource', () => {
  it('prefers the aggregator, then the most specific venue', () => {
    expect(
      detectSwapSource([
        '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
        'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
      ]),
    ).toBe('jupiter');
    expect(
      detectSwapSource([
        '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
        '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
      ]),
    ).toBe('pumpfun');
    expect(detectSwapSource(['11111111111111111111111111111111'])).toBe('unknown');
  });
});
