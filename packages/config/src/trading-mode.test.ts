import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';
import { Secret } from './secret';
import { resolveTradingMode, type TradingModeRequest } from './trading-mode';

// Deterministic dummy bytes, not a real wallet.
const validKey = bs58.encode(new Uint8Array(64).fill(7));

const liveRequest: TradingModeRequest = {
  requestedMode: 'live',
  liveAcknowledged: true,
  botWalletPrivateKey: new Secret(validKey),
};

describe('resolveTradingMode', () => {
  it('stays in paper mode when paper is requested, without decoding any key', () => {
    const result = resolveTradingMode(
      { ...liveRequest, requestedMode: 'paper' },
      { liveExecutorAvailable: true },
    );
    expect(result).toEqual({ mode: 'paper', fallbackReasons: [], botWalletSecretKey: null });
  });

  it('activates live only when every condition holds', () => {
    const result = resolveTradingMode(liveRequest, { liveExecutorAvailable: true });
    expect(result.mode).toBe('live');
    expect(result.fallbackReasons).toEqual([]);
    expect(result.botWalletSecretKey?.reveal()).toHaveLength(64);
  });

  it('falls back to paper when live is not acknowledged', () => {
    const result = resolveTradingMode(
      { ...liveRequest, liveAcknowledged: false },
      { liveExecutorAvailable: true },
    );
    expect(result.mode).toBe('paper');
    expect(result.botWalletSecretKey).toBeNull();
    expect(result.fallbackReasons).toEqual(['LIVE_TRADING_ACKNOWLEDGED belum "true"']);
  });

  it('falls back to paper when the private key is missing', () => {
    const result = resolveTradingMode(
      { ...liveRequest, botWalletPrivateKey: null },
      { liveExecutorAvailable: true },
    );
    expect(result.mode).toBe('paper');
    expect(result.fallbackReasons).toEqual(['BOT_WALLET_PRIVATE_KEY kosong']);
  });

  it.each([
    ['not base58', '0OIl-not-base58'],
    ['wrong length', bs58.encode(new Uint8Array(32).fill(7))],
  ])('falls back to paper when the private key is invalid (%s)', (_label, key) => {
    const result = resolveTradingMode(
      { ...liveRequest, botWalletPrivateKey: new Secret(key) },
      { liveExecutorAvailable: true },
    );
    expect(result.mode).toBe('paper');
    expect(result.botWalletSecretKey).toBeNull();
    expect(result.fallbackReasons).toEqual([
      'BOT_WALLET_PRIVATE_KEY bukan secret key base58 64 byte yang valid',
    ]);
    expect(result.fallbackReasons.join(' ')).not.toContain(key);
  });

  it('falls back to paper while no live executor exists', () => {
    const result = resolveTradingMode(liveRequest, { liveExecutorAvailable: false });
    expect(result.mode).toBe('paper');
    expect(result.botWalletSecretKey).toBeNull();
    expect(result.fallbackReasons).toEqual(['executor live belum tersedia (Milestone M5)']);
  });

  it('reports every unmet condition at once', () => {
    const result = resolveTradingMode(
      { requestedMode: 'live', liveAcknowledged: false, botWalletPrivateKey: null },
      { liveExecutorAvailable: false },
    );
    expect(result.fallbackReasons).toHaveLength(3);
  });
});
