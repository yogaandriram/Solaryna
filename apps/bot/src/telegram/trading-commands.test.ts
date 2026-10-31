import type { PositionRow } from '@solaryna/db';
import { describe, expect, it, vi } from 'vitest';
import { createFakeTradingStore } from '../engine/fake-store';
import {
  REPORT_USAGE,
  handlePause,
  handlePositions,
  handleReport,
  handleResume,
  handleStatus,
  type TradingCommandDeps,
} from './trading-commands';

const NOW = new Date('2026-10-31T05:00:00Z');
const MINT = 'AbrEhdN9Zsb5AvE5Pubd9VkUUr6ufAHfZ9zo7KAppump';
const ACTOR = 'telegram:111:7';

const openPosition: PositionRow = {
  id: 3,
  mode: 'paper',
  status: 'open',
  tokenMint: MINT,
  tokenDecimals: 6,
  trackedWalletId: 1,
  openedFromSignalId: 1,
  initialTokenAmountRaw: 1_000_000_000n,
  tokenAmountRaw: 1_000_000_000n,
  costLamports: 50_000_000n,
  proceedsLamports: 0n,
  feesLamports: 205_000n,
  realizedPnlLamports: 0n,
  closeReason: null,
  openedAt: new Date(NOW.getTime() - 30 * 60_000),
  closedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function setup() {
  const store = createFakeTradingStore();
  const notifyOthers = vi.fn<TradingCommandDeps['notifyOthers']>();
  const loadReport = vi.fn<TradingCommandDeps['loadReport']>((kind) =>
    Promise.resolve(kind === 'week' ? ['minggu 1', 'minggu 2'] : ['hari ini']),
  );
  const deps: TradingCommandDeps = {
    mode: 'paper',
    store,
    monitor: { valuation: () => undefined },
    resolveTokenLabel: () => Promise.resolve({ symbol: '<b>AAA</b>', name: null }),
    walletLabel: (id) => (id === 1 ? 'alpha' : null),
    loadReport,
    notifyOthers,
    timeZone: 'Asia/Jakarta',
    now: () => NOW,
  };
  return { deps, store, notifyOthers, loadReport };
}

describe('/pause and /resume', () => {
  it('pauses with an audit entry and tells the other chats', async () => {
    const { deps, store, notifyOthers } = setup();
    const reply = await handlePause(deps, ACTOR, 111);
    expect(reply).toContain('⏸ Trading paper dijeda');
    expect(await store.isTradingPaused()).toBe(true);
    expect(store.audit).toEqual([{ actor: ACTOR, action: 'trading.pause' }]);
    expect(notifyOthers).toHaveBeenCalledTimes(1);
    expect(notifyOthers.mock.calls[0]?.[0]).toContain('dijeda');
    expect(notifyOthers.mock.calls[0]?.[1]).toBe(111);
  });

  it('says so when already paused, without notifying', async () => {
    const { deps, store, notifyOthers } = setup();
    store.settings.set('trading_paused', true);
    expect(await handlePause(deps, ACTOR, 111)).toContain('sudah dijeda');
    expect(notifyOthers).not.toHaveBeenCalled();
    expect(store.audit).toEqual([]);
  });

  it('resumes, and says so when it was not paused', async () => {
    const { deps, store, notifyOthers } = setup();
    expect(await handleResume(deps, ACTOR, 111)).toContain('tidak sedang dijeda');
    expect(notifyOthers).not.toHaveBeenCalled();

    store.settings.set('trading_paused', true);
    expect(await handleResume(deps, ACTOR, 111)).toContain('▶️ Trading paper dilanjutkan');
    expect(await store.isTradingPaused()).toBe(false);
    expect(store.audit).toEqual([{ actor: ACTOR, action: 'trading.resume' }]);
    expect(notifyOthers).toHaveBeenCalledTimes(1);
  });
});

describe('/status and /positions', () => {
  it('shows the mode, pause state, open positions and today realized PnL', async () => {
    const { deps, store } = setup();
    store.positions.push(openPosition);
    store.settings.set('trading_paused', true);
    const html = await handleStatus(deps);
    expect(html).toContain('PAPER');
    expect(html).toContain('⏸');
    expect(html).toContain('Posisi terbuka: 1');
  });

  it('lists open positions with escaped token labels and wallet labels', async () => {
    const { deps, store } = setup();
    expect(await handlePositions(deps)).toBe('Tidak ada posisi terbuka.');
    store.positions.push(openPosition);
    const html = await handlePositions(deps);
    expect(html).toContain('&lt;b&gt;AAA&lt;/b&gt;');
    expect(html).toContain('alpha');
    expect(html).toContain('30 m');
  });
});

describe('/report', () => {
  it('loads the day report by default and the week report for "minggu"', async () => {
    const { deps, loadReport } = setup();
    expect(await handleReport(deps, '')).toEqual(['hari ini']);
    expect(await handleReport(deps, ' minggu ')).toEqual(['minggu 1', 'minggu 2']);
    expect(loadReport.mock.calls.map((call) => call[0])).toEqual(['day', 'week']);
  });

  it('explains the usage for anything else', async () => {
    const { deps, loadReport } = setup();
    expect(await handleReport(deps, 'bulan')).toEqual([REPORT_USAGE]);
    expect(loadReport).not.toHaveBeenCalled();
  });
});
