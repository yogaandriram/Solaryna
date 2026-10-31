'use server';

import {
  DASHBOARD_ACTOR,
  addManualWallet,
  deactivateWallet,
  getTrackedWallet,
  type AddWalletStatus,
} from '@solaryna/db';
import { revalidatePath } from 'next/cache';
import { parseId } from '../../../lib/params';
import { parseAddWalletForm } from '../../../lib/wallet-form';
import { requireSession } from '../../../server/auth/session';
import { getDb } from '../../../server/db';

// Wallet changes are audited (actor "dashboard") and announced in Telegram by the bot.

export interface AddWalletState {
  message: string | null;
  error: string | null;
  /** The submitted values, echoed back on error so the reset form keeps them. */
  values: { address: string; label: string };
}

const EMPTY_VALUES = { address: '', label: '' };

function submittedValues(formData: FormData): AddWalletState['values'] {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === 'string' ? value : '';
  };
  return { address: text('address'), label: text('label') };
}

const ADD_MESSAGES: Record<AddWalletStatus, string> = {
  added: 'Wallet ditambahkan.',
  reactivated: 'Wallet diaktifkan kembali.',
  already_active: 'Wallet sudah dipantau.',
};

export async function addWalletAction(
  _previous: AddWalletState,
  formData: FormData,
): Promise<AddWalletState> {
  await requireSession();
  const input = parseAddWalletForm(formData);
  if (!input.ok) {
    return { message: null, error: input.error, values: submittedValues(formData) };
  }
  const { status } = await addManualWallet(
    getDb(),
    { address: input.address, label: input.label },
    { actor: DASHBOARD_ACTOR },
  );
  revalidatePath('/wallets', 'layout');
  return { message: ADD_MESSAGES[status], error: null, values: EMPTY_VALUES };
}

/** Deactivates (active=false) or reactivates (active=true) a tracked wallet. */
export async function setWalletActiveAction(formData: FormData): Promise<void> {
  await requireSession();
  const id = parseId(formData.get('id'));
  if (id === null) {
    return;
  }
  const db = getDb();
  const wallet = await getTrackedWallet(db, id);
  if (wallet === undefined) {
    return;
  }
  const audit = { actor: DASHBOARD_ACTOR };
  if (formData.get('active') === 'true') {
    await addManualWallet(db, { address: wallet.address, label: wallet.label }, audit);
  } else {
    await deactivateWallet(db, wallet.address, audit);
  }
  revalidatePath('/wallets', 'layout');
}
