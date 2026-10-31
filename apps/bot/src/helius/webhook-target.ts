import type { Secret } from '@solaryna/config';
import type { Logger } from 'pino';
import type { SubscriptionTarget } from '../jobs/wallet-sync';
import type { HeliusClient } from './client';

/** The webhook was set up in a way the bot cannot work with. Message is user-facing. */
export class WebhookConfigError extends Error {
  override name = 'WebhookConfigError';
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

/**
 * Registers tracked wallets on the user's Helius webhook (created in the dashboard). Only
 * accountAddresses and authHeader are managed here; URL and type stay as the user set them.
 */
export function createHeliusWebhookTarget(options: {
  helius: Pick<HeliusClient, 'getWebhook' | 'updateWebhook'>;
  webhookId: string;
  secret: Secret;
  logger: Logger;
}): SubscriptionTarget {
  const { helius, webhookId, secret, logger } = options;
  return {
    name: 'helius-webhook',
    async apply(addresses) {
      const webhook = await helius.getWebhook(webhookId);
      if (webhook.type !== 'raw') {
        throw new WebhookConfigError(
          `Webhook Helius ${webhookId} bertipe "${webhook.type}"; Solaryna butuh tipe "raw".`,
        );
      }
      const authMatches = webhook.authHeader?.reveal() === secret.reveal();
      if (addresses.length === 0) {
        // Helius needs at least one address; events for inactive wallets are ignored anyway.
        logger.warn('No active wallets; leaving the Helius webhook addresses unchanged');
      }
      const nextAddresses = addresses.length === 0 ? webhook.accountAddresses : addresses;
      if (authMatches && sameSet(nextAddresses, webhook.accountAddresses)) {
        return;
      }
      if (!authMatches) {
        logger.warn('Helius webhook authHeader differs from HELIUS_WEBHOOK_SECRET; updating it');
      }
      // Each edit costs 100 Helius credits, so only update when something changed.
      await helius.updateWebhook(webhook, { accountAddresses: nextAddresses, authHeader: secret });
    },
  };
}
