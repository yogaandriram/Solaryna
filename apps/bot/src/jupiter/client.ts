import type { Secret } from '@solaryna/config';
import { Decimal, type TokenMarketData } from '@solaryna/core';
import { z } from 'zod';
import {
  RequestExpiredError,
  type RateLimiter,
  type RequestPriority,
  type ScheduleOptions,
} from './rate-limiter';

// Jupiter Swap API v2 (quote only: no `taker`, so no transaction is built) and Tokens API v2.
// Checked against developers.jup.ag on 2026-10-31: header `x-api-key`; `priceImpact` is in
// percentage points; 429 carries `x-ratelimit-reset` as a Unix time in seconds; errors are
// `400 { requestId, error }`. A missing route is not documented, see NO_ROUTE_PATTERN.

export class JupiterApiError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number | null,
    detail: string,
  ) {
    super(`Jupiter ${operation} failed${status === null ? '' : ` (HTTP ${status})`}: ${detail}`);
    this.name = 'JupiterApiError';
  }
}

export interface JupiterOrder {
  inAmountRaw: bigint;
  outAmountRaw: bigint;
  /** Minimum output after slippage (`otherAmountThreshold`). */
  minOutAmountRaw: bigint;
  /** In percentage points: -0.42 means -0.42 %. */
  priceImpactPct: Decimal;
  slippageBps: number;
  feeBps: number;
  platformFee: { amountRaw: bigint; mint: string } | null;
  inUsdValue: Decimal | null;
  outUsdValue: Decimal | null;
  router: string;
  /** The response as received, stored with the trade. */
  snapshot: unknown;
}

export interface JupiterToken {
  mint: string;
  decimals: number;
  market: TokenMarketData;
  usdPrice: Decimal | null;
}

export interface JupiterClient {
  /** A quote, or null when Jupiter has no route. */
  getOrder(
    params: { inputMint: string; outputMint: string; amountRaw: bigint; slippageBps: number },
    priority: RequestPriority,
    options?: ScheduleOptions,
  ): Promise<JupiterOrder | null>;
  /** Market data for a mint, or null when Jupiter does not know it. */
  getToken(
    mint: string,
    priority: RequestPriority,
    options?: ScheduleOptions,
  ): Promise<JupiterToken | null>;
}

export interface JupiterClientOptions {
  apiKey: Secret;
  limiter: RateLimiter;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  now?: () => number;
}

/** Retries after a 429, each through the limiter again. */
const MAX_RATE_LIMIT_RETRIES = 2;
const MIN_RATE_LIMIT_PAUSE_MS = 1000;
const MAX_RATE_LIMIT_PAUSE_MS = 60_000;

/**
 * The no-route response is undocumented; without a `taker` Jupiter answers 400 with a message.
 * Other 400s (bad parameters) still raise, so a bug is not mistaken for an unsellable token.
 */
const NO_ROUTE_PATTERN = /no route|routes? not found|could not find any route|no liquidity/i;

const rawAmount = z.string().regex(/^\d+$/);
const nullableNumber = z.number().nullish();

const orderSchema = z
  .object({
    inAmount: rawAmount,
    outAmount: rawAmount,
    otherAmountThreshold: rawAmount,
    priceImpact: z.number().optional(),
    /** Deprecated decimal ratio; only used when `priceImpact` is missing. */
    priceImpactPct: z.string().optional(),
    slippageBps: z.number().int(),
    feeBps: z.number().optional(),
    platformFee: z
      .object({
        amount: rawAmount.optional(),
        feeBps: z.number().optional(),
        feeMint: z.string().optional(),
      })
      .nullish(),
    inUsdValue: nullableNumber,
    outUsdValue: nullableNumber,
    router: z.string().optional(),
    swapType: z.string().optional(),
    routePlan: z.array(z.unknown()).optional(),
  })
  .refine((body) => body.priceImpact !== undefined || body.priceImpactPct !== undefined, {
    error: 'price impact missing',
  });

const tokenSchema = z.object({
  id: z.string(),
  decimals: z.number().int().min(0).max(255),
  liquidity: nullableNumber,
  usdPrice: nullableNumber,
  mintAuthority: z.string().nullish(),
  freezeAuthority: z.string().nullish(),
  createdAt: z.string().nullish(),
  firstPool: z.object({ createdAt: z.string().nullish() }).nullish(),
  audit: z
    .object({
      isSus: z.boolean().nullish(),
      mintAuthorityDisabled: z.boolean().nullish(),
      freezeAuthorityDisabled: z.boolean().nullish(),
    })
    .nullish(),
});

const errorBodySchema = z.object({ error: z.string() });

/**
 * The platform fee of an order. Jupiter may leave out its amount (seen 2026-10-31); it then
 * deducts `feeBps` from the output, so `outAmount` is net of the fee and the fee in the output
 * mint is outAmount × bps / (10000 − bps), whatever `feeMint` says.
 */
function platformFeeOf(
  order: z.infer<typeof orderSchema>,
  outputMint: string,
): JupiterOrder['platformFee'] {
  const fee = order.platformFee;
  if (fee === null || fee === undefined) {
    return null;
  }
  if (fee.amount !== undefined && fee.feeMint !== undefined) {
    return { amountRaw: BigInt(fee.amount), mint: fee.feeMint };
  }
  const bps = fee.feeBps ?? order.feeBps;
  if (bps === undefined || !Number.isInteger(bps) || bps <= 0 || bps >= 10_000) {
    return null;
  }
  return {
    amountRaw: (BigInt(order.outAmount) * BigInt(bps)) / BigInt(10_000 - bps),
    mint: outputMint,
  };
}

const toDecimal = (value: number | null | undefined) =>
  value === null || value === undefined ? null : new Decimal(value);

function toDate(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function createJupiterClient(options: JupiterClientOptions): JupiterClient {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? 'https://api.jup.ag';
  const timeoutMs = options.timeoutMs ?? 10_000;
  const now = options.now ?? Date.now;

  /** GET a JSON body; `{ noRoute: true }` for a no-route 400. */
  async function getJson(
    operation: string,
    url: string,
    priority: RequestPriority,
    scheduleOptions: ScheduleOptions | undefined,
  ): Promise<{ body: unknown } | { noRoute: true }> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await options.limiter.schedule(
          priority,
          () =>
            fetchImpl(url, {
              headers: { 'x-api-key': options.apiKey.reveal() },
              signal: AbortSignal.timeout(timeoutMs),
            }),
          scheduleOptions,
        );
      } catch (error) {
        // Dropped by the limiter before it was sent: the caller treats this as a stale signal.
        if (error instanceof RequestExpiredError) {
          throw error;
        }
        const detail =
          error instanceof Error && error.name === 'TimeoutError'
            ? `timed out after ${timeoutMs} ms`
            : 'network error';
        throw new JupiterApiError(operation, null, detail);
      }

      if (response.status === 429) {
        // Unix seconds per the docs; clamped so clock skew or a bad header cannot stall exits.
        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
        const at = now();
        options.limiter.pauseUntil(
          Number.isFinite(reset)
            ? Math.min(Math.max(reset, at + MIN_RATE_LIMIT_PAUSE_MS), at + MAX_RATE_LIMIT_PAUSE_MS)
            : at + MIN_RATE_LIMIT_PAUSE_MS,
        );
        if (attempt < MAX_RATE_LIMIT_RETRIES) {
          continue;
        }
        throw new JupiterApiError(operation, 429, 'rate limited');
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new JupiterApiError(operation, response.status, 'response is not JSON');
      }
      if (!response.ok) {
        const message = errorBodySchema.safeParse(body).data?.error.slice(0, 200) ?? 'no message';
        if (response.status === 400 && NO_ROUTE_PATTERN.test(message)) {
          return { noRoute: true };
        }
        throw new JupiterApiError(operation, response.status, message);
      }
      return { body };
    }
  }

  return {
    async getOrder(params, priority, scheduleOptions) {
      const query = new URLSearchParams({
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: params.amountRaw.toString(),
        slippageBps: String(params.slippageBps),
      });
      const result = await getJson(
        'getOrder',
        `${baseUrl}/swap/v2/order?${query.toString()}`,
        priority,
        scheduleOptions,
      );
      if ('noRoute' in result) {
        return null;
      }
      const parsed = orderSchema.safeParse(result.body);
      if (!parsed.success) {
        throw new JupiterApiError('getOrder', 200, 'unexpected response shape');
      }
      const order = parsed.data;
      if (order.outAmount === '0' || order.routePlan?.length === 0) {
        return null;
      }
      return {
        inAmountRaw: BigInt(order.inAmount),
        outAmountRaw: BigInt(order.outAmount),
        minOutAmountRaw: BigInt(order.otherAmountThreshold),
        priceImpactPct:
          order.priceImpact !== undefined
            ? new Decimal(order.priceImpact)
            : new Decimal(order.priceImpactPct ?? '0').mul(100),
        slippageBps: order.slippageBps,
        feeBps: order.feeBps ?? 0,
        platformFee: platformFeeOf(order, params.outputMint),
        inUsdValue: toDecimal(order.inUsdValue),
        outUsdValue: toDecimal(order.outUsdValue),
        router: order.router ?? order.swapType ?? 'unknown',
        snapshot: result.body,
      };
    },

    async getToken(mint, priority, scheduleOptions) {
      const url = `${baseUrl}/tokens/v2/search?query=${encodeURIComponent(mint)}`;
      const result = await getJson('getToken', url, priority, scheduleOptions);
      if ('noRoute' in result) {
        return null;
      }
      const parsed = z.array(z.unknown()).safeParse(result.body);
      if (!parsed.success) {
        throw new JupiterApiError('getToken', 200, 'unexpected response shape');
      }
      const match = parsed.data.find(
        (item) => typeof item === 'object' && item !== null && 'id' in item && item.id === mint,
      );
      if (match === undefined) {
        return null;
      }
      const token = tokenSchema.safeParse(match);
      if (!token.success) {
        throw new JupiterApiError('getToken', 200, 'unexpected token shape');
      }
      const { audit } = token.data;
      return {
        mint,
        decimals: token.data.decimals,
        // The authority fields are present only while the authority is not revoked.
        market: {
          liquidityUsd: toDecimal(token.data.liquidity),
          mintAuthorityActive:
            (token.data.mintAuthority ?? null) !== null || audit?.mintAuthorityDisabled === false,
          freezeAuthorityActive:
            (token.data.freezeAuthority ?? null) !== null ||
            audit?.freezeAuthorityDisabled === false,
          suspicious: audit?.isSus === true,
          createdAt: toDate(token.data.createdAt) ?? toDate(token.data.firstPool?.createdAt),
        },
        usdPrice: toDecimal(token.data.usdPrice),
      };
    },
  };
}
