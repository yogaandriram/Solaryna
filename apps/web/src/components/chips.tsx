import Link from 'next/link';

/** A row of filter links; the active one is highlighted. */
export function Chips({
  label,
  options,
}: {
  label: string;
  options: { label: string; href: string; active: boolean }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="mr-1 text-muted">{label}</span>
      {options.map((option) => (
        <Link
          key={option.label}
          href={option.href}
          aria-current={option.active ? 'true' : undefined}
          className={`rounded-full border px-3 py-1 ${
            option.active
              ? 'border-accent bg-accent/10 font-medium text-fg'
              : 'border-line text-muted hover:text-fg'
          }`}
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}
