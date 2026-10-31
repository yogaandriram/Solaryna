import type { Api } from 'grammy';
import type { Logger } from 'pino';

export const HTML_MESSAGE_OPTIONS = {
  parse_mode: 'HTML',
  link_preview_options: { is_disabled: true },
} as const;

/** A message delivered to one chat, so it can be edited later. */
export interface SentMessage {
  chatId: number;
  messageId: number;
}

/**
 * Sends HTML messages to every allowed chat, one at a time and in order. Failures are logged,
 * never thrown: a Telegram outage must not stop ingest or trading.
 */
export function createTelegramNotifier(options: {
  api: Pick<Api, 'sendMessage' | 'editMessageText'>;
  chatIds: readonly number[];
  logger: Logger;
}) {
  const { api, chatIds, logger } = options;
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
  }

  async function sendAll(html: string, excludeChatId?: number): Promise<SentMessage[]> {
    const sent: SentMessage[] = [];
    for (const chatId of chatIds) {
      if (chatId === excludeChatId) {
        continue;
      }
      try {
        const message = await api.sendMessage(chatId, html, HTML_MESSAGE_OPTIONS);
        sent.push({ chatId, messageId: message.message_id });
      } catch (error) {
        logger.error({ err: error, chatId }, 'Telegram notification failed');
      }
    }
    return sent;
  }

  return {
    notify(html: string, notifyOptions: { excludeChatId?: number } = {}): void {
      void enqueue(() => sendAll(html, notifyOptions.excludeChatId));
    },
    /** Like notify, but resolves with the delivered messages once they are sent. */
    send(html: string): Promise<SentMessage[]> {
      return enqueue(() => sendAll(html));
    },
    /** Replaces the text of messages returned by send. Failures are logged, not thrown. */
    edit(sent: readonly SentMessage[], html: string): Promise<void> {
      return enqueue(async () => {
        for (const { chatId, messageId } of sent) {
          try {
            await api.editMessageText(chatId, messageId, html, HTML_MESSAGE_OPTIONS);
          } catch (error) {
            logger.warn({ err: error, chatId, messageId }, 'Telegram message edit failed');
          }
        }
      });
    },
    /** Resolves once everything queued so far has been sent (or failed). */
    async flush(): Promise<void> {
      await queue;
    },
  };
}

export type TelegramNotifier = ReturnType<typeof createTelegramNotifier>;
