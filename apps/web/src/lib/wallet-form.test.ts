import { describe, expect, it } from 'vitest';
import { parseAddWalletForm } from './wallet-form';

const ADDRESS = 'J8M2wM8vtBLZJfajpczrjbs78PWhW1sqVFVJdE5d43jX';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

describe('parseAddWalletForm', () => {
  it('rejects an invalid address', () => {
    expect(parseAddWalletForm(form({ address: 'bukan-alamat', label: 'x' }))).toEqual({
      ok: false,
      error: 'Alamat wallet Solana tidak valid.',
    });
    expect(parseAddWalletForm(new FormData())).toEqual({
      ok: false,
      error: 'Alamat wallet Solana tidak valid.',
    });
  });

  it('trims the address and cleans the label', () => {
    expect(parseAddWalletForm(form({ address: `  ${ADDRESS} `, label: ' Paus‮  besar ' }))).toEqual(
      { ok: true, address: ADDRESS, label: 'Paus besar' },
    );
  });

  it('turns an empty label into null', () => {
    expect(parseAddWalletForm(form({ address: ADDRESS, label: '   ' }))).toEqual({
      ok: true,
      address: ADDRESS,
      label: null,
    });
  });
});
