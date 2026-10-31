'use server';

import { DASHBOARD_ACTOR, setTradingPaused } from '@solaryna/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { deleteSession, requireSession } from '../../server/auth/session';
import { getDb } from '../../server/db';

/** Kill switch from the dashboard; audited, and announced in Telegram by the bot. */
export async function setTradingPausedAction(formData: FormData): Promise<void> {
  await requireSession();
  await setTradingPaused(getDb(), formData.get('paused') === 'true', { actor: DASHBOARD_ACTOR });
  revalidatePath('/', 'layout');
}

export async function logoutAction(): Promise<void> {
  await deleteSession();
  redirect('/login');
}
