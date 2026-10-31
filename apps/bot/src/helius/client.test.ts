import { Secret } from '@solaryna/config';
import { describe, expect, it, vi } from 'vitest';
import { HeliusApiError, createHeliusClient } from './client';

const API_KEY = 'fake-helius-api-key';
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${API_KEY}`;

function clientWith(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, init: init ?? {} });
    return Promise.resolve(respond(url, init ?? {}));
  });
  const client = createHeliusClient({
    apiKey: new Secret(API_KEY),
    rpcUrl: new Secret(RPC_URL),
    fetch: fetchMock,
  });
  return { client, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const webhookBody = {
  webhookID: 'wh-1',
  wallet: 'owner',
  webhookURL: 'https://bot.example.test/webhooks/helius',
  webhookType: 'raw',
  accountAddresses: ['A'],
  transactionTypes: ['ANY'],
  authHeader: 'current-secret-value',
  txnStatus: 'all',
};

describe('createHeliusClient', () => {
  it('reads a webhook and keeps its auth header wrapped', async () => {
    const { client, calls } = clientWith(() => json(webhookBody));
    const webhook = await client.getWebhook('wh-1');
    expect(calls[0]?.url).toBe(
      `https://mainnet.helius-rpc.com/v0/webhooks/wh-1?api-key=${API_KEY}`,
    );
    expect(webhook).toMatchObject({ id: 'wh-1', type: 'raw', accountAddresses: ['A'] });
    expect(webhook.authHeader?.reveal()).toBe('current-secret-value');
    expect(JSON.stringify(webhook)).not.toContain('current-secret-value');
  });

  it('updates a webhook with the full config so other fields are preserved', async () => {
    const { client, calls } = clientWith(() => json(webhookBody));
    const webhook = await client.getWebhook('wh-1');
    await client.updateWebhook(webhook, {
      accountAddresses: ['A', 'B'],
      authHeader: new Secret('new-secret-value'),
    });
    const update = calls[1];
    expect(update?.init.method).toBe('PUT');
    expect(JSON.parse(update?.init.body as string)).toEqual({
      webhookURL: webhookBody.webhookURL,
      webhookType: 'raw',
      transactionTypes: ['ANY'],
      accountAddresses: ['A', 'B'],
      authHeader: 'new-secret-value',
      txnStatus: 'all',
    });
  });

  it('requests transactions as JSON with v1 support', async () => {
    const { client, calls } = clientWith(() => json({ jsonrpc: '2.0', id: 'x', result: null }));
    expect(await client.getTransaction('sig')).toBeNull();
    expect(calls[0]?.url).toBe(RPC_URL);
    expect(JSON.parse(calls[0]?.init.body as string)).toMatchObject({
      method: 'getTransaction',
      params: [
        'sig',
        { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
      ],
    });
  });

  it('reads token metadata and treats DAS errors as unknown assets', async () => {
    const ok = clientWith(() =>
      json({ result: { content: { metadata: { name: 'Pepe', symbol: 'PEPE' } } } }),
    );
    expect(await ok.client.getAsset('mint')).toEqual({ name: 'Pepe', symbol: 'PEPE' });

    const missing = clientWith(() => json({ error: { code: -32000, message: 'Asset Not Found' } }));
    expect(await missing.client.getAsset('mint')).toBeNull();
  });

  it('raises typed errors without leaking the API key', async () => {
    const { client } = clientWith(() => json({ error: 'nope' }, 401));
    const error = await client.getWebhook('wh-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HeliusApiError);
    expect(error).toMatchObject({ operation: 'getWebhook', status: 401 });
    expect(String(error)).not.toContain(API_KEY);

    const network = clientWith(() => {
      throw new TypeError(`fetch failed for ${RPC_URL}`);
    });
    const networkError = await network.client.getTransaction('sig').catch((e: unknown) => e);
    expect(networkError).toBeInstanceOf(HeliusApiError);
    expect(String(networkError)).not.toContain(API_KEY);
  });

  it('rejects unexpected response shapes', async () => {
    const { client } = clientWith(() => json({ webhooks: [] }));
    await expect(client.getWebhook('wh-1')).rejects.toBeInstanceOf(HeliusApiError);
  });
});
