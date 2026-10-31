import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import {
  ADD_WALLET_USAGE,
  TELEGRAM_MESSAGE_LIMIT,
  handleAddWallet,
  handleListWallets,
  handleRemoveWallet,
  type WalletCommandDeps,
  type WalletView,
} from './commands';

const WALLET = 'J8M2wM8vtBLZJfajpczrjbs78PWhW1sqVFVJdE5d43jX';
const ACTOR = 'telegram:10:20';

function deps(overrides: Partial<WalletCommandDeps> = {}) {
  return {
    addWallet: vi.fn<WalletCommandDeps['addWallet']>((input) =>
      Promise.resolve({ status: 'added', wallet: { ...input, source: 'manual' } }),
    ),
    removeWallet: vi.fn<WalletCommandDeps['removeWallet']>(() => Promise.resolve('deactivated')),
    listWallets: vi.fn<WalletCommandDeps['listWallets']>(() => Promise.resolve([])),
    syncWallets: vi.fn<WalletCommandDeps['syncWallets']>(() => Promise.resolve()),
    logger: pino({ level: 'silent' }),
    ...overrides,
  };
}

describe('handleAddWallet', () => {
  it('adds a wallet with a sanitized label, audits the actor, and syncs', async () => {
    const d = deps();
    const reply = await handleAddWallet(d, `  ${WALLET}   smart\tmoney <1> `, ACTOR);
    expect(d.addWallet).toHaveBeenCalledWith({ address: WALLET, label: 'smart money <1>' }, ACTOR);
    expect(d.syncWallets).toHaveBeenCalledTimes(1);
    expect(reply).toBe(
      '✅ Wallet <b>smart money &lt;1&gt;</b> <code>J8M2…43jX</code> ditambahkan.',
    );
  });

  it('shows usage or rejects invalid addresses without touching the database', async () => {
    const d = deps();
    expect(await handleAddWallet(d, '', ACTOR)).toBe(ADD_WALLET_USAGE);
    expect(await handleAddWallet(d, '<script> x', ACTOR)).toBe(
      '❌ Alamat wallet tidak valid: <code>&lt;script&gt;</code>',
    );
    expect(d.addWallet).not.toHaveBeenCalled();
  });

  it('does not resync when the wallet was already active', async () => {
    const d = deps({
      addWallet: vi.fn(() =>
        Promise.resolve({
          status: 'already_active' as const,
          wallet: { address: WALLET, label: null, source: 'manual' as const },
        }),
      ),
    });
    expect(await handleAddWallet(d, WALLET, ACTOR)).toBe(
      'ℹ️ Wallet <code>J8M2…43jX</code> sudah dipantau.',
    );
    expect(d.syncWallets).not.toHaveBeenCalled();
  });

  it('still confirms the change when the sync fails', async () => {
    const d = deps({ syncWallets: vi.fn(() => Promise.reject(new Error('HTTP 503'))) });
    const reply = await handleAddWallet(d, WALLET, ACTOR);
    expect(reply).toContain('ditambahkan.');
    expect(reply).toContain('akan dicoba lagi otomatis');
  });
});

describe('handleRemoveWallet', () => {
  it.each([
    ['deactivated', '🗑 Wallet <code>J8M2…43jX</code> berhenti dipantau.'],
    ['already_inactive', 'ℹ️ Wallet <code>J8M2…43jX</code> sudah tidak dipantau.'],
    ['not_found', 'ℹ️ Wallet <code>J8M2…43jX</code> tidak ada di daftar.'],
  ] as const)('replies for %s', async (status, expected) => {
    const d = deps({ removeWallet: vi.fn(() => Promise.resolve(status)) });
    expect(await handleRemoveWallet(d, WALLET, ACTOR)).toContain(expected);
    expect(d.removeWallet).toHaveBeenCalledWith(WALLET, ACTOR);
    expect(d.syncWallets).toHaveBeenCalledTimes(status === 'deactivated' ? 1 : 0);
  });
});

describe('handleListWallets', () => {
  it('lists full addresses and labels', async () => {
    const wallets: WalletView[] = [
      { address: WALLET, label: 'A&B', source: 'manual' },
      { address: 'So11111111111111111111111111111111111111112', label: null, source: 'discovered' },
    ];
    const d = deps({ listWallets: vi.fn(() => Promise.resolve(wallets)) });
    expect(await handleListWallets(d)).toBe(
      [
        '📋 <b>Wallet incaran aktif (2)</b>',
        `1. <b>A&amp;B</b>\n<code>${WALLET}</code>`,
        '2. · otomatis\n<code>So11111111111111111111111111111111111111112</code>',
      ].join('\n'),
    );
  });

  it('stays within one Telegram message', async () => {
    const wallets: WalletView[] = Array.from({ length: 60 }, () => ({
      address: WALLET,
      label: 'x'.repeat(100),
      source: 'manual',
    }));
    const reply = await handleListWallets(
      deps({ listWallets: vi.fn(() => Promise.resolve(wallets)) }),
    );
    expect(reply.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    expect(reply).toMatch(/… dan \d+ wallet lainnya$/);
  });

  it('explains how to add the first wallet', async () => {
    expect(await handleListWallets(deps())).toContain('Belum ada wallet incaran.');
  });
});
