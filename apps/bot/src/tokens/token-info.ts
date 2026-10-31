import { sanitizeDisplayText } from '@solaryna/core';
import type { Logger } from 'pino';
import type { AssetMetadata } from '../helius/client';

export const TOKEN_SYMBOL_MAX_LENGTH = 32;
export const TOKEN_NAME_MAX_LENGTH = 100;

/** Sanitized token name/symbol; null when unknown. Still escape before rendering. */
export interface TokenLabel {
  symbol: string | null;
  name: string | null;
}

export interface TokenInfoDeps {
  findToken(mint: string): Promise<TokenLabel | undefined>;
  saveToken(input: { mint: string; decimals: number } & TokenLabel): Promise<void>;
  getAsset(mint: string): Promise<AssetMetadata | null>;
  logger: Logger;
}

const clean = (text: string | null, maxLength: number): string | null => {
  const cleaned = text === null ? '' : sanitizeDisplayText(text, maxLength);
  return cleaned === '' ? null : cleaned;
};

/**
 * Looks up a token's name and symbol: memory, then the tokens table, then Helius DAS. Results
 * are cached even when Helius has no metadata, but not when the lookup itself failed.
 */
export function createTokenInfoResolver(deps: TokenInfoDeps) {
  const cache = new Map<string, TokenLabel>();

  return async function resolveTokenLabel(mint: string, decimals: number): Promise<TokenLabel> {
    const cached = cache.get(mint);
    if (cached !== undefined) {
      return cached;
    }
    try {
      const stored = await deps.findToken(mint);
      if (stored !== undefined && (stored.symbol !== null || stored.name !== null)) {
        cache.set(mint, stored);
        return stored;
      }
      const asset = await deps.getAsset(mint);
      const label: TokenLabel = {
        symbol: clean(asset?.symbol ?? null, TOKEN_SYMBOL_MAX_LENGTH),
        name: clean(asset?.name ?? null, TOKEN_NAME_MAX_LENGTH),
      };
      await deps.saveToken({ mint, decimals, ...label });
      cache.set(mint, label);
      return label;
    } catch (error) {
      deps.logger.warn({ err: error, mint }, 'Token metadata lookup failed');
      return { symbol: null, name: null };
    }
  };
}

export type ResolveTokenLabel = ReturnType<typeof createTokenInfoResolver>;
