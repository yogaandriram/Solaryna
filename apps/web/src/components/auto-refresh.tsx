'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatTime } from '../lib/format';

const REFRESH_MS = 30_000;

/**
 * Re-renders the server data every 30 s while the tab is visible, and right away when the tab
 * becomes visible again. Shows when the data was last refreshed.
 */
export function AutoRefresh({ timeZone }: { timeZone: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  // Set after mount only, so the server and client renders agree.
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    setUpdatedAt(new Date());
  }, [pathname, search]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        router.refresh();
        setUpdatedAt(new Date());
      }
    };
    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router]);

  return (
    <span className="text-xs text-muted tabular-nums">
      {updatedAt === null ? ' ' : `Diperbarui ${formatTime(updatedAt, timeZone)}`}
    </span>
  );
}
