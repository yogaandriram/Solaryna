import { getTrackedWallet, listDashboardSignals } from '@solaryna/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Card } from '../../../components/card';
import { Chips } from '../../../components/chips';
import { EmptyState } from '../../../components/empty-state';
import { PageHeading } from '../../../components/page-heading';
import { Pagination } from '../../../components/pagination';
import { SignalsTable } from '../../../components/signals-table';
import { walletName } from '../../../lib/format';
import {
  pageToOffset,
  parseMode,
  parsePage,
  parseSignalFilter,
  splitPage,
  withParams,
  type SearchParams,
} from '../../../lib/params';
import { requireSession } from '../../../server/auth/session';
import { getWebConfig } from '../../../server/config';
import { getDb } from '../../../server/db';

export const metadata: Metadata = { title: 'Sinyal · Solaryna' };

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireSession();
  const params = await searchParams;
  const mode = parseMode(params.mode);
  const page = parsePage(params.page);
  const filter = parseSignalFilter(params);
  const db = getDb();
  const timeZone = getWebConfig().displayTimeZone;

  const [rows, wallet] = await Promise.all([
    listDashboardSignals(db, mode, filter, pageToOffset(page)),
    filter.walletId === undefined ? undefined : getTrackedWallet(db, filter.walletId),
  ]);
  const { items, hasNext } = splitPage(rows);

  // The current filters; each chip changes one of them and starts again at page 1.
  const current = {
    mode: mode === 'live' ? 'live' : undefined,
    decision: filter.decision,
    side: filter.side,
    wallet: filter.walletId,
  };
  const href = (change: Partial<typeof current>) =>
    withParams('/signals', { ...current, ...change });
  const filtered =
    filter.decision !== undefined || filter.side !== undefined || wallet !== undefined;

  return (
    <div className="space-y-4">
      <PageHeading title="Sinyal" mode={mode} />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
        <Chips
          label="Keputusan"
          options={[
            {
              label: 'Semua',
              href: href({ decision: undefined }),
              active: filter.decision === undefined,
            },
            {
              label: 'Diikuti',
              href: href({ decision: 'accepted' }),
              active: filter.decision === 'accepted',
            },
            {
              label: 'Dilewati',
              href: href({ decision: 'rejected' }),
              active: filter.decision === 'rejected',
            },
          ]}
        />
        <Chips
          label="Arah"
          options={[
            { label: 'Semua', href: href({ side: undefined }), active: filter.side === undefined },
            { label: 'Beli', href: href({ side: 'buy' }), active: filter.side === 'buy' },
            { label: 'Jual', href: href({ side: 'sell' }), active: filter.side === 'sell' },
          ]}
        />
        {filter.walletId !== undefined && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">Wallet</span>
            <span className="rounded-full border border-accent bg-accent/10 px-3 py-1 font-medium">
              {wallet === undefined
                ? `#${filter.walletId}`
                : walletName(wallet.label, wallet.address)}
            </span>
            <Link href={href({ wallet: undefined })} className="text-muted hover:text-fg">
              Hapus filter
            </Link>
          </div>
        )}
      </div>
      <Card title="Daftar sinyal" aside="Waktu = saat sinyal diterima bot">
        {items.length === 0 ? (
          filtered ? (
            <EmptyState>Tidak ada sinyal yang cocok dengan filter ini.</EmptyState>
          ) : (
            <EmptyState
              action={{
                href: withParams('/wallets', { mode: current.mode }),
                label: 'Kelola wallet',
              }}
            >
              Belum ada sinyal. Sinyal muncul saat wallet incaran melakukan swap.
            </EmptyState>
          )
        ) : (
          <SignalsTable items={items} mode={mode} timeZone={timeZone} />
        )}
        <Pagination path="/signals" params={current} page={page} hasNext={hasNext} />
      </Card>
    </div>
  );
}
