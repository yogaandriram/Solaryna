import { isTradingPaused } from '@solaryna/db';
import type { ReactNode } from 'react';
import { Disclaimer } from '../../components/disclaimer';
import { Header } from '../../components/header';
import { requireSession } from '../../server/auth/session';
import { getWebConfig } from '../../server/config';
import { getDb } from '../../server/db';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await requireSession();
  const paused = await isTradingPaused(getDb());
  return (
    <div className="flex min-h-dvh flex-col">
      <Header paused={paused} timeZone={getWebConfig().displayTimeZone} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      <footer className="border-t border-line px-4 py-4">
        <Disclaimer />
      </footer>
    </div>
  );
}
