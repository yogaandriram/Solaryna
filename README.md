# Solaryna

Copy-trading tracker untuk Solana: memantau wallet incaran, mengirim alert Telegram saat mereka
beli/jual, menyimulasikan hasilnya (paper trading), dan — hanya bila diaktifkan secara eksplisit —
ikut swap otomatis lewat Jupiter.

> **Bukan saran investasi.** Hasil paper trading tidak menjamin hasil live. Memecoin sangat
> berisiko; Anda bisa kehilangan seluruh modal di wallet bot.

Panduan lengkap arsitektur, aturan keamanan, dan milestone ada di [CLAUDE.md](CLAUDE.md).

## Status

Milestone **M2 (paper trading)**. Bot menerima transaksi wallet incaran (webhook Helius atau
websocket), menormalisasi swap beli/jual, mengirim alert Telegram, lalu **menyimulasikan** apakah
swap itu diikuti: aturan risiko, quote Jupiter nyata, posisi, exit otomatis, dan laporan PnL.
Tidak ada transaksi yang dikirim. Live trading baru ada di M5.

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

| Perintah                      | Fungsi                                          |
| ----------------------------- | ----------------------------------------------- |
| `/list`                       | Daftar wallet incaran aktif                     |
| `/addwallet <alamat> [label]` | Tambah wallet (atau aktifkan kembali)           |
| `/removewallet <alamat>`      | Berhenti memantau; riwayatnya tetap disimpan    |
| `/status`                     | Mode, status jeda, posisi terbuka, PnL hari ini |
| `/positions`                  | Posisi terbuka, modal, umur, estimasi PnL       |
| `/report`                     | Laporan hari ini sejauh ini                     |
| `/report minggu`              | Laporan 7 hari terakhir                         |
| `/pause`                      | Kill switch: jeda semua beli dan exit           |
| `/resume`                     | Lanjutkan trading                               |
| `/help`                       | Bantuan                                         |

`/addwallet`, `/removewallet`, `/pause`, dan `/resume` dicatat di tabel `audit_log`.

## Paper trading

Setiap swap wallet incaran menghasilkan **sinyal** yang selalu disimpan bersama keputusannya.
Alert Telegram swap itu diedit beberapa detik kemudian dengan satu baris keputusan, misalnya
`🧪 Paper: diikuti` atau `🧪 Paper: dilewati — likuiditas $12.300 < $20.000`.

- **Beli:** cek awal (kill switch, posisi terbuka penuh, token sudah dipegang, batas rugi harian,
  blacklist, cooldown wallet, umur sinyal) → tunggu `COPY_DELAY_MS` → data token Jupiter
  (likuiditas, mint/freeze authority, tanda mencurigakan) → quote beli `MAX_SOL_PER_TRADE` dengan
  `MAX_SLIPPAGE_BPS` → cek price impact → kill switch dicek lagi tepat sebelum dicatat.
- **Jual ikut wallet:** bila wallet yang membuka posisi menjual, bot menjual porsi yang sama
  (persentase dari saldo wallet sebelum swap).
- **Exit otomatis:** tiap 30 detik bot meminta quote jual seluruh sisa posisi; take-profit
  (`TAKE_PROFIT_PCT`), stop-loss (`STOP_LOSS_PCT`), atau `MAX_HOLD_MINUTES`. Token tanpa rute jual
  ditutup dengan nilai 0 setelah batas hold.
- **Biaya simulasi** per transaksi: fee jaringan 5.000 lamports + priority fee
  `MAX_PRIORITY_FEE_LAMPORTS`. Fee DEX/platform sudah termasuk di jumlah quote Jupiter dan hanya
  ditampilkan sebagai informasi. PnL selalu dihitung setelah biaya.
- **Kill switch** (`/pause`): sinyal beli dan jual ikut wallet dilewati (tercatat dengan alasan
  `trading dijeda`), exit otomatis menunggu sampai `/resume`. Statusnya disimpan di tabel `settings`, jadi tetap berlaku setelah restart.

Semua quote memakai satu batas rate Jupiter (1 request/detik). Urutannya: jual (exit dan ikut
wallet) dulu, lalu beli, lalu quote pemantauan posisi; quote pemantauan yang menunggu lebih dari
30 detik disetarakan dengan jual.

### Laporan

Laporan harian (hari sebelumnya) dikirim tiap 07.00 WIB, laporan mingguan (Senin–Minggu) tiap
Senin 07.00 WIB. Bila bot mati saat jadwal, laporan terbaru dikirim begitu bot menyala lagi. Pada
start pertama bot hanya mencatat titik awal, tanpa mengirim laporan.

Laporan mingguan menguraikan PnL setiap posisi yang ditutup menjadi:

- **Hasil wallet itu sendiri**: untung/rugi wallet incaran pada trade yang sama, diskalakan ke modal
  kita. Negatif berarti wallet-nya memang rugi.
- **Selisih masuk**: akibat harga beli kita berbeda dari wallet (jeda copy dan slippage).
- **Selisih keluar**: akibat kita keluar lebih cepat atau lebih lambat dari wallet (TP/SL/max hold).
- **Biaya**: fee jaringan + priority fee.

Rumus lengkapnya ada di [packages/core/src/pnl/README.md](packages/core/src/pnl/README.md). Bila
harga masuk wallet tidak bisa dihitung, posisi itu ditandai "tidak tersedia".

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
apps/bot          proses utama (24 jam): ingest, engine paper trading, exit, laporan, Telegram
packages/core     logika murni tanpa I/O: parser swap, risiko, PnL & laporan, waktu, format angka
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
