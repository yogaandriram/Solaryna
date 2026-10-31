'use client';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">Terjadi kesalahan</h1>
      <p className="text-sm text-muted">
        Halaman ini gagal dimuat. Periksa apakah MySQL berjalan, lalu coba lagi.
        {error.digest !== undefined && <> Kode: {error.digest}</>}
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90"
      >
        Coba lagi
      </button>
    </main>
  );
}
