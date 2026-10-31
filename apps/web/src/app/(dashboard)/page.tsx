import {
  dailyPnlSeries,
  effectiveRiskLimits,
  lastZonedDaysRange,
  parseRiskLimitOverrides,
  zonedDayRange,
} from '@solaryna/core';
import {
  getOverviewTotals,
  getRiskLimitOverrides,
  isTradingPaused,
  listDashboardSignals,
  listOpenDashboardPositions,
  listRealizedPnlPoints,
} from '@solaryna/db';
import Link from 'next/link';
import { Card } from '../../components/card';
import { DailyPnlChart } from '../../components/daily-pnl-chart';
import { EmptyState } from '../../components/empty-state';
import { OpenPositionsTable } from '../../components/position-tables';
import { PageHeading } from '../../components/page-heading';
import { PauseToggle } from '../../components/pause-toggle';
import { Pnl } from '../../components/pnl';
import { SignalsTable } from '../../components/signals-table';
import { StatCard } from '../../components/stat-card';
import { formatDayKey, formatPct, formatSol } from '../../lib/format';
import { buildOverview } from '../../lib/overview';
import { parseMode, withParams, type SearchParams } from '../../lib/params';
import { requireSession } from '../../server/auth/session';
import { getWebConfig } from '../../server/config';
import { getDb } from '../../server/db';

const CHART_DAYS = 14;

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireSession();
  const mode = parseMode((await searchParams).mode);
  const db = getDb();
  const config = getWebConfig();
  const timeZone = config.displayTimeZone;
  const now = new Date();
  const chartRange = lastZonedDaysRange(now, CHART_DAYS, timeZone);

  const [totals, open, overrides, paused, points, signals] = await Promise.all([
    getOverviewTotals(db, mode, zonedDayRange(now, timeZone), lastZonedDaysRange(now, 7, timeZone)),
    listOpenDashboardPositions(db, mode),
    getRiskLimitOverrides(db),
    isTradingPaused(db),
    listRealizedPnlPoints(db, mode, chartRange.from, chartRange.to),
    listDashboardSignals(db, mode, {}, { limit: 10, offset: 0 }),
  ]);
  const limits = effectiveRiskLimits(config.risk, parseRiskLimitOverrides(overrides));
  const view = buildOverview({ totals, open, limits });
  const series = dailyPnlSeries(points, now, CHART_DAYS, timeZone);
  const seriesTotal = series.reduce((sum, day) => sum + day.pnlLamports, 0n);
  const modeParam = { mode: mode === 'live' ? 'live' : undefined };
  const { unrealized } = view;

  return (
    <div className="space-y-6">
      <PageHeading title="Ringkasan" mode={mode} />

      <section aria-label="Angka utama" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="PnL hari ini"
          value={<Pnl lamports={view.realizedTodayLamports} />}
          detail="Terealisasi, setelah biaya"
        />
        <StatCard
          label="PnL 7 hari"
          value={<Pnl lamports={view.realizedWeekLamports} />}
          detail="Terealisasi, setelah biaya"
        />
        <StatCard
          label="PnL total"
          value={<Pnl lamports={view.realizedAllLamports} />}
          detail="Terealisasi sejak awal"
        />
        <StatCard
          label="Estimasi PnL terbuka"
          value={
            unrealized.valuedCount === 0 ? (
              <span className="text-muted">—</span>
            ) : (
              <Pnl lamports={unrealized.totalLamports} />
            )
          }
          detail={
            view.openCount === 0
              ? 'Tidak ada posisi terbuka'
              : unrealized.unvaluedCount === 0
                ? 'Belum terealisasi, dari quote jual terakhir'
                : `Belum terealisasi; ${unrealized.unvaluedCount} posisi tanpa estimasi tidak dihitung`
          }
        />
        <StatCard
          label="Posisi terbuka"
          value={`${view.openCount} / ${view.maxOpen}`}
          detail={`Modal terpakai ${formatSol(view.capitalInUseLamports)}`}
        />
        <StatCard
          label="Win rate"
          value={formatPct(view.winRate)}
          detail={
            view.closedCount === 0
              ? 'Belum ada posisi ditutup'
              : `${view.winCount} dari ${view.closedCount} posisi ditutup untung`
          }
        />
        <StatCard
          label="Sinyal hari ini"
          value={view.signalsToday.accepted + view.signalsToday.rejected}
          detail={`${view.signalsToday.accepted} diikuti · ${view.signalsToday.rejected} dilewati`}
        />
        <StatCard
          label="Biaya 7 hari"
          value={formatSol(view.feesWeekLamports)}
          detail="Fee jaringan + priority; fee DEX sudah di harga"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="PnL terealisasi per hari"
          aside={
            <>
              {formatDayKey(chartRange.key)} – {formatDayKey(series.at(-1)?.key ?? chartRange.key)}{' '}
              · total <Pnl lamports={seriesTotal} />
            </>
          }
        >
          <DailyPnlChart series={series} />
        </Card>
        <Card title="Kill switch" className="lg:self-start">
          <PauseToggle paused={paused} />
        </Card>
      </div>

      <Card
        title="Posisi terbuka"
        aside={
          <Link href={withParams('/positions', modeParam)} className="hover:underline">
            Semua posisi →
          </Link>
        }
      >
        {open.length === 0 ? (
          <EmptyState action={{ href: withParams('/wallets', modeParam), label: 'Kelola wallet' }}>
            Belum ada posisi terbuka. Posisi muncul saat wallet incaran membeli dan sinyalnya lolos
            aturan risiko.
          </EmptyState>
        ) : (
          <OpenPositionsTable items={open} mode={mode} now={now} timeZone={timeZone} />
        )}
      </Card>

      <Card
        title="Sinyal terbaru"
        aside={
          <Link href={withParams('/signals', modeParam)} className="hover:underline">
            Semua sinyal →
          </Link>
        }
      >
        {signals.length === 0 ? (
          <EmptyState action={{ href: withParams('/wallets', modeParam), label: 'Tambah wallet' }}>
            Belum ada sinyal. Sinyal muncul saat wallet incaran melakukan swap.
          </EmptyState>
        ) : (
          <SignalsTable items={signals} mode={mode} timeZone={timeZone} />
        )}
      </Card>
    </div>
  );
}
