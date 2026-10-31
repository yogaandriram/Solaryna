import type { DailyPnl } from '@solaryna/core';
import { columnScale, formatSolTick, lamportsToSol } from '../lib/chart';
import { formatDayKey, formatSignedSol } from '../lib/format';
import { EmptyState } from './empty-state';
import { Pnl } from './pnl';

// Daily realized PnL as columns around a zero baseline. Pure HTML/CSS: each column is its own
// hover/focus target with a tooltip, and the same values are in the table below the chart.

const PLOT_HEIGHT = 'h-48';

function tooltipAlign(index: number, count: number): string {
  if (index < 3) return 'left-0';
  if (index >= count - 3) return 'right-0';
  return 'left-1/2 -translate-x-1/2';
}

export function DailyPnlChart({ series }: { series: DailyPnl[] }) {
  const scale = columnScale(series.map((day) => lamportsToSol(day.pnlLamports)));
  if (scale === null) {
    return (
      <EmptyState>Belum ada posisi yang ditutup dalam {series.length} hari terakhir.</EmptyState>
    );
  }
  const zero = scale.position(0);

  return (
    <figure>
      <div className="flex">
        <div aria-hidden className={`relative w-12 shrink-0 ${PLOT_HEIGHT}`}>
          {scale.ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-2 -translate-y-1/2 text-[11px] text-muted tabular-nums"
              style={{ top: `${scale.position(tick)}%` }}
            >
              {formatSolTick(tick, scale.step)}
            </span>
          ))}
        </div>
        <div className={`relative flex-1 ${PLOT_HEIGHT}`}>
          {scale.ticks.map((tick) => (
            <div
              key={tick}
              aria-hidden
              className={`absolute inset-x-0 h-px ${tick === 0 ? 'bg-muted/60' : 'bg-line'}`}
              style={{ top: `${scale.position(tick)}%` }}
            />
          ))}
          <ol className="absolute inset-0 flex">
            {series.map((day, index) => {
              const value = scale.position(lamportsToSol(day.pnlLamports));
              const gain = day.pnlLamports > 0n;
              const label = formatDayKey(day.key);
              return (
                <li
                  key={day.key}
                  tabIndex={0}
                  aria-label={`${label}: ${formatSignedSol(day.pnlLamports)}`}
                  className="group relative flex-1 outline-none"
                >
                  {day.pnlLamports !== 0n && (
                    <div
                      aria-hidden
                      className={`absolute left-1/2 min-h-0.5 w-[calc(100%-2px)] max-w-6 -translate-x-1/2 group-hover:opacity-75 group-focus-visible:opacity-75 ${
                        gain ? 'rounded-t-[4px] bg-gain' : 'rounded-b-[4px] bg-loss'
                      }`}
                      style={
                        gain
                          ? { top: `${value}%`, height: `${zero - value}%` }
                          : { top: `${zero}%`, height: `${value - zero}%` }
                      }
                    />
                  )}
                  <div
                    className={`pointer-events-none absolute top-0 z-10 hidden rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md group-hover:block group-focus-visible:block ${tooltipAlign(index, series.length)}`}
                  >
                    <Pnl lamports={day.pnlLamports} className="font-semibold" />
                    <div className="text-muted">{label}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <ol aria-hidden className="ml-12 flex pt-1">
        {series.map((day) => (
          <li key={day.key} className="flex-1 text-center text-[10px] text-muted tabular-nums">
            {Number(day.key.slice(8))}
          </li>
        ))}
      </ol>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted hover:text-fg">Lihat sebagai tabel</summary>
        <table className="mt-2 w-full max-w-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1 font-medium">Tanggal (WIB)</th>
              <th className="py-1 text-right font-medium">PnL terealisasi</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {series.map((day) => (
              <tr key={day.key} className="border-t border-line">
                <td className="py-1">{formatDayKey(day.key)}</td>
                <td className="py-1 text-right">
                  <Pnl lamports={day.pnlLamports} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
