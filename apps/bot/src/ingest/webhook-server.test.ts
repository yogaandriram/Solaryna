import { Secret } from '@solaryna/config';
import type { RawTransaction } from '@solaryna/core';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { loadFixture } from './test-fixtures';
import { HELIUS_WEBHOOK_PATH, buildWebhookServer } from './webhook-server';

const SECRET = 'webhook-secret-for-tests';

function server(onTransactions = vi.fn((_txs: RawTransaction[]) => Promise.resolve())) {
  const app = buildWebhookServer({
    secret: new Secret(SECRET),
    logger: pino({ level: 'silent' }),
    onTransactions,
  });
  return { app, onTransactions };
}

const post = (app: ReturnType<typeof server>['app'], payload: unknown, authorization?: string) =>
  app.inject({
    method: 'POST',
    url: HELIUS_WEBHOOK_PATH,
    payload: payload as object,
    headers: authorization === undefined ? {} : { authorization },
  });

describe('buildWebhookServer', () => {
  it('rejects requests without the shared secret', async () => {
    const { app, onTransactions } = server();
    expect((await post(app, [], undefined)).statusCode).toBe(401);
    expect((await post(app, [], 'wrong')).statusCode).toBe(401);
    expect((await post(app, [], `Bearer ${SECRET}`)).statusCode).toBe(401);
    expect(onTransactions).not.toHaveBeenCalled();
  });

  it('rejects bodies that are not an array', async () => {
    const { app } = server();
    expect((await post(app, { transactions: [] }, SECRET)).statusCode).toBe(400);
  });

  it('accepts raw transactions and skips malformed items', async () => {
    const { app, onTransactions } = server();
    const { json } = loadFixture('meteora-buy');
    const response = await post(
      app,
      [json, { type: 'SWAP', description: 'enhanced payload' }],
      SECRET,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: 1, invalid: 1 });
    expect(onTransactions).toHaveBeenCalledTimes(1);
    expect(onTransactions.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it('answers 5xx when persisting fails so Helius redelivers', async () => {
    const { app } = server(vi.fn(() => Promise.reject(new Error('database down'))));
    const { json } = loadFixture('meteora-buy');
    expect((await post(app, [json], SECRET)).statusCode).toBe(500);
  });

  it('only accepts JSON (or text, which is then rejected as not an array)', async () => {
    const { app } = server();
    const response = await app.inject({
      method: 'POST',
      url: HELIUS_WEBHOOK_PATH,
      payload: 'hello',
      headers: { authorization: SECRET, 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(415);
  });

  it('serves a health check without authentication', async () => {
    const { app } = server();
    expect((await app.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({ status: 'ok' });
  });
});
