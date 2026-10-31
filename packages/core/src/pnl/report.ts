import { LAMPORTS_PER_SOL, USDC_MINT, WSOL_MINT } from '../constants';
import { Decimal } from '../decimal';
import { RISK_REASON_CODES, type RiskReason, type RiskReasonCode } from '../risk/types';
import { CLOSE_REASONS, type CloseReason, type SwapSide, type TradeReason } from '../types';

// Report aggregation for paper/live results. The cause decomposition is documented in
// ./README.md; change it only together with report.test.ts.

/** One side of the tracked wallet's own swap on the token. */
export interface WalletLeg {
  quoteMint: string;
  quoteAmountRaw: bigint;
  quoteDecimals: number;
  tokenAmountRaw: bigint;
}

export interface ReportPosition {
  id: number;
  tokenMint: string;
  tokenSymbol: string | null;
  tokenDecimals: number;
  walletId: number | null;
  walletAddress: string | null;
  walletLabel: string | null;
  closeReason: CloseReason;
  costLamports: bigint;
  initialTokenAmountRaw: bigint;
  proceedsLamports: bigint;
  feesLamports: bigint;
  realizedPnlLamports: bigint;
  /** The wallet buy that opened the position. */
  walletEntry: WalletLeg | null;
  /** The wallet's sells of the token after its entry, up to the end of the period. */
  walletExits: WalletLeg[];
  /** SOL price in USD at our buy / last sell, for wallets that traded in USDC. */
  buySolUsd: Decimal | null;
  exitSolUsd: Decimal | null;
}

export interface ReportTrade {
  side: SwapSide;
  reason: TradeReason;
  networkFeeLamports: bigint;
  priorityFeeLamports: bigint;
  dexFeeLamports: bigint;
  realizedPnlLamports: bigint | null;
}

/** A buy signal and its risk decision. */
export interface ReportSignal {
  walletId: number;
  walletAddress: string;
  walletLabel: string | null;
  decision: 'accepted' | 'rejected';
  reasons: RiskReason[];
}

/**
 * Why we made or lost money: wallet + entry + exit + unattributed = gross PnL (proceeds - cost),
 * and net = gross - fees. Positions whose wallet prices are unknown go to `unattributed`.
 */
export interface Decomposition {
  walletLamports: bigint;
  entryLamports: bigint;
  exitLamports: bigint;
  unattributedLamports: bigint;
  feesLamports: bigint;
  netLamports: bigint;
  positions: number;
  unattributedPositions: number;
  walletStillHoldingPositions: number;
}

export interface FeeTotals {
  network: bigint;
  priority: bigint;
  dex: bigint;
  total: bigint;
}

export interface ReasonCount {
  code: RiskReasonCode;
  count: number;
}

export interface PeriodTotals {
  /** Sum of the realized PnL of trades executed in the period. */
  realizedPnlLamports: bigint;
  buys: number;
  sells: number;
  /** Positions closed in the period with a positive / non-positive net PnL. */
  wins: number;
  losses: number;
  fees: FeeTotals;
  acceptedSignals: number;
  rejectedSignals: number;
  topRejections: ReasonCount[];
}

export interface OpenPositionValue {
  remainingCostLamports: bigint;
  /** Latest sell quote minus sell fees; null when unpriced. */
  netValueLamports: bigint | null;
  /** Fees paid but not realized yet (the buy fees until the first sale). */
  pendingFeesLamports: bigint;
}

export interface DailySummary extends PeriodTotals {
  openCount: number;
  unpricedOpenCount: number;
  /** null when no open position has a price. */
  unrealizedPnlLamports: bigint | null;
}

export interface WalletReport {
  walletId: number | null;
  walletAddress: string | null;
  walletLabel: string | null;
  buySignals: number;
  positions: number;
  realizedPnlLamports: bigint;
  winRate: Decimal | null;
  decomposition: Decomposition;
}

export interface WeeklyReport {
  totals: PeriodTotals;
  positions: number;
  winRate: Decimal | null;
  /** Worst result first. */
  perWallet: WalletReport[];
  decomposition: Decomposition;
  perExitReason: { reason: CloseReason; count: number; realizedPnlLamports: bigint }[];
  rejectedByReason: ReasonCount[];
  best: ReportPosition | null;
  worst: ReportPosition | null;
}

const EMPTY_DECOMPOSITION: Decomposition = {
  walletLamports: 0n,
  entryLamports: 0n,
  exitLamports: 0n,
  unattributedLamports: 0n,
  feesLamports: 0n,
  netLamports: 0n,
  positions: 0,
  unattributedPositions: 0,
  walletStillHoldingPositions: 0,
};

/** The SOL value of a wallet leg in lamports; null when it cannot be converted. */
function legLamports(leg: WalletLeg, solUsd: Decimal | null): Decimal | null {
  if (leg.quoteMint === WSOL_MINT) {
    return new Decimal(leg.quoteAmountRaw.toString());
  }
  if (leg.quoteMint === USDC_MINT && solUsd !== null && solUsd.gt(0)) {
    const usd = new Decimal(leg.quoteAmountRaw.toString()).div(
      new Decimal(10).pow(leg.quoteDecimals),
    );
    return usd.div(solUsd).mul(LAMPORTS_PER_SOL.toString());
  }
  return null;
}

/** Average price in lamports per raw token over legs; null when unknown. */
function averagePrice(legs: WalletLeg[], solUsd: Decimal | null): Decimal | null {
  let lamports = new Decimal(0);
  let tokens = 0n;
  for (const leg of legs) {
    const value = legLamports(leg, solUsd);
    if (value === null) {
      return null;
    }
    lamports = lamports.plus(value);
    tokens += leg.tokenAmountRaw;
  }
  return tokens > 0n ? lamports.div(tokens.toString()) : null;
}

const toLamports = (value: Decimal) => BigInt(value.toFixed(0));

export function decomposePosition(p: ReportPosition): Decomposition {
  const gross = p.proceedsLamports - p.costLamports;
  const base = {
    ...EMPTY_DECOMPOSITION,
    feesLamports: p.feesLamports,
    netLamports: gross - p.feesLamports,
    positions: 1,
  };
  const walletEntryPrice =
    p.walletEntry === null ? null : averagePrice([p.walletEntry], p.buySolUsd);
  const walletStillHolding = p.walletExits.length === 0;
  const walletExitPrice = walletStillHolding ? null : averagePrice(p.walletExits, p.exitSolUsd);
  if (
    walletEntryPrice === null ||
    walletEntryPrice.lte(0) ||
    (!walletStillHolding && walletExitPrice === null) ||
    p.costLamports <= 0n ||
    p.initialTokenAmountRaw <= 0n
  ) {
    return { ...base, unattributedLamports: gross, unattributedPositions: 1 };
  }

  const cost = new Decimal(p.costLamports.toString());
  const initial = new Decimal(p.initialTokenAmountRaw.toString());
  const ourEntry = cost.div(initial);
  const ourExit = new Decimal(p.proceedsLamports.toString()).div(initial);
  // When the wallet has not sold, judge it by our exit price: the exit gap is then zero.
  const exitPrice = walletExitPrice ?? ourExit;

  const wallet = toLamports(cost.mul(exitPrice.div(walletEntryPrice).minus(1)));
  const entry = toLamports(
    cost.mul(exitPrice.div(ourEntry).minus(exitPrice.div(walletEntryPrice))),
  );
  return {
    ...base,
    walletLamports: wallet,
    entryLamports: entry,
    // Equals cost x (ourExit - exitPrice) / ourEntry; taking the remainder absorbs rounding.
    exitLamports: gross - wallet - entry,
    walletStillHoldingPositions: walletStillHolding ? 1 : 0,
  };
}

function addDecompositions(a: Decomposition, b: Decomposition): Decomposition {
  return {
    walletLamports: a.walletLamports + b.walletLamports,
    entryLamports: a.entryLamports + b.entryLamports,
    exitLamports: a.exitLamports + b.exitLamports,
    unattributedLamports: a.unattributedLamports + b.unattributedLamports,
    feesLamports: a.feesLamports + b.feesLamports,
    netLamports: a.netLamports + b.netLamports,
    positions: a.positions + b.positions,
    unattributedPositions: a.unattributedPositions + b.unattributedPositions,
    walletStillHoldingPositions: a.walletStillHoldingPositions + b.walletStillHoldingPositions,
  };
}

function sumDecompositions(positions: ReportPosition[]): Decomposition {
  return positions.map(decomposePosition).reduce(addDecompositions, EMPTY_DECOMPOSITION);
}

/** Counts each reason once per rejected signal; most frequent first. */
function countRejections(signals: ReportSignal[]): ReasonCount[] {
  const counts = new Map<RiskReasonCode, number>();
  for (const signal of signals) {
    if (signal.decision !== 'rejected') {
      continue;
    }
    for (const code of new Set(signal.reasons.map((reason) => reason.code))) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([code, count]) => ({ code, count }))
    .sort(
      (a, b) =>
        b.count - a.count || RISK_REASON_CODES.indexOf(a.code) - RISK_REASON_CODES.indexOf(b.code),
    );
}

function winRate(positions: ReportPosition[]): Decimal | null {
  if (positions.length === 0) {
    return null;
  }
  const wins = positions.filter((p) => p.realizedPnlLamports > 0n).length;
  return new Decimal(wins).div(positions.length);
}

function periodTotals(
  trades: ReportTrade[],
  closedPositions: ReportPosition[],
  signals: ReportSignal[],
): PeriodTotals {
  const fees = { network: 0n, priority: 0n, dex: 0n, total: 0n };
  let realized = 0n;
  for (const trade of trades) {
    fees.network += trade.networkFeeLamports;
    fees.priority += trade.priorityFeeLamports;
    fees.dex += trade.dexFeeLamports;
    realized += trade.realizedPnlLamports ?? 0n;
  }
  fees.total = fees.network + fees.priority + fees.dex;
  const wins = closedPositions.filter((p) => p.realizedPnlLamports > 0n).length;
  return {
    realizedPnlLamports: realized,
    buys: trades.filter((t) => t.side === 'buy').length,
    sells: trades.filter((t) => t.side === 'sell').length,
    wins,
    losses: closedPositions.length - wins,
    fees,
    acceptedSignals: signals.filter((s) => s.decision === 'accepted').length,
    rejectedSignals: signals.filter((s) => s.decision === 'rejected').length,
    topRejections: countRejections(signals).slice(0, 3),
  };
}

export function buildDailySummary(input: {
  trades: ReportTrade[];
  closedPositions: ReportPosition[];
  signals: ReportSignal[];
  open: OpenPositionValue[];
}): DailySummary {
  const priced = input.open.filter((p) => p.netValueLamports !== null);
  const unrealized = priced.reduce(
    (sum, p) => sum + (p.netValueLamports ?? 0n) - p.remainingCostLamports - p.pendingFeesLamports,
    0n,
  );
  return {
    ...periodTotals(input.trades, input.closedPositions, input.signals),
    openCount: input.open.length,
    unpricedOpenCount: input.open.length - priced.length,
    unrealizedPnlLamports: priced.length === 0 ? null : unrealized,
  };
}

export function buildWeeklyReport(input: {
  trades: ReportTrade[];
  closedPositions: ReportPosition[];
  signals: ReportSignal[];
}): WeeklyReport {
  const { closedPositions, signals } = input;

  const wallets = new Map<
    number | null,
    Pick<WalletReport, 'walletId' | 'walletAddress' | 'walletLabel'> & {
      buySignals: number;
      positions: ReportPosition[];
    }
  >();
  const walletEntry = (id: number | null, address: string | null, label: string | null) => {
    let entry = wallets.get(id);
    if (entry === undefined) {
      entry = {
        walletId: id,
        walletAddress: address,
        walletLabel: label,
        buySignals: 0,
        positions: [],
      };
      wallets.set(id, entry);
    }
    return entry;
  };
  for (const signal of signals) {
    walletEntry(signal.walletId, signal.walletAddress, signal.walletLabel).buySignals++;
  }
  for (const p of closedPositions) {
    walletEntry(p.walletId, p.walletAddress, p.walletLabel).positions.push(p);
  }

  const perWallet = [...wallets.values()]
    .map((w): WalletReport => ({
      walletId: w.walletId,
      walletAddress: w.walletAddress,
      walletLabel: w.walletLabel,
      buySignals: w.buySignals,
      positions: w.positions.length,
      realizedPnlLamports: w.positions.reduce((sum, p) => sum + p.realizedPnlLamports, 0n),
      winRate: winRate(w.positions),
      decomposition: sumDecompositions(w.positions),
    }))
    .sort((a, b) =>
      a.realizedPnlLamports < b.realizedPnlLamports
        ? -1
        : a.realizedPnlLamports > b.realizedPnlLamports
          ? 1
          : 0,
    );

  const perExitReason = CLOSE_REASONS.map((reason) => {
    const matching = closedPositions.filter((p) => p.closeReason === reason);
    return {
      reason,
      count: matching.length,
      realizedPnlLamports: matching.reduce((sum, p) => sum + p.realizedPnlLamports, 0n),
    };
  }).filter((row) => row.count > 0);

  let best: ReportPosition | null = null;
  let worst: ReportPosition | null = null;
  for (const p of closedPositions) {
    if (best === null || p.realizedPnlLamports > best.realizedPnlLamports) {
      best = p;
    }
    if (worst === null || p.realizedPnlLamports < worst.realizedPnlLamports) {
      worst = p;
    }
  }

  return {
    totals: periodTotals(input.trades, closedPositions, signals),
    positions: closedPositions.length,
    winRate: winRate(closedPositions),
    perWallet,
    decomposition: sumDecompositions(closedPositions),
    perExitReason,
    rejectedByReason: countRejections(signals),
    best,
    worst,
  };
}
