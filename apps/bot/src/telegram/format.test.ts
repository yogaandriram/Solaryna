import { USDC_MINT, WSOL_MINT, type SwapEvent } from '@solaryna/core';
import { describe, expect, it } from 'vitest';
import { formatStartupMessage, formatSwapAlert } from './format';

const event: SwapEvent = {
  signature:
    'ZZmZgznrDWqm2fGnWiSjQfU1XHPbhC6arvAVDnhNsFoJ9GQGvuBBf9wiwFejKkTitn8y5Xvkh3gZQCrRNUxgTHQ',
  slot: 463_539_517n,
  blockTime: new Date('2026-10-31T03:36:40Z'),
  wallet: 'J8M2wM8vtBLZJfajpczrjbs78PWhW1sqVFVJdE5d43jX',
  side: 'sell',
  tokenMint: '4CLJSkwJ7JsNvrtZrVwqcXecYrAwUTSkTC1p7gzqpump',
  tokenAmountRaw: 12_345_678_900_000n,
  tokenDecimals: 6,
  quoteMint: WSOL_MINT,
  quoteAmountRaw: 3_639_046_262n,
  quoteDecimals: 9,
  source: 'pumpfun',
};
const wallet = { id: 1, address: event.wallet, label: 'Smart 1' };

describe('formatSwapAlert', () => {
  it('renders a sell alert with amounts, WIB time, and links', () => {
    const html = formatSwapAlert({
      event,
      wallet,
      token: { symbol: 'PEPE', name: 'Pepe' },
      timeZone: 'Asia/Jakarta',
    });
    expect(html).toBe(
      [
        '🔴 <b>JUAL</b> · <b>Smart 1</b> <code>J8M2…43jX</code>',
        'Token: <b>PEPE</b> (Pepe)',
        'Jumlah: 12.345.678,9 PEPE',
        'Nilai: 3,639 SOL',
        'DEX: Pump.fun',
        'Waktu: 31 Okt 2026, 10.36.40 WIB',
        `Mint: <code>${event.tokenMint}</code>`,
        `<a href="https://solscan.io/tx/${event.signature}">Transaksi</a> · ` +
          `<a href="https://dexscreener.com/solana/${event.tokenMint}">Chart</a> · ` +
          `<a href="https://solscan.io/account/${event.wallet}">Wallet</a>`,
      ].join('\n'),
    );
  });

  it('escapes on-chain names and labels', () => {
    const html = formatSwapAlert({
      event: { ...event, side: 'buy' },
      wallet: { ...wallet, label: '<i>me</i>' },
      token: { symbol: '<a href="x">', name: 'A & B </code>' },
      timeZone: 'Asia/Jakarta',
    });
    expect(html).toContain('🟢 <b>BELI</b> · <b>&lt;i&gt;me&lt;/i&gt;</b>');
    expect(html).toContain('Token: <b>&lt;a href=&quot;x&quot;&gt;</b> (A &amp; B &lt;/code&gt;)');
    expect(html).not.toContain('<a href="x">');
  });

  it('falls back to the mint when the token has no metadata, and shows USDC quotes', () => {
    const html = formatSwapAlert({
      event: { ...event, quoteMint: USDC_MINT, quoteAmountRaw: 4_402_076n, quoteDecimals: 6 },
      wallet: { ...wallet, label: null },
      token: { symbol: null, name: null },
      timeZone: 'Asia/Jakarta',
    });
    expect(html).toContain('🔴 <b>JUAL</b> · <code>J8M2…43jX</code>');
    expect(html).toContain('Token: <code>4CLJ…pump</code>\n');
    expect(html).toContain('Jumlah: 12.345.678,9 token');
    expect(html).toContain('Nilai: 4,4021 USDC');
  });
});

describe('formatStartupMessage', () => {
  it('states paper mode and explains a refused live request', () => {
    const html = formatStartupMessage({
      mode: 'paper',
      fallbackReasons: ['LIVE_TRADING_ACKNOWLEDGED belum "true"'],
      ingestSource: 'webhook',
      walletCount: 3,
      paused: false,
    });
    expect(html).toContain('Mode: <b>PAPER</b>');
    expect(html).toContain('Wallet incaran aktif: 3');
    expect(html).toContain('• LIVE_TRADING_ACKNOWLEDGED belum &quot;true&quot;');
    expect(html).not.toContain('hot wallet');
  });

  it('reminds about the dedicated hot wallet in live mode', () => {
    const html = formatStartupMessage({
      mode: 'live',
      fallbackReasons: [],
      ingestSource: 'websocket',
      walletCount: 0,
      paused: false,
    });
    expect(html).toContain('hot wallet khusus');
    expect(html).toContain('Tambahkan dengan /addwallet');
  });
});
