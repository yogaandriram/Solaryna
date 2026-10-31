import type { DashboardSignal, TradeRow } from '@solaryna/db';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SignalsTable } from './signals-table';
import { TradeTable } from './trade-table';

// Phones hide secondary columns, and a hidden column can't be scrolled to. Content the page is
// for must also appear in an element that is visible below the breakpoint (`lg:hidden`).

const T0 = new Date('2026-10-31T03:00:00.000Z');
const MINT = 'AbrEhdN9Zsb5AvE5Pubd9VkUUr6ufAHfZ9zo7KAppump';

/** Text inside elements whose class list contains `lg:hidden`. */
function phoneOnlyText(html: string): string {
  return [...html.matchAll(/<(\w+) class="[^"]*\blg:hidden\b[^"]*">(.*?)<\/\1>/g)]
    .map((match) => (match[2] ?? '').replace(/<[^>]+>/g, ''))
    .join(' | ');
}

const signal: DashboardSignal = {
  id: 1,
  createdAt: T0,
  decision: 'rejected',
  reasons: [{ code: 'trading_paused' }],
  side: 'buy',
  signature: '5'.repeat(88),
  blockTime: T0,
  tokenMint: MINT,
  tokenSymbol: 'DEMO',
  tokenAmountRaw: 1_000n,
  tokenDecimals: 6,
  quoteMint: 'So11111111111111111111111111111111111111112',
  quoteAmountRaw: 50_000_000n,
  quoteDecimals: 9,
  walletId: 1,
  walletAddress: 'J8M2wM8vtBLZJfajpczrjbs78PWhW1sqVFVJdE5d43jX',
  walletLabel: 'alpha',
};

const trade: TradeRow = {
  id: 1,
  positionId: 1,
  signalId: 1,
  mode: 'paper',
  side: 'buy',
  reason: 'copy_buy',
  status: 'simulated',
  tokenMint: MINT,
  tokenAmountRaw: 1_000_000n,
  tokenDecimals: 6,
  solAmountLamports: 50_000_000n,
  priceSol: '0.00005',
  networkFeeLamports: 5_000n,
  priorityFeeLamports: 200_000n,
  dexFeeLamports: 50_000n,
  slippageBps: 300,
  realizedPnlLamports: null,
  solUsdPrice: null,
  quotedAt: T0,
  txSignature: null,
  quote: null,
  error: null,
  executedAt: T0,
  createdAt: T0,
  updatedAt: T0,
};

describe('tables on a phone', () => {
  it('shows why a signal was skipped below the reasons column breakpoint', () => {
    const html = renderToStaticMarkup(
      createElement(SignalsTable, { items: [signal], mode: 'paper', timeZone: 'Asia/Jakarta' }),
    );
    expect(phoneOnlyText(html)).toContain('trading dijeda');
  });

  it('shows the fee breakdown of a trade below the fee columns breakpoint', () => {
    const html = renderToStaticMarkup(
      createElement(TradeTable, {
        items: [{ trade, tokenSymbol: 'DEMO' }],
        mode: 'paper',
        timeZone: 'Asia/Jakarta',
      }),
    );
    const text = phoneOnlyText(html);
    expect(text).toContain('0,000005');
    expect(text).toContain('0,0002');
    expect(text).toContain('0,00005');
  });
});
