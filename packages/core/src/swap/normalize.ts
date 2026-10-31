import { SOL_DECIMALS, USDC_DECIMALS, USDC_MINT, WSOL_MINT } from '../constants';
import type { SwapEvent, SwapSide } from '../types';
import { detectSwapSource } from './programs';
import { allAccountKeys, invokedProgramIds, type RawTransaction } from './raw-transaction';

export type SwapSkipReason =
  | 'failed_transaction'
  | 'missing_block_time'
  | 'wallet_not_signer'
  | 'invalid_balances'
  | 'no_token_change'
  | 'multiple_token_changes'
  | 'no_quote_change'
  | 'not_a_swap';

/** How the quote amount was derived, kept for debugging the parser. */
export interface SwapBreakdown {
  /** Network fee paid by the wallet (0 when another account is the fee payer). */
  feeLamports: bigint;
  nativeDeltaLamports: bigint;
  wsolDeltaLamports: bigint;
  /** Token-account rent paid (+) or refunded (−) by the wallet, excluded from the quote. */
  rentAdjustmentLamports: bigint;
  /** The wallet's balance of the swapped token before the transaction (for follow-sell). */
  walletTokenBalanceBeforeRaw: bigint;
  programIds: string[];
}

export type NormalizeSwapResult =
  { ok: true; event: SwapEvent; breakdown: SwapBreakdown } | { ok: false; reason: SwapSkipReason };

interface OwnedTokenAccount {
  mint: string;
  decimals: number;
  pre: bigint | null;
  post: bigint | null;
  preLamports: bigint;
  postLamports: bigint;
}

const skip = (reason: SwapSkipReason): NormalizeSwapResult => ({ ok: false, reason });
const abs = (value: bigint) => (value < 0n ? -value : value);

function lamportsAt(balances: readonly number[], index: number): bigint | null {
  const value = balances[index];
  return value !== undefined && Number.isSafeInteger(value) ? BigInt(value) : null;
}

function ownedTokenAccounts(tx: RawTransaction, wallet: string): OwnedTokenAccount[] | null {
  const byIndex = new Map<number, Omit<OwnedTokenAccount, 'preLamports' | 'postLamports'>>();
  const visit = (balances: RawTransaction['meta']['preTokenBalances'], field: 'pre' | 'post') => {
    for (const balance of balances ?? []) {
      if (balance.owner !== wallet) {
        continue;
      }
      const entry = byIndex.get(balance.accountIndex) ?? {
        mint: balance.mint,
        decimals: balance.uiTokenAmount.decimals,
        pre: null,
        post: null,
      };
      entry[field] = BigInt(balance.uiTokenAmount.amount);
      byIndex.set(balance.accountIndex, entry);
    }
  };
  visit(tx.meta.preTokenBalances, 'pre');
  visit(tx.meta.postTokenBalances, 'post');

  const accounts: OwnedTokenAccount[] = [];
  for (const [index, entry] of byIndex) {
    const preLamports = lamportsAt(tx.meta.preBalances, index);
    const postLamports = lamportsAt(tx.meta.postBalances, index);
    if (preLamports === null || postLamports === null) {
      return null;
    }
    accounts.push({ ...entry, preLamports, postLamports });
  }
  return accounts;
}

/**
 * Turns a confirmed transaction into a buy/sell by `wallet`, from the wallet's own balance
 * changes, so it works for any DEX or router. The wallet must have signed the transaction:
 * tokens merely sent to it (airdrops, spam) are not buys.
 *
 * The SOL quote is the wallet's net SOL + WSOL change, excluding the network fee and
 * token-account rent; it includes tips and platform fees the wallet paid. A USDC leg, if it
 * moved opposite to the token, takes precedence as the quote.
 */
export function normalizeSwap(tx: RawTransaction, wallet: string): NormalizeSwapResult {
  if (tx.meta.err !== null) {
    return skip('failed_transaction');
  }
  if (tx.blockTime === null || tx.blockTime === undefined) {
    return skip('missing_block_time');
  }
  const { accountKeys, header } = tx.transaction.message;
  const walletIndex = accountKeys.indexOf(wallet);
  if (walletIndex < 0 || walletIndex >= header.numRequiredSignatures) {
    return skip('wallet_not_signer');
  }

  const preLamports = lamportsAt(tx.meta.preBalances, walletIndex);
  const postLamports = lamportsAt(tx.meta.postBalances, walletIndex);
  const accounts = ownedTokenAccounts(tx, wallet);
  if (preLamports === null || postLamports === null || accounts === null) {
    return skip('invalid_balances');
  }
  const feeLamports = walletIndex === 0 ? BigInt(tx.meta.fee) : 0n;
  const nativeDelta = postLamports - preLamports + feeLamports;

  let wsolDelta = 0n;
  let usdcDelta = 0n;
  let usdcDecimals = USDC_DECIMALS;
  let rentAdjustment = 0n;
  const tokenDeltas = new Map<string, { delta: bigint; decimals: number }>();
  for (const account of accounts) {
    const wrapped = account.mint === WSOL_MINT;
    if (account.pre === null && account.post !== null) {
      rentAdjustment += account.postLamports - (wrapped ? account.post : 0n);
    } else if (account.pre !== null && account.post === null) {
      rentAdjustment -= account.preLamports - (wrapped ? account.pre : 0n);
    }

    const delta = (account.post ?? 0n) - (account.pre ?? 0n);
    if (wrapped) {
      wsolDelta += delta;
    } else if (account.mint === USDC_MINT) {
      usdcDelta += delta;
      usdcDecimals = account.decimals;
    } else {
      const current = tokenDeltas.get(account.mint);
      tokenDeltas.set(account.mint, {
        delta: (current?.delta ?? 0n) + delta,
        decimals: account.decimals,
      });
    }
  }

  const changed = [...tokenDeltas].filter(([, token]) => token.delta !== 0n);
  const [first, ...others] = changed;
  if (first === undefined) {
    return skip('no_token_change');
  }
  if (others.length > 0) {
    return skip('multiple_token_changes');
  }
  const [tokenMint, token] = first;
  const walletTokenBalanceBefore = accounts
    .filter((account) => account.mint === tokenMint)
    .reduce((sum, account) => sum + (account.pre ?? 0n), 0n);

  const side: SwapSide = token.delta > 0n ? 'buy' : 'sell';
  const solDelta = nativeDelta + wsolDelta + rentAdjustment;
  const oppositeToToken = (delta: bigint) => (side === 'buy' ? delta < 0n : delta > 0n);
  const quote = oppositeToToken(usdcDelta)
    ? { mint: USDC_MINT, amount: abs(usdcDelta), decimals: usdcDecimals }
    : oppositeToToken(solDelta)
      ? { mint: WSOL_MINT, amount: abs(solDelta), decimals: SOL_DECIMALS }
      : null;
  if (quote === null) {
    return skip(solDelta === 0n && usdcDelta === 0n ? 'no_quote_change' : 'not_a_swap');
  }

  const keys = allAccountKeys(tx);
  const programIds = [...invokedProgramIds(tx, keys)];
  return {
    ok: true,
    event: {
      signature: tx.transaction.signatures[0] ?? '',
      slot: BigInt(tx.slot),
      blockTime: new Date(tx.blockTime * 1000),
      wallet,
      side,
      tokenMint,
      tokenAmountRaw: abs(token.delta),
      tokenDecimals: token.decimals,
      quoteMint: quote.mint,
      quoteAmountRaw: quote.amount,
      quoteDecimals: quote.decimals,
      source: detectSwapSource(programIds),
    },
    breakdown: {
      feeLamports,
      nativeDeltaLamports: nativeDelta,
      wsolDeltaLamports: wsolDelta,
      rentAdjustmentLamports: rentAdjustment,
      walletTokenBalanceBeforeRaw: walletTokenBalanceBefore,
      programIds,
    },
  };
}
