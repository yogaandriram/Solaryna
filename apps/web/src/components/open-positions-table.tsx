import { positionStateOf, remainingCostLamports, type TradingMode } from '@solaryna/core';
import type { DashboardPosition } from '@solaryna/db';
import Link from 'next/link';
import {
  formatDateTime,
  formatDuration,
  formatSol,
  pnlPct,
  tokenLabel,
  walletName,
} from '../lib/format';
import { positionEstimate } from '../lib/overview';
import { withParams } from '../lib/params';
import { Pnl, PnlPct } from './pnl';

const TH = 'px-3 py-2 font-medium whitespace-nowrap';
const TD = 'px-3 py-2 whitespace-nowrap';

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
  const modeParam = { mode: mode === 'live' ? 'live' : undefined };
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className={TH}>Token</th>
            <th className={`${TH} hidden sm:table-cell`}>Wallet</th>
            <th className={`${TH} text-right`}>Modal</th>
            <th className={`${TH} hidden text-right md:table-cell`}>Nilai terakhir</th>
            <th className={`${TH} text-right`}>Estimasi PnL</th>
            <th className={`${TH} text-right`}>Umur</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {items.map(({ position, tokenSymbol, walletId, walletAddress, walletLabel }) => {
            const cost = remainingCostLamports(positionStateOf(position));
            const estimate = positionEstimate(position);
            const valuedAt =
              position.lastValuedAt === null
                ? undefined
                : `Dinilai ${formatDateTime(position.lastValuedAt, timeZone)}`;
            return (
              <tr key={position.id} className="border-t border-line">
                <td className={TD}>
                  <Link
                    href={withParams(`/positions/${position.id}`, modeParam)}
                    className="font-medium hover:underline"
                  >
                    {tokenLabel(tokenSymbol, position.tokenMint)}
                  </Link>
                </td>
                <td className={`${TD} hidden sm:table-cell`}>
                  {walletId === null || walletAddress === null ? (
                    <span className="text-muted">—</span>
                  ) : (
                    <Link
                      href={withParams(`/wallets/${walletId}`, modeParam)}
                      className="hover:underline"
                    >
                      {walletName(walletLabel, walletAddress)}
                    </Link>
                  )}
                </td>
                <td className={`${TD} text-right`}>{formatSol(cost)}</td>
                <td className={`${TD} hidden text-right md:table-cell`} title={valuedAt}>
                  {position.lastValueLamports === null ? (
                    <span className="text-muted">
                      {position.lastValuedAt === null ? 'Belum dinilai' : 'Tidak ada rute'}
                    </span>
                  ) : (
                    formatSol(position.lastValueLamports)
                  )}
                </td>
                <td className={`${TD} text-right`} title={valuedAt}>
                  {estimate === null ? (
                    <span className="text-muted">—</span>
                  ) : (
                    <>
                      <Pnl lamports={estimate} />{' '}
                      <PnlPct value={pnlPct(estimate, cost)} className="text-xs" />
                    </>
                  )}
                </td>
                <td className={`${TD} text-right text-muted`}>
                  {formatDuration(now.getTime() - position.openedAt.getTime())}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
