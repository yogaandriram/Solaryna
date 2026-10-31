import { Secret } from '@solaryna/config';
import type { Update, UserFromGetMe } from 'grammy/types';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createFakeTradingStore } from '../engine/fake-store';
import { BOT_COMMANDS, createTelegramBot } from './bot';
import type { WalletCommandDeps } from './commands';
import type { TradingCommandDeps } from './trading-commands';

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
  const store = createFakeTradingStore();
  const notifyOthers = vi.fn<TradingCommandDeps['notifyOthers']>();
  const trading: TradingCommandDeps = {
    mode: 'paper',
    store,
    monitor: { valuation: () => undefined },
    resolveTokenLabel: () => Promise.resolve({ symbol: null, name: null }),
    walletLabel: () => null,
    loadReport: (kind) => Promise.resolve(kind === 'week' ? ['part 1', 'part 2'] : ['today']),
    notifyOthers,
    timeZone: 'Asia/Jakarta',
    now: () => new Date('2026-10-31T05:00:00Z'),
  };
  const bot = createTelegramBot({
    token: new Secret('123456:test-token'),
    allowedChatIds: [ALLOWED_CHAT],
    commands,
    trading,
    logger: pino({ level: 'silent' }),
  });
  bot.botInfo = botInfo;
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  // Intercept every Bot API call: nothing reaches Telegram.
  bot.api.config.use((_prev, method, payload) => {
    calls.push({ method, payload });
    return Promise.resolve({ ok: true, result: true } as never);
  });
  return { bot, addWallet, calls, store, notifyOthers };
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

  it('ignores trading commands from chats that are not allowed', async () => {
    const { bot, calls, store } = setup();
    await bot.handleUpdate(commandUpdate(999, '/pause'));
    expect(await store.isTradingPaused()).toBe(false);
    expect(calls).toEqual([]);
  });

  it('pauses trading from an allowed chat with the chat and user as audit actor', async () => {
    const { bot, calls, store, notifyOthers } = setup();
    await bot.handleUpdate(commandUpdate(ALLOWED_CHAT, '/pause'));
    expect(await store.isTradingPaused()).toBe(true);
    expect(store.audit).toEqual([{ actor: 'telegram:111:7', action: 'trading.pause' }]);
    expect(notifyOthers.mock.calls[0]?.[1]).toBe(ALLOWED_CHAT);
    expect(String(calls[0]?.payload.text)).toContain('dijeda');
  });

  it('sends a long report as several messages', async () => {
    const { bot, calls } = setup();
    await bot.handleUpdate(commandUpdate(ALLOWED_CHAT, '/report minggu'));
    expect(calls.map((call) => call.payload.text)).toEqual(['part 1', 'part 2']);
  });

  it('registers the trading commands in the command menu', () => {
    expect(BOT_COMMANDS.map((c) => c.command)).toEqual(
      expect.arrayContaining(['status', 'positions', 'pause', 'resume', 'report']),
    );
  });
});
