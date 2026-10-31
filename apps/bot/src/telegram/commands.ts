import {
  escapeHtml,
  isValidSolanaAddress,
  normalizeWalletLabel,
  shortAddress,
} from '@solaryna/core';
import type { AddWalletStatus, RemoveWalletStatus } from '@solaryna/db';
import type { Logger } from 'pino';
import { formatWallet } from './format';

/** Telegram's limit for one message. */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

export interface WalletView {
  address: string;
  label: string | null;
  source: 'manual' | 'discovered';
}

export interface WalletCommandDeps {
  addWallet(
    input: { address: string; label: string | null },
    actor: string,
  ): Promise<{ status: AddWalletStatus; wallet: WalletView }>;
  removeWallet(address: string, actor: string): Promise<RemoveWalletStatus>;
  listWallets(): Promise<WalletView[]>;
  /** Pushes the active wallet list to Helius / the websocket subscriber. */
  syncWallets(): Promise<void>;
  logger: Logger;
}

export const ADD_WALLET_USAGE = 'Format: <code>/addwallet &lt;alamat&gt; [label]</code>';
export const REMOVE_WALLET_USAGE = 'Format: <code>/removewallet &lt;alamat&gt;</code>';

const SYNC_FAILED =
  '\n⚠️ Sinkronisasi daftar wallet ke sumber event gagal; akan dicoba lagi otomatis.';

function splitArgs(args: string): { first: string; rest: string } {
  const trimmed = args.trim();
  const space = trimmed.search(/\s/);
  return space === -1
    ? { first: trimmed, rest: '' }
    : { first: trimmed.slice(0, space), rest: trimmed.slice(space + 1) };
}

function invalidAddress(text: string): string {
  return `❌ Alamat wallet tidak valid: <code>${escapeHtml(Array.from(text).slice(0, 50).join(''))}</code>`;
}

async function syncNote(deps: WalletCommandDeps): Promise<string> {
  try {
    await deps.syncWallets();
    return '';
  } catch (error) {
    deps.logger.error({ err: error }, 'Wallet sync after a Telegram command failed');
    return SYNC_FAILED;
  }
}

export async function handleAddWallet(
  deps: WalletCommandDeps,
  args: string,
  actor: string,
): Promise<string> {
  const { first: address, rest } = splitArgs(args);
  if (address === '') {
    return ADD_WALLET_USAGE;
  }
  if (!isValidSolanaAddress(address)) {
    return invalidAddress(address);
  }
  const label = normalizeWalletLabel(rest);
  const { status, wallet } = await deps.addWallet({ address, label }, actor);
  const shown = formatWallet(wallet);
  if (status === 'already_active') {
    return label === null
      ? `ℹ️ Wallet ${shown} sudah dipantau.`
      : `ℹ️ Wallet ${shown} sudah dipantau; label diperbarui.`;
  }
  const verb = status === 'added' ? 'ditambahkan' : 'diaktifkan kembali';
  return `✅ Wallet ${shown} ${verb}.${await syncNote(deps)}`;
}

export async function handleRemoveWallet(
  deps: WalletCommandDeps,
  args: string,
  actor: string,
): Promise<string> {
  const { first: address } = splitArgs(args);
  if (address === '') {
    return REMOVE_WALLET_USAGE;
  }
  if (!isValidSolanaAddress(address)) {
    return invalidAddress(address);
  }
  const status = await deps.removeWallet(address, actor);
  const shown = `<code>${escapeHtml(shortAddress(address))}</code>`;
  switch (status) {
    case 'not_found':
      return `ℹ️ Wallet ${shown} tidak ada di daftar.`;
    case 'already_inactive':
      return `ℹ️ Wallet ${shown} sudah tidak dipantau.`;
    case 'deactivated':
      return `🗑 Wallet ${shown} berhenti dipantau. Riwayatnya tetap disimpan.${await syncNote(deps)}`;
  }
}

/** Active wallets with full addresses (tap to copy), cut to fit one Telegram message. */
export async function handleListWallets(deps: WalletCommandDeps): Promise<string> {
  const wallets = await deps.listWallets();
  if (wallets.length === 0) {
    return `Belum ada wallet incaran.\n${ADD_WALLET_USAGE}`;
  }
  const header = `📋 <b>Wallet incaran aktif (${wallets.length})</b>`;
  const lines: string[] = [header];
  let length = header.length;
  for (const [index, wallet] of wallets.entries()) {
    const label = wallet.label === null ? '' : ` <b>${escapeHtml(wallet.label)}</b>`;
    const source = wallet.source === 'discovered' ? ' · otomatis' : '';
    const line = `${index + 1}.${label}${source}\n<code>${escapeHtml(wallet.address)}</code>`;
    const remaining = wallets.length - index;
    const footer = `\n… dan ${remaining} wallet lainnya`;
    if (length + 1 + line.length + footer.length > TELEGRAM_MESSAGE_LIMIT) {
      lines.push(footer.trimStart());
      break;
    }
    lines.push(line);
    length += 1 + line.length;
  }
  return lines.join('\n');
}
