import {
  listClosedDashboardPositions,
  listDashboardTrades,
  listOpenDashboardPositions,
} from '@solaryna/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card } from '../../../components/card';
import { EmptyState } from '../../../components/empty-state';
import { PageHeading } from '../../../components/page-heading';
import { Pagination } from '../../../components/pagination';
import { ClosedPositionsTable, OpenPositionsTable } from '../../../components/position-tables';
import { TradeTable } from '../../../components/trade-table';
import {
  pageToOffset,
  parseMode,
  parsePage,
  parsePositionsTab,
  splitPage,
  withParams,
  type PositionsTab,
  type SearchParams,
} from '../../../lib/params';
import { requireSession } from '../../../server/auth/session';
import { getWebConfig } from '../../../server/config';
import { getDb } from '../../../server/db';

export const metadata: Metadata = { title: 'Posisi & Trade · Solaryna' };

const TABS: { tab: PositionsTab; label: string }[] = [
  { tab: 'open', label: 'Terbuka' },
  { tab: 'closed', label: 'Ditutup' },
  { tab: 'trades', label: 'Trade' },
];

export default async function PositionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireSession();
  const params = await searchParams;
  const mode = parseMode(params.mode);
  const tab = parsePositionsTab(params.tab);
  const page = parsePage(params.page);
  const db = getDb();
  const timeZone = getWebConfig().displayTimeZone;
  const now = new Date();
  const modeParam = mode === 'live' ? 'live' : undefined;
  const walletsHref = withParams('/wallets', { mode: modeParam });

  let content: ReactNode;
  let hasNext = false;
  if (tab === 'open') {
    const open = await listOpenDashboardPositions(db, mode);
    content =
      open.length === 0 ? (
        <EmptyState action={{ href: walletsHref, label: 'Kelola wallet' }}>
          Belum ada posisi terbuka.
        </EmptyState>
      ) : (
        <OpenPositionsTable items={open} mode={mode} now={now} timeZone={timeZone} />
      );
  } else if (tab === 'closed') {
    const result = splitPage(await listClosedDashboardPositions(db, mode, pageToOffset(page)));
    hasNext = result.hasNext;
    content =
      result.items.length === 0 ? (
        <EmptyState>Belum ada posisi yang ditutup.</EmptyState>
      ) : (
        <ClosedPositionsTable items={result.items} mode={mode} now={now} timeZone={timeZone} />
      );
  } else {
    const result = splitPage(await listDashboardTrades(db, mode, pageToOffset(page)));
    hasNext = result.hasNext;
    content =
      result.items.length === 0 ? (
        <EmptyState>Belum ada trade.</EmptyState>
      ) : (
        <TradeTable items={result.items} mode={mode} timeZone={timeZone} />
      );
  }

  return (
    <div className="space-y-4">
      <PageHeading title="Posisi & Trade" mode={mode} />
      <div role="tablist" className="flex gap-1 border-b border-line">
        {TABS.map((item) => (
          <Link
            key={item.tab}
            role="tab"
            aria-selected={item.tab === tab}
            href={withParams('/positions', {
              mode: modeParam,
              tab: item.tab === 'open' ? undefined : item.tab,
            })}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              item.tab === tab
                ? 'border-accent text-fg'
                : 'border-transparent text-muted hover:text-fg'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>
      <Card
        title={TABS.find((item) => item.tab === tab)?.label ?? ''}
        aside={
          tab === 'open'
            ? 'Estimasi dari quote jual terakhir, sudah dikurangi biaya'
            : 'PnL setelah semua biaya dan slippage'
        }
      >
        {content}
        {tab !== 'open' && (
          <Pagination
            path="/positions"
            params={{ mode: modeParam, tab }}
            page={page}
            hasNext={hasNext}
          />
        )}
      </Card>
    </div>
  );
}
