import { tradeReasonLabel, type TradingMode } from '@solaryna/core';
import type { TradeRow } from '@solaryna/db';
import Link from 'next/link';
import {
  formatDateTime,
  formatPriceSol,
  formatSol,
  formatTokenAmount,
  tokenLabel,
} from '../lib/format';
import { withParams } from '../lib/params';
import { SideBadge } from './badges';
import { Pnl } from './pnl';
import { TD, TH } from './position-tables';

const STATUS_LABELS: Record<TradeRow['status'], string> = {
  simulated: 'simulasi',
  pending: 'menunggu',
  confirmed: 'terkonfirmasi',
  failed: 'gagal',
};

/**
 * Trades with their fee breakdown. Network and priority fees are paid on top of the SOL amount;
 * the DEX fee is already inside the quoted SOL amount.
 */
export function TradeTable({
  items,
  mode,
  timeZone,
  showToken = true,
}: {
  items: readonly { trade: TradeRow; tokenSymbol: string | null }[];
  mode: TradingMode;
  timeZone: string;
  showToken?: boolean;
}) {
  const showTx = mode === 'live';
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className={TH}>Waktu</th>
            {showToken && <th className={TH}>Token</th>}
            <th className={TH}>Aksi</th>
            <th className={`${TH} hidden text-right xl:table-cell`}>Jumlah token</th>
            <th className={`${TH} text-right`}>SOL</th>
            <th className={`${TH} hidden text-right xl:table-cell`}>Harga</th>
            <th className={`${TH} hidden text-right lg:table-cell`}>Fee jaringan</th>
            <th className={`${TH} hidden text-right lg:table-cell`}>Priority fee</th>
            <th className={`${TH} hidden text-right lg:table-cell`}>Fee DEX</th>
            <th className={`${TH} hidden text-right xl:table-cell`}>Slippage</th>
            <th className={`${TH} text-right`}>PnL terealisasi</th>
            {showTx && <th className={TH}>Transaksi</th>}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {items.map(({ trade, tokenSymbol }) => (
            <tr key={trade.id} className="border-t border-line">
              <td className={`${TD} text-muted`}>{formatDateTime(trade.executedAt, timeZone)}</td>
              {showToken && (
                <td className={TD}>
                  <Link
                    href={withParams(`/positions/${trade.positionId}`, {
                      mode: mode === 'live' ? 'live' : undefined,
                    })}
                    className="font-medium hover:underline"
                  >
                    {tokenLabel(tokenSymbol, trade.tokenMint)}
                  </Link>
                </td>
              )}
              <td className={TD}>
                <SideBadge side={trade.side} />{' '}
                <span className="text-muted">{tradeReasonLabel(trade.reason)}</span>
                {trade.status !== 'simulated' && trade.status !== 'confirmed' && (
                  <span className="ml-1 text-xs text-negative">
                    ({STATUS_LABELS[trade.status]})
                  </span>
                )}
                <p className="mt-1 min-w-44 text-xs text-muted lg:hidden">
                  Fee jaringan {formatSol(trade.networkFeeLamports)} · priority{' '}
                  {formatSol(trade.priorityFeeLamports)} · DEX {formatSol(trade.dexFeeLamports)}
                </p>
              </td>
              <td className={`${TD} hidden text-right xl:table-cell`}>
                {formatTokenAmount(trade.tokenAmountRaw, trade.tokenDecimals)}
              </td>
              <td className={`${TD} text-right`}>{formatSol(trade.solAmountLamports)}</td>
              <td className={`${TD} hidden text-right text-muted xl:table-cell`}>
                {formatPriceSol(trade.priceSol)}
              </td>
              <td className={`${TD} hidden text-right text-muted lg:table-cell`}>
                {formatSol(trade.networkFeeLamports)}
              </td>
              <td className={`${TD} hidden text-right text-muted lg:table-cell`}>
                {formatSol(trade.priorityFeeLamports)}
              </td>
              <td className={`${TD} hidden text-right text-muted lg:table-cell`}>
                {formatSol(trade.dexFeeLamports)}
              </td>
              <td className={`${TD} hidden text-right text-muted xl:table-cell`}>
                {trade.slippageBps === null ? '—' : `${trade.slippageBps} bps`}
              </td>
              <td className={`${TD} text-right`}>
                {trade.realizedPnlLamports === null ? (
                  <span className="text-muted">—</span>
                ) : (
                  <Pnl lamports={trade.realizedPnlLamports} />
                )}
              </td>
              {showTx && (
                <td className={TD}>
                  {trade.txSignature === null ? (
                    <span className="text-muted">—</span>
                  ) : (
                    <a
                      href={`https://solscan.io/tx/${trade.txSignature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      Solscan ↗
                    </a>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
