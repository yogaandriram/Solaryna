import { isValidSolanaAddress } from './address';
import { sanitizeDisplayText } from './text';

export const WALLET_LABEL_MAX_LENGTH = 100;

export interface WalletListEntry {
  address: string;
  label: string | null;
}

export interface WalletListError {
  line: number;
  reason: 'invalid_address' | 'duplicate';
  text: string;
}

/** Normalizes a user-given wallet label; empty becomes null. */
export function normalizeWalletLabel(label: string | undefined): string | null {
  const cleaned = sanitizeDisplayText(label ?? '', WALLET_LABEL_MAX_LENGTH);
  return cleaned === '' ? null : cleaned;
}

/**
 * Parses a wallet list copied by hand (e.g. from GMGN): one wallet per line, the address
 * followed by an optional label, separated by whitespace, a comma, or a semicolon. Blank
 * lines, `#` comments, and an `address` header row are ignored.
 */
export function parseWalletList(text: string): {
  entries: WalletListEntry[];
  errors: WalletListError[];
} {
  const entries: WalletListEntry[] = [];
  const errors: WalletListError[] = [];
  const seen = new Set<string>();

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      return;
    }
    const match = /^([^\s,;]+)[\s,;]*(.*)$/.exec(line);
    const address = match?.[1] ?? '';
    if (/^address$/i.test(address)) {
      return;
    }
    const lineNumber = index + 1;
    if (!isValidSolanaAddress(address)) {
      errors.push({ line: lineNumber, reason: 'invalid_address', text: line });
      return;
    }
    if (seen.has(address)) {
      errors.push({ line: lineNumber, reason: 'duplicate', text: line });
      return;
    }
    seen.add(address);
    entries.push({ address, label: normalizeWalletLabel(match?.[2]) });
  });

  return { entries, errors };
}
