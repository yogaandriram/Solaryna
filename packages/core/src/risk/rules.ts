import type { LocalRiskInput, MarketRiskInput, RiskReason, RiskResult } from './types';

function result(reasons: RiskReason[]): RiskResult {
  return { decision: reasons.length === 0 ? 'accepted' : 'rejected', reasons };
}

/** Database-only buy rules. Every failing rule is reported, not just the first. */
export function evaluateLocalRisk(input: LocalRiskInput): RiskResult {
  const { limits } = input;
  const reasons: RiskReason[] = [];
  if (input.tradingPaused) {
    reasons.push({ code: 'trading_paused' });
  }
  if (input.openPositionCount >= limits.maxOpenPositions) {
    reasons.push({
      code: 'max_open_positions',
      detail: { open: input.openPositionCount, max: limits.maxOpenPositions },
    });
  }
  if (input.holdingToken) {
    reasons.push({ code: 'already_holding' });
  }
  if (input.realizedPnlTodayLamports <= -limits.dailyLossLimitLamports) {
    reasons.push({
      code: 'daily_loss_limit',
      detail: {
        realizedLamports: input.realizedPnlTodayLamports.toString(),
        limitLamports: limits.dailyLossLimitLamports.toString(),
      },
    });
  }
  if (input.tokenBlacklisted) {
    reasons.push({ code: 'token_blacklisted' });
  }
  if (input.walletCooldownUntil !== null && input.walletCooldownUntil > input.now) {
    reasons.push({
      code: 'wallet_cooldown',
      detail: { until: input.walletCooldownUntil.toISOString() },
    });
  }
  const ageMs = input.now.getTime() - input.signalBlockTime.getTime();
  if (ageMs > limits.maxSignalAgeSeconds * 1000) {
    reasons.push({
      code: 'signal_too_old',
      detail: { ageSeconds: Math.floor(ageMs / 1000), maxSeconds: limits.maxSignalAgeSeconds },
    });
  }
  return result(reasons);
}

/** Buy rules that need Jupiter token data and the (single) buy quote. */
export function evaluateMarketRisk(input: MarketRiskInput): RiskResult {
  const { limits, token, quote } = input;
  const reasons: RiskReason[] = [];
  if (token === null) {
    reasons.push({ code: 'token_data_unavailable' });
  } else {
    if (token.liquidityUsd === null || token.liquidityUsd.lt(limits.minLiquidityUsd)) {
      reasons.push({
        code: 'liquidity_below_min',
        detail: {
          actual: token.liquidityUsd?.toString() ?? null,
          min: limits.minLiquidityUsd.toString(),
        },
      });
    }
    if (token.mintAuthorityActive) {
      reasons.push({ code: 'mint_authority_active' });
    }
    if (token.freezeAuthorityActive) {
      reasons.push({ code: 'freeze_authority_active' });
    }
    if (token.suspicious) {
      reasons.push({ code: 'token_flagged_suspicious' });
    }
  }
  if (quote === null) {
    reasons.push({ code: 'no_route' });
  } else {
    // priceImpact is in percentage points; MAX_SLIPPAGE_BPS / 100 converts bps to the same unit.
    const maxPct = limits.maxSlippageBps / 100;
    if (quote.priceImpactPct.abs().gt(maxPct)) {
      reasons.push({
        code: 'price_impact_too_high',
        detail: { actualPct: quote.priceImpactPct.toString(), maxPct: String(maxPct) },
      });
    }
  }
  return result(reasons);
}
