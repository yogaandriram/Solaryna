import type { Decimal, TradingMode } from '@solaryna/core';
import type { DashboardPosition } from '@solaryna/db';
import Link from 'next/link';
import { formatDateTime, formatDuration, formatSol, tokenLabel, walletName } from '../lib/format';
import { withParams } from '../lib/params';
import { positionRow } from '../lib/positions';
import { Pnl, PnlPct } from './pnl';

export const TH = 'px-3 py-2 font-medium whitespace-nowrap';
export const TD = 'px-3 py-2 whitespace-nowrap';

const modeParams = (mode: TradingMode) => ({ mode: mode === 'live' ? 'live' : undefined });

function TokenCell({ item, mode }: { item: DashboardPosition; mode: TradingMode }) {
  return (
    <Link
      href={withParams(`/positions/${item.position.id}`, modeParams(mode))}
      className="font-medium hover:underline"
    >
      {tokenLabel(item.tokenSymbol, item.position.tokenMint)}
    </Link>
  );
}

function WalletCell({ item, mode }: { item: DashboardPosition; mode: TradingMode }) {
  if (item.walletId === null || item.walletAddress === null) {
    return <span className="text-muted">—</span>;
  }
  return (
    <Link
      href={withParams(`/wallets/${item.walletId}`, modeParams(mode))}
      className="hover:underline"
    >
      {walletName(item.walletLabel, item.walletAddress)}
    </Link>
  );
}

function PnlCell({ pnl, pct }: { pnl: bigint | null; pct: Decimal | null }) {
  return pnl === null ? (
    <span className="text-muted">—</span>
  ) : (
    <>
      <Pnl lamports={pnl} /> <PnlPct value={pct} className="text-xs" />
    </>
  );
}

export function OpenPositionsTable({
  items,
  mode,
  now,
  timeZone,
}: {
  items: readonly DashboardPosition[];
  mode: TradingMode;
  now: Date;
  timeZone: string;
}) {
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className={TH}>Token</th>
            <th className={`${TH} hidden md:table-cell`}>Wallet</th>
            <th className={`${TH} text-right`}>Modal</th>
            <th className={`${TH} hidden text-right md:table-cell`}>Nilai terakhir</th>
            <th className={`${TH} text-right`}>Estimasi PnL</th>
            <th className={`${TH} text-right`}>Umur</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {items.map((item) => {
            const row = positionRow(item, now);
            const { position } = item;
            const valuedAt =
              position.lastValuedAt === null
                ? undefined
                : `Dinilai ${formatDateTime(position.lastValuedAt, timeZone)}`;
            return (
              <tr key={position.id} className="border-t border-line">
                <td className={TD}>
                  <TokenCell item={item} mode={mode} />
                </td>
                <td className={`${TD} hidden md:table-cell`}>
                  <WalletCell item={item} mode={mode} />
                </td>
                <td className={`${TD} text-right`}>{formatSol(row.costLamports)}</td>
                <td className={`${TD} hidden text-right md:table-cell`} title={valuedAt}>
                  {row.valueLamports === null ? (
                    <span className="text-muted">
                      {position.lastValuedAt === null ? 'Belum dinilai' : 'Tidak ada rute'}
                    </span>
                  ) : (
                    formatSol(row.valueLamports)
                  )}
                </td>
                <td className={`${TD} text-right`} title={valuedAt}>
                  <PnlCell pnl={row.pnlLamports} pct={row.pnlPct} />
                </td>
                <td className={`${TD} text-right text-muted`}>{formatDuration(row.ageMs)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ClosedPositionsTable({
  items,
  mode,
  now,
  timeZone,
}: {
  items: readonly DashboardPosition[];
  mode: TradingMode;
  now: Date;
  timeZone: string;
}) {
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className={TH}>Ditutup</th>
            <th className={TH}>Token</th>
            <th className={`${TH} hidden lg:table-cell`}>Wallet</th>
            <th className={`${TH} hidden text-right md:table-cell`}>Modal</th>
            <th className={`${TH} hidden text-right md:table-cell`}>Hasil jual</th>
            <th className={`${TH} hidden text-right lg:table-cell`}>Biaya</th>
            <th className={`${TH} text-right`}>PnL</th>
            <th className={`${TH} hidden md:table-cell`}>Alasan</th>
            <th className={`${TH} hidden text-right sm:table-cell`}>Durasi</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {items.map((item) => {
            const row = positionRow(item, now);
            const { position } = item;
            return (
              <tr key={position.id} className="border-t border-line">
                <td className={`${TD} text-muted`}>
                  {position.closedAt === null ? '—' : formatDateTime(position.closedAt, timeZone)}
                </td>
                <td className={TD}>
                  <TokenCell item={item} mode={mode} />
                </td>
                <td className={`${TD} hidden lg:table-cell`}>
                  <WalletCell item={item} mode={mode} />
                </td>
                <td className={`${TD} hidden text-right md:table-cell`}>
                  {formatSol(row.costLamports)}
                </td>
                <td className={`${TD} hidden text-right md:table-cell`}>
                  {row.valueLamports === null ? '—' : formatSol(row.valueLamports)}
                </td>
                <td className={`${TD} hidden text-right text-muted lg:table-cell`}>
                  {formatSol(position.feesLamports)}
                </td>
                <td className={`${TD} text-right`}>
                  <PnlCell pnl={row.pnlLamports} pct={row.pnlPct} />
                </td>
                <td className={`${TD} hidden text-muted md:table-cell`}>
                  {row.closeReasonLabel ?? '—'}
                </td>
                <td className={`${TD} hidden text-right text-muted sm:table-cell`}>
                  {row.durationMs === null ? '—' : formatDuration(row.durationMs)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
