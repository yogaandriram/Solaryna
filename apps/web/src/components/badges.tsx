import type { SwapSide, TradingMode } from '@solaryna/core';
import type { ReactNode } from 'react';

const BASE = 'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold';

function Badge({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`${BASE} ${className}`}>{children}</span>;
}

/** PAPER in amber, LIVE in red: every page says which mode its numbers belong to. */
export function ModeBadge({ mode }: { mode: TradingMode }) {
  return mode === 'paper' ? (
    <Badge className="bg-paper-soft text-paper tracking-wide">PAPER</Badge>
  ) : (
    <Badge className="bg-live-soft text-live tracking-wide">LIVE</Badge>
  );
}

export function DecisionBadge({ decision }: { decision: 'accepted' | 'rejected' }) {
  return decision === 'accepted' ? (
    <Badge className="bg-positive/10 text-positive">✓ Diikuti</Badge>
  ) : (
    <Badge className="bg-surface-muted text-muted">✕ Dilewati</Badge>
  );
}

export function SideBadge({ side }: { side: SwapSide }) {
  return side === 'buy' ? (
    <Badge className="bg-positive/10 text-positive">Beli</Badge>
  ) : (
    <Badge className="bg-negative/10 text-negative">Jual</Badge>
  );
}

export function PausedBadge({ paused }: { paused: boolean }) {
  return paused ? (
    <Badge className="bg-live-soft text-live">⏸ Dijeda</Badge>
  ) : (
    <Badge className="bg-positive/10 text-positive">● Berjalan</Badge>
  );
}
