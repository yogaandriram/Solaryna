import type { TradingMode } from '@solaryna/core';
import { ModeBadge } from './badges';

export function PageHeading({ title, mode }: { title: string; mode?: TradingMode }) {
  return (
    <div className="mb-4 space-y-3">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {mode !== undefined && <ModeBadge mode={mode} />}
      </div>
      {mode === 'live' && <LiveNotice />}
    </div>
  );
}

/** Shown on every live page: live trading cannot be switched on from the dashboard. */
export function LiveNotice() {
  return (
    <p className="rounded-lg border border-live/30 bg-live-soft px-3 py-2 text-sm text-live">
      Mode live belum aktif. Mode live hanya bisa dinyalakan lewat file .env lalu restart bot, tidak
      dari dashboard. Data live ditampilkan terpisah dan tidak pernah dijumlahkan dengan paper.
    </p>
  );
}
