import { lastZonedDaysRange, shortAddress } from '@solaryna/core';
import {
  getDashboardWallet,
  listClosedDashboardPositions,
  listDashboardSignals,
  listWalletOpenPositions,
} from '@solaryna/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SideBadge } from '../../../../components/badges';
import { Card } from '../../../../components/card';
import { CopyButton } from '../../../../components/copy-button';
import { EmptyState } from '../../../../components/empty-state';
import { PageHeading } from '../../../../components/page-heading';
import { Pnl } from '../../../../components/pnl';
import {
  ClosedPositionsTable,
  OpenPositionsTable,
  TD,
  TH,
} from '../../../../components/position-tables';
import { SignalsTable } from '../../../../components/signals-table';
import { StatCard } from '../../../../components/stat-card';
import { WalletActiveToggle, WalletStatusBadge } from '../../../../components/wallet-active-toggle';
import {
  formatDateTime,
  formatPct,
  formatQuoteAmount,
  formatTokenAmount,
  walletName,
} from '../../../../lib/format';
import { parseId, parseMode, withParams, type SearchParams } from '../../../../lib/params';
import { RELOAD_NOTE, STATS_DAYS, winRatePct } from '../../../../lib/wallets';
import { requireSession } from '../../../../server/auth/session';
import { getWebConfig } from '../../../../server/config';
import { getDb } from '../../../../server/db';

export const metadata: Metadata = { title: 'Detail wallet · Solaryna' };

const LIST_LIMIT = { limit: 20, offset: 0 };

export default async function WalletPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requireSession();
  const id = parseId((await params).id);
  if (id === null) {
    notFound();
  }
  const mode = parseMode((await searchParams).mode);
  const db = getDb();
  const timeZone = getWebConfig().displayTimeZone;
  const now = new Date();
  const since = lastZonedDaysRange(now, STATS_DAYS, timeZone).from;

  const [detail, open, signals, closed] = await Promise.all([
    getDashboardWallet(db, id, mode, since),
    listWalletOpenPositions(db, mode, id),
    listDashboardSignals(db, mode, { walletId: id }, LIST_LIMIT),
    listClosedDashboardPositions(db, mode, LIST_LIMIT, id),
  ]);
  if (detail === null) {
    notFound();
  }
  const { wallet, stats, latestScore } = detail.wallet;
  const modeParam = mode === 'live' ? 'live' : undefined;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={withParams('/wallets', { mode: modeParam })}
          className="text-sm text-muted hover:text-fg"
        >
          ← Wallet
        </Link>
      </div>
      <PageHeading title={walletName(wallet.label, wallet.address)} mode={mode} />
      <div className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
        <WalletStatusBadge active={wallet.isActive} />
        <span className="flex items-center gap-2">
          <code className="text-fg">{shortAddress(wallet.address, 6)}</code>
          <CopyButton value={wallet.address} />
          <a
            href={`https://solscan.io/account/${wallet.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            Solscan ↗
          </a>
        </span>
        <span>
          {wallet.source === 'manual' ? 'Ditambah manual' : 'Hasil penemuan'} ·{' '}
          {formatDateTime(wallet.createdAt, timeZone)}
        </span>
        <WalletActiveToggle id={wallet.id} active={wallet.isActive} />
        <span className="text-xs">{RELOAD_NOTE}</span>
      </div>

      <section aria-label="Statistik wallet" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={`Sinyal beli ${STATS_DAYS} hari`}
          value={stats.buySignals}
          detail={`${stats.followed} diikuti`}
        />
        <StatCard
          label="PnL terealisasi"
          value={<Pnl lamports={stats.realizedPnlLamports} />}
          detail="Dari posisi yang mengikuti wallet ini, setelah biaya"
        />
        <StatCard
          label="Win rate"
          value={formatPct(winRatePct(stats.wins, stats.closedPositions))}
          detail={`${stats.wins} dari ${stats.closedPositions} posisi ditutup untung`}
        />
        <StatCard
          label="Skor"
          value={latestScore ?? '—'}
          detail={latestScore === null ? 'Skor otomatis menyusul (M4)' : 'Skor terbaru'}
        />
      </section>

      <Card title={`Posisi terbuka (${open.length})`}>
        {open.length === 0 ? (
          <EmptyState>Tidak ada posisi terbuka dari wallet ini.</EmptyState>
        ) : (
          <OpenPositionsTable items={open} mode={mode} now={now} timeZone={timeZone} />
        )}
      </Card>

      <Card
        title="Sinyal terbaru"
        aside={
          <Link
            href={withParams('/signals', { mode: modeParam, wallet: wallet.id })}
            className="hover:underline"
          >
            Semua sinyal wallet ini →
          </Link>
        }
      >
        {signals.length === 0 ? (
          <EmptyState>Belum ada sinyal dari wallet ini.</EmptyState>
        ) : (
          <SignalsTable items={signals} mode={mode} timeZone={timeZone} />
        )}
      </Card>

      <Card title="Posisi ditutup terbaru">
        {closed.length === 0 ? (
          <EmptyState>Belum ada posisi ditutup dari wallet ini.</EmptyState>
        ) : (
          <ClosedPositionsTable items={closed} mode={mode} now={now} timeZone={timeZone} />
        )}
      </Card>

      <Card title="Swap terbaru wallet" aside="Swap milik wallet sendiri, tidak bergantung mode">
        {detail.swaps.length === 0 ? (
          <EmptyState>Belum ada swap tercatat.</EmptyState>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className={TH}>Waktu blok</th>
                  <th className={TH}>Swap</th>
                  <th className={`${TH} hidden text-right md:table-cell`}>Jumlah token</th>
                  <th className={`${TH} text-right`}>Jumlah quote</th>
                  <th className={`${TH} hidden md:table-cell`}>DEX</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {detail.swaps.map((swap) => (
                  <tr key={swap.id} className="border-t border-line">
                    <td className={`${TD} text-muted`}>
                      <a
                        href={`https://solscan.io/tx/${swap.signature}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {formatDateTime(swap.blockTime, timeZone)}
                      </a>
                    </td>
                    <td className={TD}>
                      <SideBadge side={swap.side} /> <code>{shortAddress(swap.tokenMint)}</code>
                    </td>
                    <td className={`${TD} hidden text-right md:table-cell`}>
                      {formatTokenAmount(swap.tokenAmountRaw, swap.tokenDecimals)}
                    </td>
                    <td className={`${TD} text-right`}>
                      {formatQuoteAmount(swap.quoteAmountRaw, swap.quoteDecimals, swap.quoteMint)}
                    </td>
                    <td className={`${TD} hidden text-muted md:table-cell`}>{swap.source}</td>
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
