# Solaryna

Copy-trading tracker untuk Solana: memantau wallet incaran, mengirim alert Telegram saat mereka
beli/jual, menyimulasikan hasilnya (paper trading), dan — hanya bila diaktifkan secara eksplisit —
ikut swap otomatis lewat Jupiter.

> **Bukan saran investasi.** Hasil paper trading tidak menjamin hasil live. Memecoin sangat
> berisiko; Anda bisa kehilangan seluruh modal di wallet bot.

Panduan lengkap arsitektur, aturan keamanan, dan milestone ada di [CLAUDE.md](CLAUDE.md).

## Status

Milestone **M1 (ingest + alert)**. Bot menerima transaksi wallet incaran (webhook Helius atau
websocket), menormalisasi swap beli/jual, menyimpannya, dan mengirim alert Telegram. Belum ada
paper/live trading — itu M2 dan M5.

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
menampilkan daftar kunci yang bermasalah (tanpa menampilkan nilainya). Bot juga menolak start
jika webhook Helius tidak ditemukan atau bukan tipe raw.

## Telegram

1. Buat bot lewat [@BotFather](https://t.me/BotFather), isi `TELEGRAM_BOT_TOKEN`.
2. Kirim pesan apa saja ke bot Anda, lalu buka
   `https://api.telegram.org/bot<TOKEN>/getUpdates` di browser untuk melihat `chat.id`.
3. Isi `TELEGRAM_ALLOWED_CHAT_IDS` (pisahkan koma bila lebih dari satu). Chat lain diabaikan.

Perintah bot:

| Perintah                      | Fungsi                                       |
| ----------------------------- | -------------------------------------------- |
| `/list`                       | Daftar wallet incaran aktif                  |
| `/addwallet <alamat> [label]` | Tambah wallet (atau aktifkan kembali)        |
| `/removewallet <alamat>`      | Berhenti memantau; riwayatnya tetap disimpan |
| `/help`                       | Bantuan                                      |

`/addwallet` dan `/removewallet` dicatat di tabel `audit_log`.

## Sumber event

### Webhook Helius (`INGEST_SOURCE=webhook`)

Butuh URL HTTPS publik. Saat development, pakai tunnel:

```bash
cloudflared tunnel --url http://localhost:8787
```

1. Di dashboard Helius, buat webhook **mainnet** bertipe **raw**, transaction type "any",
   dengan URL `https://<alamat-tunnel>/webhooks/helius` dan satu alamat wallet apa saja
   (Helius butuh minimal satu alamat).
2. Salin ID webhook ke `HELIUS_WEBHOOK_ID`, dan isi `HELIUS_WEBHOOK_SECRET` dengan teks acak
   minimal 16 karakter.
3. Jalankan bot. Bot mengganti daftar alamat webhook dengan wallet incaran aktif dan memasang
   `HELIUS_WEBHOOK_SECRET` sebagai authHeader. Setelah itu daftar disinkronkan tiap menit, tapi
   hanya diubah bila ada perubahan (setiap edit webhook memakai kredit Helius).

URL quick tunnel cloudflared berubah setiap dijalankan; perbarui URL webhook di dashboard Helius
bila berganti. Bot tidak mengubah URL maupun tipe webhook.

### Websocket (`INGEST_SOURCE=websocket`)

Tidak butuh URL publik: bot berlangganan `logsSubscribe` per wallet lewat `SOLANA_RPC_URL`
(`https` otomatis jadi `wss`), lalu mengambil detail transaksi dengan `getTransaction`. Cocok
untuk development; untuk 24 jam lebih andal pakai webhook.

## Impor wallet

Salin daftar wallet (mis. dari GMGN) ke file teks, satu wallet per baris, alamat lalu label
opsional. Baris kosong dan baris `#` diabaikan; pemisah boleh spasi, koma, atau titik koma.

```text
# wallets.txt
7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU  smart money 1
9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM, ape king
```

```bash
npm run wallets:import -- wallets.txt
```

Bot yang sedang jalan memuat wallet baru dalam satu menit. File `wallets*.txt` diabaikan git.

## Perintah

| Perintah                                      | Fungsi                                                             |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `npm run dev:bot`                             | Jalankan bot dengan auto-reload                                    |
| `npm run db:create`                           | Buat database jika belum ada                                       |
| `npm run db:generate`                         | Buat file migrasi dari skema Drizzle (`packages/db/src/schema.ts`) |
| `npm run db:migrate`                          | Terapkan migrasi ke MySQL                                          |
| `npm run wallets:import -- <file>`            | Impor wallet incaran dari file teks                                |
| `npm run fixture:fetch -- <signature> <nama>` | Simpan transaksi mainnet sebagai fixture test parser               |
| `npm run test`                                | Unit test (vitest)                                                 |
| `npm run typecheck`                           | `tsc --noEmit` semua workspace                                     |
| `npm run lint`                                | ESLint                                                             |
| `npm run format`                              | Prettier                                                           |

## Struktur

```
apps/bot          proses utama (24 jam): ingest, Telegram, sinkron wallet
packages/core     logika murni tanpa I/O: parser swap, format angka, (nanti) risiko/skor/PnL
packages/config   skema env (zod), loader .env, Secret, resolver mode trading
packages/db       skema Drizzle, migrasi, client MySQL, query bersama
scripts           impor wallet, ambil fixture transaksi
```

## Test

`npm run test` menjalankan unit test tanpa jaringan. Test integrasi database (`packages/db`) hanya
jalan bila `TEST_DATABASE_URL` diisi, dan nama database-nya harus mengandung `test` karena
semua tabel dikosongkan:

```bash
# Git Bash
DATABASE_URL=mysql://root:@127.0.0.1:3306/solaryna_test npm run db:create
TEST_DATABASE_URL=mysql://root:@127.0.0.1:3306/solaryna_test npm run test
```

Di PowerShell: `$env:TEST_DATABASE_URL="mysql://root:@127.0.0.1:3306/solaryna_test"; npm run test`.

## Keamanan

- **Mode default selalu paper.** Live butuh `TRADING_MODE=live` **dan**
  `LIVE_TRADING_ACKNOWLEDGED=true` **dan** private key valid — dan executor live baru ada di M5.
  Sampai saat itu bot selalu jalan sebagai paper.
- **Pakai hot wallet khusus bot dengan modal kecil**, jangan wallet utama Anda.
- `.env` tidak pernah di-commit. Semua API key, token, dan private key dibungkus `Secret` dan
  di-redact dari log.
