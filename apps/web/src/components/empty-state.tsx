import Link from 'next/link';
import type { ReactNode } from 'react';

export function EmptyState({
  children,
  action,
}: {
  children: ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
      <p>{children}</p>
      {action !== undefined && (
        <Link
          href={action.href}
          className="mt-2 inline-block font-medium text-accent hover:underline"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
