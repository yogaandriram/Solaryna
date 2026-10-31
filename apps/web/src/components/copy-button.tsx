'use client';

import { useState } from 'react';

/** Copies a value (an address or mint) to the clipboard. */
export function CopyButton({ value, label = 'Salin' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => setCopied(false),
        );
      }}
      className="rounded-md border border-line px-2 py-0.5 text-xs text-muted hover:text-fg"
    >
      {copied ? 'Tersalin' : label}
    </button>
  );
}
