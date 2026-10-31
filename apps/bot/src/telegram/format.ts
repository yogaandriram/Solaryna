import {
  USDC_MINT,
  WSOL_MINT,
  escapeHtml,
  formatAmount,
  formatDateTime,
  shortAddress,
  type SwapEvent,
  type SwapSource,
  type TradingMode,
} from '@solaryna/core';
import type { TokenLabel } from '../tokens/token-info';
import type { TrackedWalletInfo } from '../wallets/registry';

const DEX_LABELS: Record<SwapSource, string> = {
  pumpfun: 'Pump.fun',
  pumpswap: 'PumpSwap',
  raydium: 'Raydium',
  meteora: 'Meteora',
  orca: 'Orca',
  jupiter: 'Jupiter',
  unknown: 'Lainnya',
};

const QUOTE_SYMBOLS: Record<string, string> = { [WSOL_MINT]: 'SOL', [USDC_MINT]: 'USDC' };

export const solscanTxUrl = (signature: string) => `https://solscan.io/tx/${signature}`;
export const solscanAccountUrl = (address: string) => `https://solscan.io/account/${address}`;
export const dexscreenerUrl = (mint: string) => `https://dexscreener.com/solana/${mint}`;

const link = (url: string, text: string) => `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`;

/** Wallet as "<b>label</b> <code>AbCd…WxYz</code>", or just the short address. */
export function formatWallet(wallet: Pick<TrackedWalletInfo, 'address' | 'label'>): string {
  const address = `<code>${escapeHtml(shortAddress(wallet.address))}</code>`;
  return wallet.label === null ? address : `<b>${escapeHtml(wallet.label)}</b> ${address}`;
}

export interface SwapAlertInput {
  event: SwapEvent;
  wallet: TrackedWalletInfo;
  token: TokenLabel;
  timeZone: string;
}

/** Telegram HTML message for a swap made by a tracked wallet. All on-chain text is escaped. */
export function formatSwapAlert({ event, wallet, token, timeZone }: SwapAlertInput): string {
  const isBuy = event.side === 'buy';
  const tokenUnit = token.symbol ?? 'token';
  const tokenTitle =
    token.symbol === null
      ? `<code>${escapeHtml(shortAddress(event.tokenMint))}</code>`
      : `<b>${escapeHtml(token.symbol)}</b>`;
  const tokenName = token.name === null ? '' : ` (${escapeHtml(token.name)})`;
  const quoteSymbol = QUOTE_SYMBOLS[event.quoteMint] ?? shortAddress(event.quoteMint);

  return [
    `${isBuy ? '🟢 <b>BELI</b>' : '🔴 <b>JUAL</b>'} · ${formatWallet(wallet)}`,
    `Token: ${tokenTitle}${tokenName}`,
    `Jumlah: ${formatAmount(event.tokenAmountRaw, event.tokenDecimals, 2)} ${escapeHtml(tokenUnit)}`,
    `Nilai: ${formatAmount(event.quoteAmountRaw, event.quoteDecimals, 4)} ${escapeHtml(quoteSymbol)}`,
    `DEX: ${DEX_LABELS[event.source]}`,
    `Waktu: ${escapeHtml(formatDateTime(event.blockTime, timeZone))}`,
    `Mint: <code>${escapeHtml(event.tokenMint)}</code>`,
    [
      link(solscanTxUrl(event.signature), 'Transaksi'),
      link(dexscreenerUrl(event.tokenMint), 'Chart'),
      link(solscanAccountUrl(event.wallet), 'Wallet'),
    ].join(' · '),
  ].join('\n');
}

export interface StartupInfo {
  mode: TradingMode;
  /** Why requested live mode was not activated (from resolveTradingMode). */
  fallbackReasons: readonly string[];
  ingestSource: 'webhook' | 'websocket';
  walletCount: number;
}

export function formatStartupMessage(info: StartupInfo): string {
  const lines = [
    '✅ <b>Solaryna aktif</b>',
    info.mode === 'live'
      ? 'Mode: <b>LIVE</b> (transaksi nyata)'
      : 'Mode: <b>PAPER</b> (simulasi, tanpa transaksi nyata)',
    `Sumber event: ${info.ingestSource === 'webhook' ? 'webhook Helius' : 'websocket (development)'}`,
    `Wallet incaran aktif: ${info.walletCount}`,
    'Versi ini baru mengirim alert; eksekusi trade belum aktif.',
  ];
  if (info.fallbackReasons.length > 0) {
    lines.push(
      '',
      '⚠️ Mode live diminta tetapi tidak diaktifkan, bot berjalan sebagai paper:',
      ...info.fallbackReasons.map((reason) => `• ${escapeHtml(reason)}`),
    );
  }
  if (info.mode === 'live') {
    lines.push(
      '',
      '⚠️ Pastikan wallet bot adalah hot wallet khusus berisi modal kecil, bukan wallet utama.',
    );
  }
  if (info.walletCount === 0) {
    lines.push('', 'Belum ada wallet incaran. Tambahkan dengan /addwallet.');
  }
  return lines.join('\n');
}
