import type { TradingMode } from '@solaryna/core';
import {
  findOpenPositionByToken,
  getPosition,
  getSettingString,
  getWalletCooldown,
  insertSignal,
  isTokenBlacklisted,
  isTradingPaused,
  listOpenPositions,
  openPosition,
  recordSell,
  saveTokenMarketData,
  setSettingString,
  setTradingPaused,
  sumRealizedPnl,
  type AuditActor,
  type Database,
  type NewSignal,
  type PositionRow,
} from '@solaryna/db';

export type OpenPositionInput = Parameters<typeof openPosition>[1];
export type RecordSellInput = Parameters<typeof recordSell>[1];
export type TokenMarketDataInput = Parameters<typeof saveTokenMarketData>[1];

/** The trading queries the engine, monitor and commands use; injected so tests run without MySQL. */
export interface TradingStore {
  isTradingPaused(): Promise<boolean>;
  setTradingPaused(paused: boolean, audit: AuditActor): Promise<boolean>;
  getSettingString(name: string): Promise<string | null>;
  setSettingString(name: string, value: string): Promise<void>;
  insertSignal(signal: NewSignal): Promise<number>;
  openPosition(
    input: OpenPositionInput,
  ): Promise<{ signalId: number; positionId: number; tradeId: number }>;
  recordSell(input: RecordSellInput): Promise<{ signalId: number | null; tradeId: number }>;
  listOpenPositions(mode: TradingMode): Promise<PositionRow[]>;
  findOpenPositionByToken(mode: TradingMode, tokenMint: string): Promise<PositionRow | undefined>;
  getPosition(id: number): Promise<PositionRow | undefined>;
  sumRealizedPnl(mode: TradingMode, from: Date, to: Date): Promise<bigint>;
  getWalletCooldown(walletId: number): Promise<Date | null>;
  isTokenBlacklisted(mint: string): Promise<boolean>;
  saveTokenMarketData(input: TokenMarketDataInput): Promise<void>;
}

export function createDbTradingStore(db: Database): TradingStore {
  return {
    isTradingPaused: () => isTradingPaused(db),
    setTradingPaused: (paused, audit) => setTradingPaused(db, paused, audit),
    getSettingString: (name) => getSettingString(db, name),
    setSettingString: (name, value) => setSettingString(db, name, value),
    insertSignal: (signal) => insertSignal(db, signal),
    openPosition: (input) => openPosition(db, input),
    recordSell: (input) => recordSell(db, input),
    listOpenPositions: (mode) => listOpenPositions(db, mode),
    findOpenPositionByToken: (mode, tokenMint) => findOpenPositionByToken(db, mode, tokenMint),
    getPosition: (id) => getPosition(db, id),
    sumRealizedPnl: (mode, from, to) => sumRealizedPnl(db, mode, from, to),
    getWalletCooldown: (walletId) => getWalletCooldown(db, walletId),
    isTokenBlacklisted: (mint) => isTokenBlacklisted(db, mint),
    saveTokenMarketData: (input) => saveTokenMarketData(db, input),
  };
}
