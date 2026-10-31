# Solaryna

Copy-trading tracker untuk Solana: memantau wallet incaran, mengirim alert Telegram saat mereka
beli/jual, menyimulasikan hasilnya (paper trading), dan — hanya bila diaktifkan secara eksplisit —
ikut swap otomatis lewat Jupiter.

> **Bukan saran investasi.** Hasil paper trading tidak menjamin hasil live. Memecoin sangat
> berisiko; Anda bisa kehilangan seluruh modal di wallet bot.

Panduan lengkap arsitektur, aturan keamanan, dan milestone ada di [CLAUDE.md](CLAUDE.md).

## Status

Milestone **M0 (scaffold)**. Belum ada ingest, alert, atau trading. Bot baru memvalidasi
konfigurasi, mengecek koneksi database, lalu menunggu.

## Prasyarat

- Node.js 22 LTS (>= 22.13)
- MySQL 8 (bawaan Laragon) di `127.0.0.1:3306`

## Setup lokal

```bash
npm install
copy .env.example .env      # PowerShell/cmd; di Git Bash: cp .env.example .env
# isi .env sendiri (API key, token Telegram, dll.)
npm run db:create           # buat database dari DATABASE_URL (utf8mb4)
npm run db:migrate          # terapkan migrasi
npm run dev:bot             # jalankan bot (default mode paper)
```

Bot **menolak start** jika ada variabel `.env` yang wajib tapi kosong atau tidak valid, dan
menampilkan daftar kunci yang bermasalah (tanpa menampilkan nilainya).

## Perintah

| Perintah              | Fungsi                                                             |
| --------------------- | ------------------------------------------------------------------ |
| `npm run dev:bot`     | Jalankan bot dengan auto-reload                                    |
| `npm run db:create`   | Buat database jika belum ada                                       |
| `npm run db:generate` | Buat file migrasi dari skema Drizzle (`packages/db/src/schema.ts`) |
| `npm run db:migrate`  | Terapkan migrasi ke MySQL                                          |
| `npm run test`        | Unit test (vitest)                                                 |
| `npm run typecheck`   | `tsc --noEmit` semua workspace                                     |
| `npm run lint`        | ESLint                                                             |
| `npm run format`      | Prettier                                                           |

## Struktur

```
apps/bot          proses utama (24 jam)
packages/core     logika murni tanpa I/O: tipe domain, konversi jumlah, (nanti) risiko/skor/PnL
packages/config   skema env (zod), loader .env, Secret, resolver mode trading
packages/db       skema Drizzle, migrasi, client MySQL
```

## Keamanan

- **Mode default selalu paper.** Live butuh `TRADING_MODE=live` **dan**
  `LIVE_TRADING_ACKNOWLEDGED=true` **dan** private key valid — dan executor live baru ada di M5.
  Sampai saat itu bot selalu jalan sebagai paper.
- **Pakai hot wallet khusus bot dengan modal kecil**, jangan wallet utama Anda.
- `.env` tidak pernah di-commit. Semua API key, token, dan private key dibungkus `Secret` dan
  di-redact dari log.
