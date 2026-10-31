'use client';

import type { TradingMode } from '@solaryna/core';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { parseMode } from '../lib/params';

// A client component because layouts are not re-rendered on navigation: a server-rendered
// switch would keep showing the mode of the first page opened.

const MODES: { mode: TradingMode; label: string; active: string }[] = [
  { mode: 'paper', label: 'Paper', active: 'bg-paper-soft text-paper' },
  { mode: 'live', label: 'Live', active: 'bg-live-soft text-live' },
];

export function ModeSwitch() {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = parseMode(params.get('mode'));
  const segments = pathname.split('/').filter(Boolean);

  function href(mode: TradingMode): string {
    // A detail page belongs to one mode, so switching goes back to its list.
    const next = segments.length > 1 ? new URLSearchParams() : new URLSearchParams(params);
    next.delete('page');
    next.delete('before');
    if (mode === 'paper') {
      next.delete('mode');
    } else {
      next.set('mode', mode);
    }
    const path = segments.length > 1 ? `/${segments[0] ?? ''}` : pathname;
    const query = next.toString();
    return query === '' ? path : `${path}?${query}`;
  }

  return (
    <div
      role="group"
      aria-label="Mode data"
      className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-sm"
    >
      {MODES.map(({ mode, label, active }) => (
        <Link
          key={mode}
          href={href(mode)}
          aria-current={mode === current ? 'true' : undefined}
          className={`rounded-md px-3 py-1 font-medium ${
            mode === current ? active : 'text-muted hover:text-fg'
          }`}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
