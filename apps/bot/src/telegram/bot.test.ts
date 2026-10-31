import { Secret } from '@solaryna/config';
import type { Update, UserFromGetMe } from 'grammy/types';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createTelegramBot } from './bot';
import type { WalletCommandDeps } from './commands';

const ALLOWED_CHAT = 111;
const WALLET = 'J8M2wM8vtBLZJfajpczrjbs78PWhW1sqVFVJdE5d43jX';

const botInfo: UserFromGetMe = {
  id: 42,
  is_bot: true,
  first_name: 'Solaryna',
  username: 'solaryna_test_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as UserFromGetMe;

function commandUpdate(chatId: number, text: string): Update {
  const command = text.split(' ')[0] ?? text;
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 1_790_000_000,
      chat: { id: chatId, type: 'private', first_name: 'User' },
      from: { id: 7, is_bot: false, first_name: 'User' },
      text,
      entities: [{ type: 'bot_command', offset: 0, length: command.length }],
    },
  };
}

function setup(overrides: Partial<WalletCommandDeps> = {}) {
  const addWallet = vi.fn<WalletCommandDeps['addWallet']>((input) =>
    Promise.resolve({ status: 'added', wallet: { ...input, source: 'manual' } }),
  );
  const commands: WalletCommandDeps = {
    addWallet,
    removeWallet: vi.fn(() => Promise.resolve('deactivated' as const)),
    listWallets: vi.fn(() => Promise.resolve([])),
    syncWallets: vi.fn(() => Promise.resolve()),
    logger: pino({ level: 'silent' }),
    ...overrides,
  };
  const bot = createTelegramBot({
    token: new Secret('123456:test-token'),
    allowedChatIds: [ALLOWED_CHAT],
    commands,
    logger: pino({ level: 'silent' }),
  });
  bot.botInfo = botInfo;
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  // Intercept every Bot API call: nothing reaches Telegram.
  bot.api.config.use((_prev, method, payload) => {
    calls.push({ method, payload });
    return Promise.resolve({ ok: true, result: true } as never);
  });
  return { bot, addWallet, calls };
}

describe('createTelegramBot', () => {
  it('silently ignores chats that are not allowed', async () => {
    const { bot, addWallet, calls } = setup();
    await bot.handleUpdate(commandUpdate(999, `/addwallet ${WALLET}`));
    expect(addWallet).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('runs commands from allowed chats with the chat and user as audit actor', async () => {
    const { bot, addWallet, calls } = setup();
    await bot.handleUpdate(commandUpdate(ALLOWED_CHAT, `/addwallet ${WALLET} alpha`));
    expect(addWallet).toHaveBeenCalledWith({ address: WALLET, label: 'alpha' }, 'telegram:111:7');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: { chat_id: ALLOWED_CHAT, parse_mode: 'HTML' },
    });
  });

  it('replies with a generic error when a command fails', async () => {
    const { bot, calls } = setup({
      listWallets: vi.fn(() => Promise.reject(new Error('db down'))),
    });
    await bot.handleUpdate(commandUpdate(ALLOWED_CHAT, '/list'));
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.payload.text)).toContain('Terjadi kesalahan');
    expect(String(calls[0]?.payload.text)).not.toContain('db down');
  });
});
