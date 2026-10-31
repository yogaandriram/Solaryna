import type { Decimal } from '@solaryna/core';
import { formatPct, formatSignedSol, pnlTone, type PnlTone } from '../lib/format';

export const TONE_CLASS: Record<PnlTone, string> = {
  pos: 'text-positive',
  neg: 'text-negative',
  zero: 'text-muted',
};

/** Signed SOL PnL; the sign is always written, the color only repeats it. */
export function Pnl({ lamports, className = '' }: { lamports: bigint; className?: string }) {
  return (
    <span className={`${TONE_CLASS[pnlTone(lamports)]} ${className}`}>
      {formatSignedSol(lamports)}
    </span>
  );
}

export function PnlPct({ value, className = '' }: { value: Decimal | null; className?: string }) {
  const tone: PnlTone =
    value === null || value.isZero() ? 'zero' : value.isNegative() ? 'neg' : 'pos';
  return <span className={`${TONE_CLASS[tone]} ${className}`}>{formatPct(value, true)}</span>;
}
