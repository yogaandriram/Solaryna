'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { parseMode, withParams } from '../lib/params';

const ITEMS = [
  { href: '/', label: 'Ringkasan' },
  { href: '/wallets', label: 'Wallet' },
  { href: '/signals', label: 'Sinyal' },
  { href: '/positions', label: 'Posisi & Trade' },
  { href: '/settings', label: 'Pengaturan' },
];

/** Section tabs that carry the selected mode; they scroll sideways on narrow screens. */
export function Nav() {
  const pathname = usePathname();
  const mode = parseMode(useSearchParams().get('mode'));
  const section = `/${pathname.split('/')[1] ?? ''}`;
  return (
    <nav aria-label="Bagian" className="-mb-px flex gap-1 overflow-x-auto">
      {ITEMS.map((item) => {
        const active = item.href === section;
        return (
          <Link
            key={item.href}
            href={withParams(item.href, { mode: mode === 'live' ? 'live' : undefined })}
            aria-current={active ? 'page' : undefined}
            className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap ${
              active ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
