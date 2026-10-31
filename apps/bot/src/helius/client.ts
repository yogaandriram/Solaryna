import { Secret } from '@solaryna/config';
import { z } from 'zod';

// Endpoints per https://www.helius.dev/docs/api-reference/webhooks (checked 2026-10-31):
// GET/PUT {base}/{webhookID}?api-key=…; RPC methods (getTransaction, DAS getAsset) on the RPC URL.
const WEBHOOK_API_BASE = 'https://mainnet.helius-rpc.com/v0/webhooks';
const DEFAULT_TIMEOUT_MS = 8_000;

/** Failure talking to Helius. Never contains the API key or a full URL. */
export class HeliusApiError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number | null,
    detail: string,
  ) {
    super(`Helius ${operation} failed${status === null ? '' : ` (HTTP ${status})`}: ${detail}`);
    this.name = 'HeliusApiError';
  }
}

const webhookSchema = z.object({
  webhookID: z.string(),
  webhookURL: z.string(),
  webhookType: z.string(),
  accountAddresses: z.array(z.string()).default([]),
  transactionTypes: z.array(z.string()).default([]),
  authHeader: z.string().nullish(),
  txnStatus: z.string().nullish(),
  encoding: z.string().nullish(),
});

export interface HeliusWebhook {
  id: string;
  url: string;
  type: string;
  accountAddresses: string[];
  transactionTypes: string[];
  authHeader: Secret | null;
  txnStatus: string | null;
  encoding: string | null;
}

const rpcResponseSchema = z.object({
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

const assetSchema = z.object({
  content: z
    .object({
      metadata: z.object({ name: z.string().nullish(), symbol: z.string().nullish() }).nullish(),
    })
    .nullish(),
  token_info: z.object({ symbol: z.string().nullish() }).nullish(),
});

export interface AssetMetadata {
  name: string | null;
  symbol: string | null;
}

export interface HeliusClient {
  getWebhook(webhookId: string): Promise<HeliusWebhook>;
  /** Replaces the webhook config. Sends every field so nothing is reset by omission. */
  updateWebhook(
    webhook: HeliusWebhook,
    changes: { accountAddresses: string[]; authHeader: Secret },
  ): Promise<void>;
  /** Raw `getTransaction` result ("json" encoding), or null if not available yet. */
  getTransaction(signature: string): Promise<unknown>;
  /** Token name/symbol via DAS getAsset; null when Helius has no such asset. */
  getAsset(mint: string): Promise<AssetMetadata | null>;
}

export interface HeliusClientOptions {
  apiKey: Secret;
  rpcUrl: Secret;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createHeliusClient(options: HeliusClientOptions): HeliusClient {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function requestJson(operation: string, url: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const detail =
        error instanceof Error && error.name === 'TimeoutError'
          ? `timed out after ${timeoutMs} ms`
          : 'network error';
      throw new HeliusApiError(operation, null, detail);
    }
    if (!response.ok) {
      throw new HeliusApiError(operation, response.status, response.statusText || 'request failed');
    }
    try {
      return await response.json();
    } catch {
      throw new HeliusApiError(operation, response.status, 'response is not valid JSON');
    }
  }

  function webhookUrl(webhookId: string): string {
    const url = new URL(`${WEBHOOK_API_BASE}/${encodeURIComponent(webhookId)}`);
    url.searchParams.set('api-key', options.apiKey.reveal());
    return url.toString();
  }

  async function rpc(
    method: string,
    params: unknown,
  ): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
    const body = await requestJson(method, options.rpcUrl.reveal(), {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 'solaryna', method, params }),
    });
    const parsed = rpcResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new HeliusApiError(method, null, 'unexpected JSON-RPC response shape');
    }
    return parsed.data;
  }

  return {
    async getWebhook(webhookId) {
      const body = await requestJson('getWebhook', webhookUrl(webhookId), { method: 'GET' });
      const parsed = webhookSchema.safeParse(body);
      if (!parsed.success) {
        throw new HeliusApiError('getWebhook', null, 'unexpected webhook response shape');
      }
      const webhook = parsed.data;
      return {
        id: webhook.webhookID,
        url: webhook.webhookURL,
        type: webhook.webhookType,
        accountAddresses: webhook.accountAddresses,
        transactionTypes: webhook.transactionTypes,
        authHeader: webhook.authHeader ? new Secret(webhook.authHeader) : null,
        txnStatus: webhook.txnStatus ?? null,
        encoding: webhook.encoding ?? null,
      };
    },

    async updateWebhook(webhook, changes) {
      const body = {
        webhookURL: webhook.url,
        webhookType: webhook.type,
        transactionTypes: webhook.transactionTypes,
        accountAddresses: changes.accountAddresses,
        authHeader: changes.authHeader.reveal(),
        ...(webhook.txnStatus === null ? {} : { txnStatus: webhook.txnStatus }),
        ...(webhook.encoding === null ? {} : { encoding: webhook.encoding }),
      };
      await requestJson('updateWebhook', webhookUrl(webhook.id), {
        method: 'PUT',
        body: JSON.stringify(body),
      });
    },

    async getTransaction(signature) {
      const response = await rpc('getTransaction', [
        signature,
        { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
      ]);
      if (response.error) {
        throw new HeliusApiError('getTransaction', null, `RPC error ${response.error.code}`);
      }
      return response.result ?? null;
    },

    async getAsset(mint) {
      const response = await rpc('getAsset', { id: mint });
      if (response.error) {
        // DAS answers unknown assets with a JSON-RPC error rather than an HTTP error.
        return null;
      }
      const parsed = assetSchema.safeParse(response.result);
      if (!parsed.success) {
        return null;
      }
      const metadata = parsed.data.content?.metadata;
      return {
        name: metadata?.name ?? null,
        symbol: metadata?.symbol ?? parsed.data.token_info?.symbol ?? null,
      };
    },
  };
}
