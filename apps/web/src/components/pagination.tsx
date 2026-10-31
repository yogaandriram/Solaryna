import Link from 'next/link';
import { withParams } from '../lib/params';

type Params = Record<string, string | number | undefined>;

const LINK = 'rounded-lg border border-line px-3 py-1.5 hover:bg-surface-muted';

/** Previous/next links that keep the other query params. */
export function Pagination({
  path,
  params,
  page,
  hasNext,
}: {
  path: string;
  params: Params;
  page: number;
  hasNext: boolean;
}) {
  if (page === 1 && !hasNext) {
    return null;
  }
  const href = (target: number) =>
    withParams(path, { ...params, page: target > 1 ? target : undefined });
  return (
    <nav aria-label="Halaman" className="mt-4 flex items-center justify-between text-sm">
      {page > 1 ? (
        <Link href={href(page - 1)} className={LINK}>
          ← Sebelumnya
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted">Halaman {page}</span>
      {hasNext ? (
        <Link href={href(page + 1)} className={LINK}>
          Berikutnya →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
