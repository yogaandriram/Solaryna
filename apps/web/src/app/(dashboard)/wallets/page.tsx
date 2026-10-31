import { lastZonedDaysRange, shortAddress } from '@solaryna/core';
import { listDashboardWallets } from '@solaryna/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AddWalletForm } from '../../../components/add-wallet-form';
import { Card } from '../../../components/card';
import { Chips } from '../../../components/chips';
import { EmptyState } from '../../../components/empty-state';
import { PageHeading } from '../../../components/page-heading';
import { Pnl } from '../../../components/pnl';
import { TD, TH } from '../../../components/position-tables';
import { WalletActiveToggle, WalletStatusBadge } from '../../../components/wallet-active-toggle';
import { formatPct } from '../../../lib/format';
import { parseMode, parseWalletStatus, withParams, type SearchParams } from '../../../lib/params';
import { RELOAD_NOTE, STATS_DAYS, winRatePct } from '../../../lib/wallets';
import { requireSession } from '../../../server/auth/session';
import { getWebConfig } from '../../../server/config';
import { getDb } from '../../../server/db';

export const metadata: Metadata = { title: 'Wallet · Solaryna' };

export default async function WalletsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireSession();
  const params = await searchParams;
  const mode = parseMode(params.mode);
  const status = parseWalletStatus(params.status);
  const timeZone = getWebConfig().displayTimeZone;
  const since = lastZonedDaysRange(new Date(), STATS_DAYS, timeZone).from;
  const all = await listDashboardWallets(getDb(), mode, since);
  const wallets = all.filter(
    ({ wallet }) => status === 'all' || wallet.isActive === (status === 'active'),
  );
  const modeParam = mode === 'live' ? 'live' : undefined;
  const statusHref = (value: typeof status) =>
    withParams('/wallets', { mode: modeParam, status: value === 'all' ? undefined : value });
  const activeCount = all.filter(({ wallet }) => wallet.isActive).length;

  return (
    <div className="space-y-6">
      <PageHeading title="Wallet" mode={mode} />

      <Card title="Tambah wallet incaran" aside={RELOAD_NOTE}>
        <AddWalletForm />
      </Card>

      <Card
        title={`Wallet incaran (${activeCount} aktif dari ${all.length})`}
        aside={`Statistik ${mode === 'paper' ? 'paper' : 'live'}; sinyal ${STATS_DAYS} hari terakhir`}
      >
        <div className="mb-3">
          <Chips
            label="Status"
            options={[
              { label: 'Semua', href: statusHref('all'), active: status === 'all' },
              { label: 'Aktif', href: statusHref('active'), active: status === 'active' },
              { label: 'Nonaktif', href: statusHref('inactive'), active: status === 'inactive' },
            ]}
          />
        </div>
        {wallets.length === 0 ? (
          <EmptyState>
            {all.length === 0
              ? 'Belum ada wallet incaran. Tambahkan alamat wallet di atas, atau impor dari file dengan npm run wallets:import.'
              : 'Tidak ada wallet dengan status ini.'}
          </EmptyState>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className={TH}>Wallet</th>
                  <th className={`${TH} hidden text-right md:table-cell`}>Sinyal beli</th>
                  <th className={`${TH} hidden text-right md:table-cell`}>Diikuti</th>
                  <th className={`${TH} hidden text-right lg:table-cell`}>Ditutup</th>
                  <th className={`${TH} hidden text-right lg:table-cell`}>Win rate</th>
                  <th className={`${TH} text-right`}>PnL terealisasi</th>
                  <th className={`${TH} hidden text-right sm:table-cell`}>Terbuka</th>
                  <th className={`${TH} hidden text-right md:table-cell`}>Skor</th>
                  <th className={`${TH} text-right`}>Aksi</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {wallets.map(({ wallet, stats, latestScore }) => (
                  <tr key={wallet.id} className="border-t border-line">
                    <td className={TD}>
                      <Link
                        href={withParams(`/wallets/${wallet.id}`, { mode: modeParam })}
                        className="font-medium hover:underline"
                      >
                        {wallet.label ?? shortAddress(wallet.address)}
                      </Link>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                        {wallet.label !== null && <code>{shortAddress(wallet.address)}</code>}
                        <WalletStatusBadge active={wallet.isActive} />
                      </div>
                    </td>
                    <td className={`${TD} hidden text-right md:table-cell`}>{stats.buySignals}</td>
                    <td className={`${TD} hidden text-right md:table-cell`}>{stats.followed}</td>
                    <td className={`${TD} hidden text-right lg:table-cell`}>
                      {stats.closedPositions}
                    </td>
                    <td className={`${TD} hidden text-right lg:table-cell`}>
                      {formatPct(winRatePct(stats.wins, stats.closedPositions))}
                    </td>
                    <td className={`${TD} text-right`}>
                      <Pnl lamports={stats.realizedPnlLamports} />
                    </td>
                    <td className={`${TD} hidden text-right sm:table-cell`}>
                      {stats.openPositions}
                    </td>
                    <td className={`${TD} hidden text-right text-muted md:table-cell`}>
                      {latestScore ?? '—'}
                    </td>
                    <td className={`${TD} text-right`}>
                      <div className="flex justify-end">
                        <WalletActiveToggle id={wallet.id} active={wallet.isActive} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
