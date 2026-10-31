import type { ReactNode } from 'react';

/** A titled section card. */
export function Card({
  title,
  aside,
  children,
  className = '',
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-surface ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
        {aside !== undefined && <div className="text-sm text-muted">{aside}</div>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}
