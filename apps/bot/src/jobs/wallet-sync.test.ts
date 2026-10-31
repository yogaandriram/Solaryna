import { Secret } from '@solaryna/config';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { HeliusWebhook } from '../helius/client';
import { WebhookConfigError, createHeliusWebhookTarget } from '../helius/webhook-target';
import { createWalletSync, type SubscriptionTarget } from './wallet-sync';

const logger = pino({ level: 'silent' });

function registryWith(lists: string[][]) {
  let current: string[] = [];
  return {
    refresh: vi.fn(() => {
      current = lists.shift() ?? current;
      return Promise.resolve(true);
    }),
    addresses: () => [...current].sort(),
  };
}

describe('createWalletSync', () => {
  it('applies the address list only when it changes', async () => {
    const apply = vi.fn<SubscriptionTarget['apply']>(() => Promise.resolve());
    const target: SubscriptionTarget = { name: 'test', apply };
    const sync = createWalletSync({
      registry: registryWith([['B', 'A'], ['A', 'B'], ['A']]),
      target,
      logger,
    });
    await sync.syncNow();
    await sync.syncNow();
    await sync.syncNow();
    expect(apply.mock.calls).toEqual([[['A', 'B']], [['A']]]);
  });

  it('retries a failed apply on the next run', async () => {
    const apply = vi.fn().mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValue(undefined);
    const sync = createWalletSync({
      registry: registryWith([['A']]),
      target: { name: 't', apply },
      logger,
    });
    await expect(sync.syncNow()).rejects.toThrow('HTTP 503');
    await sync.syncNow();
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('serializes concurrent runs', async () => {
    let active = 0;
    let maxActive = 0;
    const apply = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    });
    const sync = createWalletSync({
      registry: registryWith([['A'], ['B'], ['C']]),
      target: { name: 't', apply },
      logger,
    });
    await Promise.all([sync.syncNow(), sync.syncNow(), sync.syncNow()]);
    expect(maxActive).toBe(1);
    expect(apply).toHaveBeenCalledTimes(3);
  });
});

describe('createHeliusWebhookTarget', () => {
  const secret = new Secret('webhook-secret-value-1');
  const webhook = (overrides: Partial<HeliusWebhook> = {}): HeliusWebhook => ({
    id: 'wh-1',
    url: 'https://bot.example.test/webhooks/helius',
    type: 'raw',
    accountAddresses: ['A'],
    transactionTypes: ['ANY'],
    authHeader: secret,
    txnStatus: null,
    encoding: null,
    ...overrides,
  });

  function target(current: HeliusWebhook) {
    const helius = {
      getWebhook: vi.fn(() => Promise.resolve(current)),
      updateWebhook: vi.fn(() => Promise.resolve()),
    };
    return {
      helius,
      target: createHeliusWebhookTarget({ helius, webhookId: 'wh-1', secret, logger }),
    };
  }

  it('updates addresses when they differ and skips the paid call otherwise', async () => {
    const changed = target(webhook());
    await changed.target.apply(['A', 'B']);
    expect(changed.helius.updateWebhook).toHaveBeenCalledWith(webhook(), {
      accountAddresses: ['A', 'B'],
      authHeader: secret,
    });

    const unchanged = target(webhook({ accountAddresses: ['B', 'A'] }));
    await unchanged.target.apply(['A', 'B']);
    expect(unchanged.helius.updateWebhook).not.toHaveBeenCalled();
  });

  it('fixes a mismatched auth header', async () => {
    const { helius, target: t } = target(
      webhook({ authHeader: new Secret('something-else-entirely') }),
    );
    await t.apply(['A']);
    expect(helius.updateWebhook).toHaveBeenCalledTimes(1);
  });

  it('refuses webhooks that are not raw', async () => {
    const { target: t } = target(webhook({ type: 'enhanced' }));
    await expect(t.apply(['A'])).rejects.toBeInstanceOf(WebhookConfigError);
  });

  it('keeps existing addresses when no wallet is active', async () => {
    const { helius, target: t } = target(webhook());
    await t.apply([]);
    expect(helius.updateWebhook).not.toHaveBeenCalled();
  });
});
