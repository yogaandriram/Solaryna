import { describeRiskReason, type TradingMode } from '@solaryna/core';
import type { DashboardSignal } from '@solaryna/db';
import Link from 'next/link';
import { formatDateTime, formatQuoteAmount, tokenLabel, walletName } from '../lib/format';
import { withParams } from '../lib/params';
import { DecisionBadge, SideBadge } from './badges';

const TH = 'px-3 py-2 font-medium whitespace-nowrap';
const TD = 'px-3 py-2 align-top';

export function SignalsTable({
  items,
  mode,
  timeZone,
}: {
  items: readonly DashboardSignal[];
  mode: TradingMode;
  timeZone: string;
}) {
  const modeParam = { mode: mode === 'live' ? 'live' : undefined };
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className={TH}>Waktu</th>
            <th className={`${TH} hidden sm:table-cell`}>Wallet</th>
            <th className={TH}>Swap</th>
            <th className={`${TH} hidden text-right md:table-cell`}>Jumlah wallet</th>
            <th className={TH}>Keputusan</th>
            <th className={`${TH} hidden lg:table-cell`}>Alasan</th>
          </tr>
        </thead>
        <tbody>
          {items.map((signal) => {
            const reasons =
              signal.reasons.length === 0
                ? null
                : signal.reasons.map((reason) => describeRiskReason(reason, timeZone)).join('; ');
            return (
              <tr key={signal.id} className="border-t border-line">
                <td className={`${TD} whitespace-nowrap text-muted tabular-nums`}>
                  <a
                    href={`https://solscan.io/tx/${signal.signature}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                    title="Lihat transaksi wallet di Solscan"
                  >
                    {formatDateTime(signal.createdAt, timeZone)}
                  </a>
                </td>
                <td className={`${TD} hidden whitespace-nowrap sm:table-cell`}>
                  <Link
                    href={withParams(`/wallets/${signal.walletId}`, modeParam)}
                    className="hover:underline"
                  >
                    {walletName(signal.walletLabel, signal.walletAddress)}
                  </Link>
                </td>
                <td className={`${TD} whitespace-nowrap`}>
                  <SideBadge side={signal.side} />{' '}
                  <span className="font-medium">
                    {tokenLabel(signal.tokenSymbol, signal.tokenMint)}
                  </span>
                </td>
                <td
                  className={`${TD} hidden text-right whitespace-nowrap tabular-nums md:table-cell`}
                >
                  {formatQuoteAmount(signal.quoteAmountRaw, signal.quoteDecimals, signal.quoteMint)}
                </td>
                <td className={TD}>
                  <DecisionBadge decision={signal.decision} />
                  {reasons !== null && (
                    <p className="mt-1 min-w-40 text-xs text-muted lg:hidden">{reasons}</p>
                  )}
                </td>
                <td className={`${TD} hidden text-muted lg:table-cell`}>{reasons ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
