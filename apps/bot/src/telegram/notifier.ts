import type { Api } from 'grammy';
import type { Logger } from 'pino';

export const HTML_MESSAGE_OPTIONS = {
  parse_mode: 'HTML',
  link_preview_options: { is_disabled: true },
} as const;

/**
 * Sends HTML messages to every allowed chat, one at a time and in order. Failures are logged,
 * never thrown: a Telegram outage must not stop ingest.
 */
export function createTelegramNotifier(options: {
  api: Pick<Api, 'sendMessage'>;
  chatIds: readonly number[];
  logger: Logger;
}) {
  const { api, chatIds, logger } = options;
  let queue: Promise<void> = Promise.resolve();

  return {
    notify(html: string): void {
      queue = queue.then(async () => {
        for (const chatId of chatIds) {
          try {
            await api.sendMessage(chatId, html, HTML_MESSAGE_OPTIONS);
          } catch (error) {
            logger.error({ err: error, chatId }, 'Telegram notification failed');
          }
        }
      });
    },
    /** Resolves once everything queued so far has been sent (or failed). */
    flush(): Promise<void> {
      return queue;
    },
  };
}

export type TelegramNotifier = ReturnType<typeof createTelegramNotifier>;
