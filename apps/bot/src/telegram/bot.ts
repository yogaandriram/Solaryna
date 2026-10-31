import { autoRetry } from '@grammyjs/auto-retry';
import type { Secret } from '@solaryna/config';
import { Bot, type Context } from 'grammy';
import type { Logger } from 'pino';
import {
  ADD_WALLET_USAGE,
  REMOVE_WALLET_USAGE,
  handleAddWallet,
  handleListWallets,
  handleRemoveWallet,
  type WalletCommandDeps,
} from './commands';
import { HTML_MESSAGE_OPTIONS } from './notifier';

export const BOT_COMMANDS = [
  { command: 'list', description: 'Daftar wallet incaran aktif' },
  { command: 'addwallet', description: 'Tambah wallet incaran: /addwallet <alamat> [label]' },
  { command: 'removewallet', description: 'Berhenti memantau wallet: /removewallet <alamat>' },
  { command: 'help', description: 'Bantuan' },
] as const;

const HELP_TEXT = [
  '<b>Solaryna</b> memantau wallet incaran dan mengirim alert saat mereka beli/jual.',
  '',
  '/list — daftar wallet incaran aktif',
  `/addwallet — tambah wallet. ${ADD_WALLET_USAGE}`,
  `/removewallet — berhenti memantau. ${REMOVE_WALLET_USAGE}`,
  '',
  'Alert ini informasi transaksi on-chain, bukan saran investasi.',
].join('\n');

/** Audit actor for a command, e.g. "telegram:-1001234:5678". */
export function telegramActor(ctx: Context): string {
  return `telegram:${ctx.chat?.id ?? 'unknown'}:${ctx.from?.id ?? 'unknown'}`;
}

/**
 * Bot with the M1 commands. Updates from chats outside TELEGRAM_ALLOWED_CHAT_IDS are dropped
 * silently, before any handler runs.
 */
export function createTelegramBot(options: {
  token: Secret;
  allowedChatIds: readonly number[];
  commands: WalletCommandDeps;
  logger: Logger;
}): Bot {
  const { commands, logger } = options;
  const bot = new Bot(options.token.reveal());
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));

  const allowed = new Set(options.allowedChatIds);
  bot.use(async (ctx, next) => {
    if (ctx.chat !== undefined && allowed.has(ctx.chat.id)) {
      await next();
    }
  });

  const reply = (ctx: Context, html: string) => ctx.reply(html, HTML_MESSAGE_OPTIONS);
  // Handles command errors the same way under long polling and handleUpdate (tests).
  const handlers = bot.errorBoundary(async ({ error, ctx }) => {
    logger.error({ err: error, updateId: ctx.update.update_id }, 'Telegram command failed');
    try {
      await reply(ctx, '❌ Terjadi kesalahan saat memproses perintah. Detail ada di log bot.');
    } catch {
      // Telegram itself is failing; the log above is all we can do.
    }
  });
  handlers.command(['start', 'help'], (ctx) => reply(ctx, HELP_TEXT));
  handlers.command('list', async (ctx) => reply(ctx, await handleListWallets(commands)));
  handlers.command('addwallet', async (ctx) =>
    reply(ctx, await handleAddWallet(commands, ctx.match, telegramActor(ctx))),
  );
  handlers.command('removewallet', async (ctx) =>
    reply(ctx, await handleRemoveWallet(commands, ctx.match, telegramActor(ctx))),
  );

  bot.catch(({ error, ctx }) => {
    logger.error({ err: error, updateId: ctx.update.update_id }, 'Unhandled Telegram update error');
  });

  return bot;
}
