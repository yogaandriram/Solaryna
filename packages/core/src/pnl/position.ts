// Position accounting with average cost. All amounts are raw (lamports / raw token units).

export interface PositionState {
  initialTokenAmountRaw: bigint;
  tokenAmountRaw: bigint;
  costLamports: bigint;
  proceedsLamports: bigint;
  /** Every fee paid so far, including the buy. */
  feesLamports: bigint;
  realizedPnlLamports: bigint;
}

export interface SellFill {
  tokenAmountRaw: bigint;
  solAmountLamports: bigint;
  feesLamports: bigint;
}

export interface SellRealization {
  next: PositionState;
  /** Net PnL realized by this sale. */
  realizedPnlLamports: bigint;
  closed: boolean;
}

/** Cost of the tokens still held, prorated from the initial amount (rounded down). */
export function remainingCostLamports(state: PositionState): bigint {
  if (state.initialTokenAmountRaw === 0n) {
    return 0n;
  }
  return (state.costLamports * state.tokenAmountRaw) / state.initialTokenAmountRaw;
}

/** Fees already paid but not yet in the realized PnL: the buy fees, until the first sale. */
export function pendingBuyFeesLamports(
  position: Pick<PositionState, 'tokenAmountRaw' | 'initialTokenAmountRaw' | 'feesLamports'>,
): bigint {
  return position.tokenAmountRaw === position.initialTokenAmountRaw ? position.feesLamports : 0n;
}

/**
 * Estimated PnL of selling the remainder for `netValueLamports` (the sell quote minus sell
 * fees): what the position would add to the realized PnL, including buy fees not yet realized.
 */
export function estimatedPnlLamports(state: PositionState, netValueLamports: bigint): bigint {
  return netValueLamports - remainingCostLamports(state) - pendingBuyFeesLamports(state);
}

/**
 * Applies a sale. A partial sale realizes its share of the cost; the buy fees are realized on
 * the first sale. The final sale realizes the exact remainder, so the position's total
 * realized PnL equals proceeds - cost - all fees with no rounding drift.
 */
export function applySell(state: PositionState, sell: SellFill): SellRealization {
  const quantity = sell.tokenAmountRaw;
  if (quantity <= 0n || quantity > state.tokenAmountRaw) {
    throw new RangeError(
      `Cannot sell ${quantity} raw tokens from a position holding ${state.tokenAmountRaw}`,
    );
  }
  const proceeds = state.proceedsLamports + sell.solAmountLamports;
  const fees = state.feesLamports + sell.feesLamports;
  const closed = quantity === state.tokenAmountRaw;

  let realized: bigint;
  if (closed) {
    realized = proceeds - state.costLamports - fees - state.realizedPnlLamports;
  } else {
    const isFirstSale = state.tokenAmountRaw === state.initialTokenAmountRaw;
    const costOfSold = (state.costLamports * quantity) / state.initialTokenAmountRaw;
    realized =
      sell.solAmountLamports -
      costOfSold -
      sell.feesLamports -
      (isFirstSale ? state.feesLamports : 0n);
  }

  return {
    next: {
      ...state,
      tokenAmountRaw: state.tokenAmountRaw - quantity,
      proceedsLamports: proceeds,
      feesLamports: fees,
      realizedPnlLamports: state.realizedPnlLamports + realized,
    },
    realizedPnlLamports: realized,
    closed,
  };
}

/**
 * How much of our position to sell when the wallet sold `walletSoldRaw` out of
 * `walletBalanceBeforeRaw`. Sells everything when the wallet sold it all or its balance before
 * the swap is unknown. May round down to 0 for a tiny share.
 */
export function followSellTokenAmount(
  positionTokenAmountRaw: bigint,
  walletSoldRaw: bigint,
  walletBalanceBeforeRaw: bigint | null,
): bigint {
  if (
    walletBalanceBeforeRaw === null ||
    walletBalanceBeforeRaw <= 0n ||
    walletSoldRaw >= walletBalanceBeforeRaw
  ) {
    return positionTokenAmountRaw;
  }
  return (positionTokenAmountRaw * walletSoldRaw) / walletBalanceBeforeRaw;
}
