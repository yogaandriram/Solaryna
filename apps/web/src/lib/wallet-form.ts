import { isValidSolanaAddress, normalizeWalletLabel } from '@solaryna/core';

export type AddWalletInput =
  { ok: true; address: string; label: string | null } | { ok: false; error: string };

/** Reads the add-wallet form: a trimmed, valid address and a cleaned optional label. */
export function parseAddWalletForm(formData: FormData): AddWalletInput {
  const rawAddress = formData.get('address');
  const address = typeof rawAddress === 'string' ? rawAddress.trim() : '';
  if (!isValidSolanaAddress(address)) {
    return { ok: false, error: 'Alamat wallet Solana tidak valid.' };
  }
  const rawLabel = formData.get('label');
  return {
    ok: true,
    address,
    label: normalizeWalletLabel(typeof rawLabel === 'string' ? rawLabel : undefined),
  };
}
