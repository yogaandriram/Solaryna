import { zonedDayRange, type TradingMode } from '@solaryna/core';
import type { TradingStore } from '../engine/store';
import type { PositionMonitor } from '../exits/monitor';
import type { ResolveTokenLabel } from '../tokens/token-info';
import { formatPositions, formatStatus } from './trading-format';

// Handlers for /pause /resume /status /positions /report. They return the HTML reply; bot.ts
// only routes. Pause and resume are audited in the same DB transaction as the setting.

export interface TradingCommandDeps {
  mode: TradingMode;
  store: TradingStore;
  monitor: Pick<PositionMonitor, 'valuation'>;
  resolveTokenLabel: ResolveTokenLabel;
  /** Label of a tracked wallet, or null when it has none or is unknown. */
  walletLabel(walletId: number | null): string | null;
  loadReport(kind: 'day' | 'week'): Promise<string[]>;
  notifyOthers(html: string, excludeChatId: number): void;
  timeZone: string;
  now: () => Date;
}

export const REPORT_USAGE = 'Gunakan /report (hari ini) atau /report minggu (minggu ini).';

const modeName = (mode: TradingMode) => (mode === 'paper' ? 'paper' : 'live');

export async function handlePause(
  deps: TradingCommandDeps,
  actor: string,
  chatId: number,
): Promise<string> {
  const changed = await deps.store.setTradingPaused(true, { actor });
  if (!changed) {
    return 'Trading sudah dijeda. Gunakan /resume untuk melanjutkan.';
  }
  const message = `⏸ Trading ${modeName(deps.mode)} dijeda. Sinyal baru dan exit otomatis menunggu /resume.`;
  deps.notifyOthers(`${message}\n(oleh perintah /pause)`, chatId);
  return message;
}

export async function handleResume(
  deps: TradingCommandDeps,
  actor: string,
  chatId: number,
): Promise<string> {
  const changed = await deps.store.setTradingPaused(false, { actor });
  if (!changed) {
    return 'Trading tidak sedang dijeda.';
  }
  const message = `▶️ Trading ${modeName(deps.mode)} dilanjutkan.`;
  deps.notifyOthers(`${message}\n(oleh perintah /resume)`, chatId);
  return message;
}

export async function handleStatus(deps: TradingCommandDeps): Promise<string> {
  const today = zonedDayRange(deps.now(), deps.timeZone);
  const [paused, open, realizedToday] = await Promise.all([
    deps.store.isTradingPaused(),
    deps.store.listOpenPositions(deps.mode),
    deps.store.sumRealizedPnl(deps.mode, today.from, today.to),
  ]);
  return formatStatus({
    mode: deps.mode,
    paused,
    openCount: open.length,
    realizedTodayLamports: realizedToday,
  });
}

export async function handlePositions(deps: TradingCommandDeps): Promise<string> {
  const open = await deps.store.listOpenPositions(deps.mode);
  const now = deps.now();
  const items = await Promise.all(
    open.map(async (position) => ({
      position,
      token: await deps.resolveTokenLabel(position.tokenMint, position.tokenDecimals),
      walletLabel: deps.walletLabel(position.trackedWalletId),
      valuation: deps.monitor.valuation(position.id),
      now,
    })),
  );
  return formatPositions(items);
}

/** `/report` → today so far, `/report minggu` → this week so far. */
export async function handleReport(deps: TradingCommandDeps, args: string): Promise<string[]> {
  switch (args.trim().toLowerCase()) {
    case '':
      return deps.loadReport('day');
    case 'minggu':
      return deps.loadReport('week');
    default:
      return [REPORT_USAGE];
  }
}
