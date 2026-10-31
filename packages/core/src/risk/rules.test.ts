import { describe, expect, it } from 'vitest';
import { Decimal } from '../decimal';
import { evaluateLocalRisk, evaluateMarketRisk } from './rules';
import type { LocalRiskInput, MarketRiskInput, RiskLimitsInput, TokenMarketData } from './types';

const now = new Date('2026-10-31T05:00:00Z');
const limits: RiskLimitsInput = {
  maxOpenPositions: 5,
  dailyLossLimitLamports: 200_000_000n,
  minLiquidityUsd: new Decimal(20_000),
  maxSlippageBps: 300,
  maxSignalAgeSeconds: 30,
};
const local: LocalRiskInput = {
  limits,
  tradingPaused: false,
  openPositionCount: 0,
  holdingToken: false,
  realizedPnlTodayLamports: 0n,
  tokenBlacklisted: false,
  walletCooldownUntil: null,
  signalBlockTime: new Date(now.getTime() - 10_000),
  now,
};
const token: TokenMarketData = {
  liquidityUsd: new Decimal(50_000),
  mintAuthorityActive: false,
  freezeAuthorityActive: false,
  suspicious: false,
  createdAt: null,
};
const market: MarketRiskInput = { limits, token, quote: { priceImpactPct: new Decimal('1.5') } };

const codes = (result: { reasons: { code: string }[] }) => result.reasons.map((r) => r.code);

describe('evaluateLocalRisk', () => {
  it('accepts when every rule passes', () => {
    expect(evaluateLocalRisk(local)).toEqual({ decision: 'accepted', reasons: [] });
  });

  it('rejects while trading is paused', () => {
    expect(codes(evaluateLocalRisk({ ...local, tradingPaused: true }))).toEqual(['trading_paused']);
  });

  it('rejects when open positions reach the maximum', () => {
    expect(evaluateLocalRisk({ ...local, openPositionCount: 4 }).decision).toBe('accepted');
    expect(evaluateLocalRisk({ ...local, openPositionCount: 5 }).reasons).toEqual([
      { code: 'max_open_positions', detail: { open: 5, max: 5 } },
    ]);
  });

  it('rejects a token that is already held', () => {
    expect(codes(evaluateLocalRisk({ ...local, holdingToken: true }))).toEqual(['already_holding']);
  });

  it('rejects once the realized loss today reaches the daily limit', () => {
    expect(evaluateLocalRisk({ ...local, realizedPnlTodayLamports: -199_999_999n }).decision).toBe(
      'accepted',
    );
    expect(
      evaluateLocalRisk({ ...local, realizedPnlTodayLamports: -200_000_000n }).reasons,
    ).toEqual([
      {
        code: 'daily_loss_limit',
        detail: { realizedLamports: '-200000000', limitLamports: '200000000' },
      },
    ]);
  });

  it('rejects a blacklisted token', () => {
    expect(codes(evaluateLocalRisk({ ...local, tokenBlacklisted: true }))).toEqual([
      'token_blacklisted',
    ]);
  });

  it('rejects a wallet in cooldown until the cooldown ends', () => {
    const until = new Date(now.getTime() + 1);
    expect(evaluateLocalRisk({ ...local, walletCooldownUntil: until }).reasons).toEqual([
      { code: 'wallet_cooldown', detail: { until: until.toISOString() } },
    ]);
    expect(evaluateLocalRisk({ ...local, walletCooldownUntil: now }).decision).toBe('accepted');
  });

  it('rejects a signal older than the maximum age', () => {
    const atLimit = new Date(now.getTime() - 30_000);
    expect(evaluateLocalRisk({ ...local, signalBlockTime: atLimit }).decision).toBe('accepted');
    const tooOld = new Date(now.getTime() - 45_001);
    expect(evaluateLocalRisk({ ...local, signalBlockTime: tooOld }).reasons).toEqual([
      { code: 'signal_too_old', detail: { ageSeconds: 45, maxSeconds: 30 } },
    ]);
    const justOver = new Date(now.getTime() - 30_001);
    expect(codes(evaluateLocalRisk({ ...local, signalBlockTime: justOver }))).toEqual([
      'signal_too_old',
    ]);
  });

  it('collects every failing rule', () => {
    expect(
      codes(
        evaluateLocalRisk({
          ...local,
          tradingPaused: true,
          openPositionCount: 9,
          holdingToken: true,
          tokenBlacklisted: true,
        }),
      ),
    ).toEqual(['trading_paused', 'max_open_positions', 'already_holding', 'token_blacklisted']);
  });
});

describe('evaluateMarketRisk', () => {
  it('accepts a liquid, clean token with a low-impact quote', () => {
    expect(evaluateMarketRisk(market)).toEqual({ decision: 'accepted', reasons: [] });
  });

  it('rejects when token data is unavailable', () => {
    expect(codes(evaluateMarketRisk({ ...market, token: null }))).toEqual([
      'token_data_unavailable',
    ]);
  });

  it('rejects liquidity below the minimum, including unknown liquidity', () => {
    const at = (liquidityUsd: Decimal | null) =>
      evaluateMarketRisk({ ...market, token: { ...token, liquidityUsd } });
    expect(at(new Decimal(20_000)).decision).toBe('accepted');
    expect(at(new Decimal(12_300)).reasons).toEqual([
      { code: 'liquidity_below_min', detail: { actual: '12300', min: '20000' } },
    ]);
    expect(at(null).reasons).toEqual([
      { code: 'liquidity_below_min', detail: { actual: null, min: '20000' } },
    ]);
  });

  it('rejects active mint or freeze authority and suspicious tokens', () => {
    expect(
      codes(
        evaluateMarketRisk({
          ...market,
          token: {
            ...token,
            mintAuthorityActive: true,
            freezeAuthorityActive: true,
            suspicious: true,
          },
        }),
      ),
    ).toEqual(['mint_authority_active', 'freeze_authority_active', 'token_flagged_suspicious']);
  });

  it('rejects when there is no route', () => {
    expect(codes(evaluateMarketRisk({ ...market, quote: null }))).toEqual(['no_route']);
  });

  it('rejects a price impact above the slippage limit in either direction', () => {
    const impact = (pct: string) =>
      evaluateMarketRisk({ ...market, quote: { priceImpactPct: new Decimal(pct) } });
    expect(impact('3').decision).toBe('accepted');
    expect(impact('-3.01').reasons).toEqual([
      { code: 'price_impact_too_high', detail: { actualPct: '-3.01', maxPct: '3' } },
    ]);
  });
});
