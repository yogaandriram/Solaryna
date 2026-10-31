import type { NewSignal, NewTrade, PositionRow } from '@solaryna/db';
import type { TradingStore } from './store';

// In-memory TradingStore for tests (engine, monitor, Telegram commands). Not used at runtime.

export interface FakeTradingStore extends TradingStore {
  signals: (NewSignal & { id: number })[];
  positions: PositionRow[];
  trades: (NewTrade & { id: number })[];
  settings: Map<string, unknown>;
  audit: { actor: string; action: string }[];
  cooldowns: Map<number, Date>;
  blacklist: Set<string>;
  marketData: unknown[];
}

export function createFakeTradingStore(): FakeTradingStore {
  const store: FakeTradingStore = {
    signals: [],
    positions: [],
    trades: [],
    settings: new Map(),
    audit: [],
    cooldowns: new Map(),
    blacklist: new Set(),
    marketData: [],

    isTradingPaused: () => Promise.resolve(store.settings.get('trading_paused') === true),
    setTradingPaused(paused, audit) {
      if ((store.settings.get('trading_paused') === true) === paused) {
        return Promise.resolve(false);
      }
      store.settings.set('trading_paused', paused);
      store.audit.push({ actor: audit.actor, action: paused ? 'trading.pause' : 'trading.resume' });
      return Promise.resolve(true);
    },
    getSettingString(name) {
      const value = store.settings.get(name);
      return Promise.resolve(typeof value === 'string' ? value : null);
    },
    setSettingString(name, value) {
      store.settings.set(name, value);
      return Promise.resolve();
    },
    insertSignal(signal) {
      const id = store.signals.length + 1;
      store.signals.push({ ...signal, id });
      return Promise.resolve(id);
    },
    async openPosition(input) {
      const signalId = await store.insertSignal(input.signal);
      const positionId = store.positions.length + 1;
      const now = new Date(0);
      store.positions.push({
        id: positionId,
        trackedWalletId: null,
        realizedPnlLamports: null,
        closeReason: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now,
        ...input.position,
        openedFromSignalId: signalId,
      });
      const tradeId = store.trades.length + 1;
      store.trades.push({ ...input.trade, id: tradeId, positionId, signalId });
      return { signalId, positionId, tradeId };
    },
    async recordSell(input) {
      const signalId = input.signal === null ? null : await store.insertSignal(input.signal);
      const tradeId = store.trades.length + 1;
      store.trades.push({ ...input.trade, id: tradeId, positionId: input.positionId, signalId });
      const index = store.positions.findIndex((p) => p.id === input.positionId);
      const current = store.positions[index];
      if (current === undefined) {
        throw new Error(`position ${input.positionId} not found`);
      }
      store.positions[index] = {
        ...current,
        ...input.position,
        realizedPnlLamports: input.position.realizedPnlLamports ?? null,
        closeReason: input.position.closeReason ?? null,
        closedAt: input.position.closedAt ?? null,
      };
      return { signalId, tradeId };
    },
    listOpenPositions: (mode) =>
      Promise.resolve(store.positions.filter((p) => p.mode === mode && p.status === 'open')),
    findOpenPositionByToken: (mode, tokenMint) =>
      Promise.resolve(
        store.positions.find(
          (p) => p.mode === mode && p.status === 'open' && p.tokenMint === tokenMint,
        ),
      ),
    getPosition: (id) => {
      const position = store.positions.find((p) => p.id === id);
      return Promise.resolve(position === undefined ? undefined : { ...position });
    },
    sumRealizedPnl: (mode, from, to) =>
      Promise.resolve(
        store.trades
          .filter((t) => t.mode === mode && t.executedAt >= from && t.executedAt < to)
          .reduce((sum, t) => sum + (t.realizedPnlLamports ?? 0n), 0n),
      ),
    getWalletCooldown: (walletId) => Promise.resolve(store.cooldowns.get(walletId) ?? null),
    isTokenBlacklisted: (mint) => Promise.resolve(store.blacklist.has(mint)),
    saveTokenMarketData(input) {
      store.marketData.push(input);
      return Promise.resolve();
    },
  };
  return store;
}
