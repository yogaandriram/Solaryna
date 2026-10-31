import { shortAddress } from '@solaryna/core';
import { getDashboardPosition } from '@solaryna/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Card } from '../../../../components/card';
import { CopyButton } from '../../../../components/copy-button';
import { PageHeading } from '../../../../components/page-heading';
import { Pnl, PnlPct } from '../../../../components/pnl';
import { StatCard } from '../../../../components/stat-card';
import { TradeTable } from '../../../../components/trade-table';
import {
  formatDateTime,
  formatDuration,
  formatSol,
  formatTokenAmount,
  tokenLabel,
  walletName,
} from '../../../../lib/format';
import { parseId, parseMode, withParams, type SearchParams } from '../../../../lib/params';
import { positionRow } from '../../../../lib/positions';
import { requireSession } from '../../../../server/auth/session';
import { getWebConfig } from '../../../../server/config';
import { getDb } from '../../../../server/db';

export const metadata: Metadata = { title: 'Detail posisi · Solaryna' };

export default async function PositionPage({
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
  const item = await getDashboardPosition(getDb(), id);
  if (item === null) {
    notFound();
  }
  const { position } = item;
  if (position.mode !== mode) {
    // Never show a position under the other mode's badge: send the link to its own mode.
    redirect(
      withParams(`/positions/${id}`, { mode: position.mode === 'live' ? 'live' : undefined }),
    );
  }

  const timeZone = getWebConfig().displayTimeZone;
  const now = new Date();
  const row = positionRow(item, now);
  const open = position.status === 'open';
  const modeParam = { mode: mode === 'live' ? 'live' : undefined };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={withParams('/positions', { ...modeParam, tab: open ? undefined : 'closed' })}
          className="text-sm text-muted hover:text-fg"
        >
          ← Posisi & Trade
        </Link>
      </div>
      <PageHeading title={tokenLabel(item.tokenSymbol, position.tokenMint)} mode={mode} />
      <div className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
        <span>{open ? 'Terbuka' : `Ditutup · ${row.closeReasonLabel ?? '—'}`}</span>
        <span className="flex items-center gap-2">
          Mint <code className="text-fg">{shortAddress(position.tokenMint)}</code>
          <CopyButton value={position.tokenMint} />
          <a
            href={`https://solscan.io/token/${position.tokenMint}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            Solscan ↗
          </a>
          <a
            href={`https://dexscreener.com/solana/${position.tokenMint}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            Dexscreener ↗
          </a>
        </span>
        {item.walletId !== null && item.walletAddress !== null && (
          <span>
            Wallet{' '}
            <Link
              href={withParams(`/wallets/${item.walletId}`, modeParam)}
              className="text-fg hover:underline"
            >
              {walletName(item.walletLabel, item.walletAddress)}
            </Link>
          </span>
        )}
      </div>

      <section aria-label="Angka posisi" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={open ? 'Modal tersisa' : 'Modal'}
          value={formatSol(row.costLamports)}
          detail={`Total modal ${formatSol(position.costLamports)}`}
        />
        {open ? (
          <StatCard
            label="Nilai terakhir"
            value={row.valueLamports === null ? '—' : formatSol(row.valueLamports)}
            detail={
              position.lastValuedAt === null
                ? 'Belum dinilai monitor'
                : row.valueLamports === null
                  ? 'Tidak ada rute jual saat dinilai'
                  : `Dinilai ${formatDateTime(position.lastValuedAt, timeZone)}`
            }
          />
        ) : (
          <StatCard label="Hasil jual" value={formatSol(position.proceedsLamports)} />
        )}
        <StatCard
          label={open ? 'Estimasi PnL' : 'PnL terealisasi'}
          value={
            row.pnlLamports === null ? (
              <span className="text-muted">—</span>
            ) : (
              <>
                <Pnl lamports={row.pnlLamports} />{' '}
                <PnlPct value={row.pnlPct} className="text-base" />
              </>
            )
          }
          detail={
            open
              ? position.realizedPnlLamports === null
                ? 'Belum terealisasi'
                : `Belum terealisasi; sudah terealisasi dari jual sebagian: ${formatSol(position.realizedPnlLamports)}`
              : 'Setelah semua biaya dan slippage'
          }
        />
        <StatCard
          label="Biaya dibayar"
          value={formatSol(position.feesLamports)}
          detail="Fee jaringan + priority"
        />
      </section>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted">Dibuka</dt>
          <dd>{formatDateTime(position.openedAt, timeZone)}</dd>
        </div>
        <div>
          <dt className="text-muted">{open ? 'Umur' : 'Ditutup'}</dt>
          <dd>
            {open || position.closedAt === null
              ? formatDuration(row.ageMs)
              : formatDateTime(position.closedAt, timeZone)}
          </dd>
        </div>
        {!open && (
          <div>
            <dt className="text-muted">Durasi</dt>
            <dd>{row.durationMs === null ? '—' : formatDuration(row.durationMs)}</dd>
          </div>
        )}
        <div>
          <dt className="text-muted">Jumlah token</dt>
          <dd className="tabular-nums">
            {formatTokenAmount(position.tokenAmountRaw, position.tokenDecimals)} dari{' '}
            {formatTokenAmount(position.initialTokenAmountRaw, position.tokenDecimals)}
          </dd>
        </div>
      </dl>

      <Card
        title="Trade"
        aside="Fee DEX sudah termasuk di jumlah SOL; fee jaringan dan priority dibayar terpisah"
      >
        <TradeTable
          items={item.trades.map((trade) => ({ trade, tokenSymbol: item.tokenSymbol }))}
          mode={mode}
          timeZone={timeZone}
          showToken={false}
        />
      </Card>
    </div>
  );
}
