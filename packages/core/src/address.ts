import bs58 from 'bs58';

const PUBLIC_KEY_LENGTH = 32;

/** True for a base58 string that decodes to a 32-byte public key (wallet, mint, program). */
export function isValidSolanaAddress(value: string): boolean {
  if (value.length < 32 || value.length > 44) {
    return false;
  }
  try {
    return bs58.decode(value).length === PUBLIC_KEY_LENGTH;
  } catch {
    return false;
  }
}

/** "AbCd…WxYz" for compact display. */
export function shortAddress(address: string, edge = 4): string {
  return address.length <= edge * 2 + 1
    ? address
    : `${address.slice(0, edge)}…${address.slice(-edge)}`;
}
