import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createTokenInfoResolver, type TokenInfoDeps } from './token-info';

const MINT = '4CLJSkwJ7JsNvrtZrVwqcXecYrAwUTSkTC1p7gzqpump';

function setup(overrides: Partial<TokenInfoDeps> = {}) {
  const deps = {
    findToken: vi.fn<TokenInfoDeps['findToken']>(() => Promise.resolve(undefined)),
    saveToken: vi.fn<TokenInfoDeps['saveToken']>(() => Promise.resolve()),
    getAsset: vi.fn<TokenInfoDeps['getAsset']>(() =>
      Promise.resolve({ symbol: 'PEPE', name: 'Pepe' }),
    ),
    logger: pino({ level: 'silent' }),
    ...overrides,
  };
  return { deps, resolve: createTokenInfoResolver(deps) };
}

describe('createTokenInfoResolver', () => {
  it('fetches from Helius once, stores the result, then serves it from memory', async () => {
    const { deps, resolve } = setup();
    expect(await resolve(MINT, 6)).toEqual({ symbol: 'PEPE', name: 'Pepe' });
    expect(await resolve(MINT, 6)).toEqual({ symbol: 'PEPE', name: 'Pepe' });
    expect(deps.getAsset).toHaveBeenCalledTimes(1);
    expect(deps.saveToken).toHaveBeenCalledWith({
      mint: MINT,
      decimals: 6,
      symbol: 'PEPE',
      name: 'Pepe',
    });
  });

  it('uses stored metadata without calling Helius', async () => {
    const { deps, resolve } = setup({
      findToken: vi.fn(() => Promise.resolve({ symbol: 'WIF', name: null })),
    });
    expect(await resolve(MINT, 6)).toEqual({ symbol: 'WIF', name: null });
    expect(deps.getAsset).not.toHaveBeenCalled();
  });

  it('sanitizes untrusted on-chain text', async () => {
    const { resolve } = setup({
      getAsset: vi.fn(() =>
        Promise.resolve({ symbol: `\u202eTSUR${'X'.repeat(40)}`, name: '  \u0000\n ' }),
      ),
    });
    const label = await resolve(MINT, 6);
    expect(label.symbol).toBe(`TSUR${'X'.repeat(27)}…`);
    expect(label.name).toBeNull();
  });

  it('does not cache failed lookups', async () => {
    const getAsset = vi
      .fn<TokenInfoDeps['getAsset']>()
      .mockRejectedValueOnce(new Error('HTTP 429'))
      .mockResolvedValue({ symbol: 'PEPE', name: null });
    const { resolve } = setup({ getAsset });
    expect(await resolve(MINT, 6)).toEqual({ symbol: null, name: null });
    expect(await resolve(MINT, 6)).toEqual({ symbol: 'PEPE', name: null });
  });
});
