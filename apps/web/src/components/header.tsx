import Link from 'next/link';
import { Suspense } from 'react';
import { logoutAction } from '../app/(dashboard)/actions';
import { AutoRefresh } from './auto-refresh';
import { PausedBadge } from './badges';
import { ModeSwitch } from './mode-switch';
import { Nav } from './nav';

export function Header({ paused, timeZone }: { paused: boolean; timeZone: string }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3 sm:px-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Solaryna
        </Link>
        <Link href="/settings" title="Status kill switch">
          <PausedBadge paused={paused} />
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <Suspense>
            <AutoRefresh timeZone={timeZone} />
          </Suspense>
          <form action={logoutAction}>
            <button type="submit" className="text-sm text-muted hover:text-fg">
              Keluar
            </button>
          </form>
        </div>
        <div className="flex w-full flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <Suspense>
            <Nav />
          </Suspense>
          <div className="pb-2">
            <Suspense>
              <ModeSwitch />
            </Suspense>
          </div>
        </div>
      </div>
    </header>
  );
}
