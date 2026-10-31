import { Secret } from '@solaryna/config';
import { WSOL_MINT } from '@solaryna/core';
import { describe, expect, it, vi } from 'vitest';
import { JupiterApiError, createJupiterClient } from './client';
import {
  RequestExpiredError,
  createRateLimiter,
  type RateLimiter,
  type RequestPriority,
} from './rate-limiter';

const API_KEY = 'fake-jupiter-api-key';
const MINT = 'AbrEhdN9Zsb5AvE5Pubd9VkUUr6ufAHfZ9zo7KAppump';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const orderBody = {
  mode: 'manual',
  inputMint: WSOL_MINT,
  outputMint: MINT,
  inAmount: '50000000',
  outAmount: '1129709550122',
  otherAmountThreshold: '1095818263618',
  priceImpact: -0.42,
  slippageBps: 300,
  feeBps: 10,
  platformFee: { amount: '50000', feeBps: 10, feeMint: WSOL_MINT },
  inUsdValue: 9.25,
  outUsdValue: 9.1,
  router: 'metis',
  routePlan: [{ percent: 100 }],
  signatureFeeLamports: 5000,
  prioritizationFeeLamports: 0,
  rentFeeLamports: 2039280,
  transaction: null,
};

function setup(respond: (url: string) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit; priority: RequestPriority }[] = [];
  let currentPriority: RequestPriority = 'monitor';
  const pauseUntil = vi.fn();
  const expiries: (number | undefined)[] = [];
  const limiter: RateLimiter = {
    schedule: (priority, task, options) => {
      currentPriority = priority;
      expiries.push(options?.expiresAt);
      return task();
    },
    pauseUntil,
    pending: 0,
  };
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, init: init ?? {}, priority: currentPriority });
    return Promise.resolve(respond(url));
  });
  const client = createJupiterClient({
    apiKey: new Secret(API_KEY),
    limiter,
    fetch: fetchMock,
    now: () => 1_000_000,
  });
  return { client, calls, pauseUntil, expiries };
}

const orderParams = {
  inputMint: WSOL_MINT,
  outputMint: MINT,
  amountRaw: 50_000_000n,
  slippageBps: 300,
};

describe('createJupiterClient.getOrder', () => {
  it('requests a quote without a taker and parses amounts as bigint', async () => {
    const { client, calls } = setup(() => json(orderBody));
    const order = await client.getOrder(orderParams, 'buy');

    const url = new URL(calls[0]?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.jup.ag/swap/v2/order');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      inputMint: WSOL_MINT,
      outputMint: MINT,
      amount: '50000000',
      slippageBps: '300',
    });
    expect(new Headers(calls[0]?.init.headers).get('x-api-key')).toBe(API_KEY);
    expect(calls[0]?.priority).toBe('buy');

    expect(order).toMatchObject({
      inAmountRaw: 50_000_000n,
      outAmountRaw: 1_129_709_550_122n,
      minOutAmountRaw: 1_095_818_263_618n,
      slippageBps: 300,
      feeBps: 10,
      platformFee: { amountRaw: 50_000n, mint: WSOL_MINT },
      router: 'metis',
    });
    expect(order?.priceImpactPct.toString()).toBe('-0.42');
    expect(order?.inUsdValue?.toString()).toBe('9.25');
    expect(order?.snapshot).toEqual(orderBody);
  });

  it('passes an expiry to the limiter', async () => {
    const { client, expiries } = setup((url) =>
      url.includes('/tokens/') ? json([]) : json(orderBody),
    );
    await client.getOrder(orderParams, 'buy', { expiresAt: 123 });
    await client.getToken(MINT, 'buy', { expiresAt: 456 });
    expect(expiries).toEqual([123, 456]);
  });

  it('pauses the limiter until x-ratelimit-reset on 429 and retries', async () => {
    let attempt = 0;
    const { client, pauseUntil } = setup(() =>
      attempt++ === 0
        ? json({ error: 'Too many requests' }, 429, { 'x-ratelimit-reset': '1005' })
        : json(orderBody),
    );
    expect((await client.getOrder(orderParams, 'exit'))?.outAmountRaw).toBe(1_129_709_550_122n);
    expect(pauseUntil).toHaveBeenCalledWith(1_005_000);
  });

  it('keeps the rate-limit pause between one and sixty seconds', async () => {
    for (const [reset, expected] of [
      ['99999999999', 1_060_000],
      ['900', 1_001_000],
    ] as const) {
      let attempt = 0;
      const { client, pauseUntil } = setup(() =>
        attempt++ === 0 ? json({}, 429, { 'x-ratelimit-reset': reset }) : json(orderBody),
      );
      await client.getOrder(orderParams, 'exit');
      expect(pauseUntil).toHaveBeenCalledWith(expected);
    }
  });

  it('lets a request that expired in the real limiter queue surface as RequestExpiredError', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(orderBody)));
    const client = createJupiterClient({
      apiKey: new Secret(API_KEY),
      limiter: createRateLimiter({ now: () => 1_000_000 }),
      fetch: fetchMock,
      now: () => 1_000_000,
    });
    const error = await client
      .getOrder(orderParams, 'buy', { expiresAt: 999_000 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RequestExpiredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives up after repeated 429s with a typed error', async () => {
    const { client, pauseUntil } = setup(() => json({}, 429));
    const error = await client.getOrder(orderParams, 'exit').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JupiterApiError);
    expect(error).toMatchObject({ operation: 'getOrder', status: 429 });
    // Without the header, wait one second.
    expect(pauseUntil).toHaveBeenCalledWith(1_001_000);
  });

  it('returns null when Jupiter has no route', async () => {
    const noRoute = setup(() => json({ requestId: 'r', error: 'No routes found' }, 400));
    expect(await noRoute.client.getOrder(orderParams, 'monitor')).toBeNull();
    const zeroOut = setup(() => json({ ...orderBody, outAmount: '0' }));
    expect(await zeroOut.client.getOrder(orderParams, 'monitor')).toBeNull();
    const emptyRoute = setup(() => json({ ...orderBody, routePlan: [] }));
    expect(await emptyRoute.client.getOrder(orderParams, 'monitor')).toBeNull();
  });

  it('raises other 400s and bad shapes without leaking the API key', async () => {
    const bad = setup(() => json({ requestId: 'r', error: 'Invalid outputMint' }, 400));
    const error = await bad.client.getOrder(orderParams, 'buy').catch((e: unknown) => e);
    expect(error).toMatchObject({ operation: 'getOrder', status: 400 });
    expect(String(error)).toContain('Invalid outputMint');
    expect(String(error)).not.toContain(API_KEY);

    const shape = setup(() => json({ outAmount: 12 }));
    await expect(shape.client.getOrder(orderParams, 'buy')).rejects.toBeInstanceOf(JupiterApiError);

    const network = setup(() => {
      throw new TypeError(`fetch failed with key ${API_KEY}`);
    });
    const networkError = await network.client.getOrder(orderParams, 'buy').catch((e: unknown) => e);
    expect(networkError).toMatchObject({ operation: 'getOrder', status: null });
    expect(String(networkError)).not.toContain(API_KEY);
  });
});

describe('createJupiterClient.getToken', () => {
  const token = {
    id: MINT,
    decimals: 6,
    liquidity: 48210.5,
    usdPrice: 0.0000123,
    mintAuthority: null,
    freezeAuthority: null,
    createdAt: '2026-10-30T10:00:00Z',
    firstPool: { id: 'pool', createdAt: '2026-10-30T10:05:00Z' },
    audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true },
  };

  it('searches by mint and maps market data', async () => {
    const { client, calls } = setup(() => json([token]));
    const result = await client.getToken(MINT, 'buy');
    expect(calls[0]?.url).toBe(`https://api.jup.ag/tokens/v2/search?query=${MINT}`);
    expect(result?.decimals).toBe(6);
    expect(result?.market).toEqual({
      liquidityUsd: expect.anything() as unknown,
      mintAuthorityActive: false,
      freezeAuthorityActive: false,
      suspicious: false,
      createdAt: new Date('2026-10-30T10:00:00Z'),
    });
    expect(result?.market.liquidityUsd?.toString()).toBe('48210.5');
    expect(result?.usdPrice?.toString()).toBe('0.0000123');
  });

  it('flags active authorities and suspicious tokens', async () => {
    const { client } = setup(() =>
      json([
        {
          ...token,
          liquidity: null,
          mintAuthority: 'Auth1111111111111111111111111111111111111111',
          createdAt: undefined,
          audit: { isSus: true, freezeAuthorityDisabled: false },
        },
      ]),
    );
    expect((await client.getToken(MINT, 'buy'))?.market).toEqual({
      liquidityUsd: null,
      mintAuthorityActive: true,
      freezeAuthorityActive: true,
      suspicious: true,
      createdAt: new Date('2026-10-30T10:05:00Z'),
    });
  });

  it('returns null when the mint is not found', async () => {
    const empty = setup(() => json([]));
    expect(await empty.client.getToken(MINT, 'buy')).toBeNull();
    const other = setup(() => json([{ ...token, id: 'Other' }]));
    expect(await other.client.getToken(MINT, 'buy')).toBeNull();
  });
});
