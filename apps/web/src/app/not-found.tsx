import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">Halaman tidak ditemukan</h1>
      <p className="text-sm text-muted">Data yang dicari tidak ada atau sudah dihapus.</p>
      <Link href="/" className="text-sm font-medium text-accent hover:underline">
        Kembali ke Ringkasan
      </Link>
    </main>
  );
}
