import { createHash, timingSafeEqual } from 'node:crypto';
import type { Secret } from '@solaryna/config';
import { rawTransactionSchema, type RawTransaction } from '@solaryna/core';
import Fastify, { LogController } from 'fastify';
import type { Logger } from 'pino';

export const HELIUS_WEBHOOK_PATH = '/webhooks/helius';

export interface WebhookServerOptions {
  /** Must equal the authHeader configured on the Helius webhook. */
  secret: Secret;
  logger: Logger;
  /** Persists the transactions. Helius expects a reply within ~1 s, so keep slow work async. */
  onTransactions(transactions: RawTransaction[]): Promise<unknown>;
  bodyLimitBytes?: number;
}

/** Constant-time comparison (hashing first makes the lengths equal). */
function matchesSecret(header: string | undefined, secret: Secret): boolean {
  if (header === undefined) {
    return false;
  }
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header), digest(secret.reveal()));
}

function signatureOf(item: unknown): string | undefined {
  if (typeof item === 'object' && item !== null && 'transaction' in item) {
    const { transaction } = item as { transaction?: { signatures?: unknown } };
    const first: unknown = Array.isArray(transaction?.signatures)
      ? transaction.signatures[0]
      : undefined;
    return typeof first === 'string' ? first.slice(0, 100) : undefined;
  }
  return undefined;
}

export function buildWebhookServer(options: WebhookServerOptions) {
  const app = Fastify({
    loggerInstance: options.logger,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: options.bodyLimitBytes ?? 20 * 1024 * 1024,
  });

  app.get('/healthz', () => ({ status: 'ok' }));

  app.post(HELIUS_WEBHOOK_PATH, async (request, reply) => {
    if (!matchesSecret(request.headers.authorization, options.secret)) {
      request.log.warn({ ip: request.ip }, 'Rejected webhook with an invalid Authorization header');
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const body: unknown = request.body;
    if (!Array.isArray(body)) {
      return reply.code(400).send({ error: 'expected an array of transactions' });
    }

    const transactions: RawTransaction[] = [];
    let invalid = 0;
    for (const item of body) {
      const parsed = rawTransactionSchema.safeParse(item);
      if (parsed.success) {
        transactions.push(parsed.data);
      } else {
        invalid++;
        request.log.warn(
          {
            signature: signatureOf(item),
            issues: parsed.error.issues
              .slice(0, 3)
              .map((issue) => `${issue.path.join('.')}: ${issue.message}`),
          },
          'Skipping webhook item that is not a raw transaction',
        );
      }
    }

    // A throw here becomes a 5xx, so Helius redelivers; dedupe makes that safe.
    await options.onTransactions(transactions);
    return reply.code(200).send({ accepted: transactions.length, invalid });
  });

  return app;
}
