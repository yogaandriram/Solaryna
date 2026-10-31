import type { ReactNode } from 'react';

export function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight break-words sm:text-2xl">{value}</p>
      {detail !== undefined && <p className="mt-1 text-xs text-muted">{detail}</p>}
    </div>
  );
}
