# CLAUDE.md — Solaryna

Panduan ini dibaca Claude Code setiap kali bekerja di repo ini. Ikuti isinya, terutama bagian **Aturan keamanan** — bagian itu tidak boleh dilanggar walaupun ada permintaan untuk "mempercepat" atau "sementara saja".

## Ringkasan proyek

Solaryna adalah **copy-trading tracker untuk Solana**: memantau wallet yang terbukti profit ("wallet incaran"), mengirim alert saat mereka beli/jual, menyimulasikan hasil jika transaksinya diikuti (paper trading), dan — bila diaktifkan — ikut membeli/menjual otomatis lewat **Jupiter Swap API**.

Sistem punya dua alur:

1. **Penemuan wallet (berkala, mis. harian)**
   Histori swap Solana (Helius/Birdeye) → hitung PnL per wallet → saring wallet curang (insider, bundler, sniper bot) → daftar wallet incaran (20–50 terbaik). Hasil paper/live trading diumpankan balik ke skor.
2. **Copy trade real-time (terus-menerus)**
   Wallet incaran swap → Helius webhook → normalisasi jadi `SwapEvent` → mesin aturan risiko → mode **paper** (simulasi) atau **live** (swap via Jupiter) → notifikasi Telegram + catat ke database → tampil di dashboard.

**Status:** M0 (scaffold) dan M1 (ingest + alert) selesai; berikutnya M2 (paper trading). Bangun bertahap mengikuti bagian **Milestone**. Jangan loncat ke mode live sebelum milestone paper trading selesai dan teruji.

## Bahasa

- Balas pengguna dalam **Bahasa Indonesia**.
- Kode, nama variabel, nama tabel, dan pesan commit dalam **bahasa Inggris**.
- Teks yang dilihat pengguna (pesan Telegram, label dashboard) dalam Bahasa Indonesia.
- Waktu disimpan dalam **UTC**; ditampilkan dalam **WIB (Asia/Jakarta)**.

## Stack

| Bagian | Pilihan |
|---|---|
| Runtime | Node.js 22 LTS, TypeScript 6.0 (`strict: true`; TS 7 belum didukung typescript-eslint), dijalankan dengan `tsx` |
| Monorepo | npm workspaces |
| Database | MySQL 8 (bawaan Laragon) + Drizzle ORM & drizzle-kit |
| Server webhook & API | Fastify |
| Bot Telegram | grammY |
| Dashboard | Next.js (App Router) + Tailwind CSS |
| Solana | `@solana/web3.js` 1.x (kompatibel dengan contoh resmi Jupiter) |
| Swap | Jupiter Swap API (quote → swap), key dari portal.jup.ag |
| Data on-chain | Helius (Enhanced Webhooks + RPC), Birdeye (data token/top traders) |
| Validasi | zod (env, payload webhook, respons API eksternal) |
| Logging | pino (JSON) |
| Test | vitest |
| Lint/format | ESLint + Prettier |

> **Jangan mengandalkan ingatan untuk detail API eksternal** (endpoint Jupiter, format payload Helius, batas tier gratis). Semuanya pernah berubah. Sebelum menulis atau mengubah integrasi, cek dokumentasi terbaru (dev.jup.ag, docs.helius.dev, docs.birdeye.so) dan validasi respons dengan zod.

## Struktur folder (target)

```
solaryna/
├── apps/
│   ├── bot/                  # proses utama yang jalan 24 jam
│   │   └── src/
│   │       ├── ingest/       # penerima webhook Helius + sumber event dev (websocket)
│   │       ├── engine/       # orkestrasi: sinyal → risiko → eksekutor
│   │       ├── executor/     # paper.ts, live.ts (Jupiter), keduanya implementasi Executor
│   │       ├── exits/        # follow-sell, take-profit, stop-loss, max hold time
│   │       ├── telegram/     # bot grammY: alert + perintah
│   │       ├── jobs/         # job berkala: rescoring, cek posisi, sinkron daftar webhook
│   │       └── main.ts
│   └── web/                  # dashboard Next.js (baca DB, kontrol terbatas)
├── packages/
│   ├── core/                 # logika murni tanpa I/O — paling banyak di-test
│   │   └── src/
│   │       ├── swap/         # normalisasi transaksi → SwapEvent
│   │       ├── scoring/      # metrik & skor wallet, deteksi wallet curang
│   │       ├── risk/         # aturan risiko (fungsi murni: input → keputusan + alasan)
│   │       ├── pnl/          # perhitungan PnL posisi & trade
│   │       └── types.ts
│   ├── db/                   # skema Drizzle, migrasi, query bersama
│   └── config/               # skema env (zod) + loader, dipakai bot & web
├── scripts/                  # backfill histori, rescoring manual, impor wallet
├── .env.example
└── CLAUDE.md
```

Prinsip: **`packages/core` tidak boleh melakukan I/O** (tidak ada fetch, DB, atau waktu sistem langsung — waktu dan harga dioper sebagai argumen). Semua keputusan penting (skor, risiko, PnL) ada di sana supaya bisa di-test tanpa jaringan.

## Perintah

Perbarui bagian ini jika namanya berubah.

```bash
npm install                 # instal semua workspace
npm run dev:bot             # jalankan bot (mode sesuai TRADING_MODE, default paper)
npm run db:create           # buat database dari DATABASE_URL (utf8mb4) jika belum ada
npm run db:generate         # buat file migrasi dari skema Drizzle (packages/db/migrations)
npm run db:migrate          # terapkan migrasi ke MySQL
npm run wallets:import -- wallets.txt          # impor wallet incaran dari file teks
npm run fixture:fetch -- <signature> <nama>    # simpan tx mainnet sebagai fixture parser
npm run dev:web             # dashboard (next dev) di http://127.0.0.1:3000
npm run build:web           # build dashboard produksi
npm run start:web           # jalankan hasil build (DASHBOARD_HOST/DASHBOARD_PORT)
npm run seed:demo           # data demo dashboard; hanya ke database yang namanya mengandung "test"
npm run test                # vitest semua workspace
npm run typecheck           # tsc --noEmit semua workspace
npm run lint                # ESLint
npm run format              # Prettier (format:check untuk cek saja)
```

Belum dibuat (menyusul sesuai milestone):

```bash
npm run score -- --days 30  # M4 — rescoring wallet manual (scripts/)
```

Catatan implementasi M0 yang perlu dijaga:
- Workspace mengekspor source `.ts` langsung (`exports` → `src/index.ts`), import relatif tanpa ekstensi (`moduleResolution: Bundler`).
- Semua rahasia dari env dibungkus `Secret` (`packages/config`); ambil nilainya dengan `.reveal()` hanya di titik pemakaian. Field baru yang rahasia wajib ditambahkan ke `SECRET_ENV_KEYS`/`LOG_REDACT_PATHS`.
- Kolom alamat/mint/signature memakai `base58()` (`ascii_bin`, case-sensitive); jumlah mentah memakai `rawAmount()` (`DECIMAL(40,0)` ⇄ `bigint`); waktu memakai `utcDatetime()`. Client DB men-set session `time_zone = '+00:00'`.
- `LIVE_EXECUTOR_AVAILABLE` di `apps/bot/src/main.ts` tetap `false` sampai M5 selesai; selama itu `resolveTradingMode` selalu jatuh ke paper.
- ESLint memblokir import I/O, `fetch`, `process`, `Date.now()`/`new Date()` tanpa argumen, dan `Math.random()` di `packages/core/src`.

Catatan implementasi M1 yang perlu dijaga:
- Mainnet sudah memakai **transaksi v1**: setiap `getTransaction` wajib `maxSupportedTransactionVersion: 1`. Daftar akun lengkap = `accountKeys` + `loadedAddresses.writable` + `loadedAddresses.readonly`.
- Parser swap (`packages/core/src/swap`) berbasis selisih saldo: wallet harus signer; quote SOL = selisih native + fee (jika fee payer) + selisih WSOL + koreksi rent akun token yang dibuat/ditutup; tepat satu mint non-quote boleh berubah. Ubah hanya bersama fixture test.
- Webhook Helius bertipe **raw** dibuat pengguna di dashboard; bot hanya mengelola `accountAddresses` dan `authHeader` (GET lalu PUT, hanya bila berubah — tiap edit memakai kredit). Bot gagal start jika webhook bukan raw.
- Sumber websocket memakai `logsSubscribe` standar (satu langganan per wallet), lalu `getTransaction` dengan retry; `transactionSubscribe` butuh paket berbayar.
- Perubahan wallet lewat Telegram/skrip ditulis ke `audit_log` di transaksi DB yang sama (`addManualWallet`/`deactivateWallet` dengan argumen actor).
- Logger bot menerima daftar `Secret` dari config dan men-scrub nilainya dari semua log, termasuk pesan error HTTP. Error setelah logger dibuat harus lewat logger, bukan `console`.
- Escape semua teks on-chain/label dengan `escapeHtml` sebelum dikirim ke Telegram; label & nama token disanitasi dengan `sanitizeDisplayText` sebelum disimpan.

Catatan implementasi M2 yang perlu dijaga:
- `Executor` dua langkah: `prepareBuy`/`prepareSell` (quote) lalu `execute`. Mesin risiko tahap pasar dinilai dari quote yang sama yang dieksekusi; kill switch dicek lagi tepat sebelum `execute`. Live (M5) wajib memakai antarmuka yang sama.
- Satu rate limiter Jupiter (`apps/bot/src/jupiter/rate-limiter.ts`, 1 request/detik) dipakai bersama; prioritas `exit` > `buy` > `monitor`, permintaan `monitor` dipromosikan setara `exit` setelah 30 detik. Permintaan beli membawa `expiresAt` supaya sinyal basi tidak di-quote.
- Penjualan posisi (follow-sell, TP/SL/max hold, unsellable) lewat `recordSale` di `engine/sell.ts` dan dikunci per token (`KeyedMutex`) agar engine dan monitor tidak menjual dua kali.
- Rumus PnL posisi dan penguraian penyebab di `packages/core/src/pnl/README.md`; ubah hanya bersama test-nya. Biaya beli direalisasikan pada penjualan pertama.
- Kunci tabel `settings`: `trading_paused` (kill switch), `last_daily_report`, `last_weekly_report` (cursor laporan, tanggal lokal `YYYY-MM-DD`).
- Teks error yang dikirim ke Telegram di-scrub dengan `createSecretScrubber` karena tidak lewat logger.
- `npm run db:generate -- --name x` tidak meneruskan nama; untuk migrasi bernama jalankan `npx drizzle-kit generate --name <nama>` dari `packages/db`.

Catatan implementasi M3 yang perlu dijaga:
- `apps/web` memakai Next.js 16 (App Router, Turbopack): `src/proxy.ts` menggantikan middleware; `cookies()`, `headers()`, `params`, `searchParams` semuanya async. API Next berubah antar versi — cek `node_modules/next/dist/docs/` sebelum mengubah routing, action, atau caching. File `page.tsx` hanya boleh mengekspor ekspor route (default, `metadata`, …); konstanta bersama taruh di `src/lib`.
- Dashboard hanya memuat `WEB_ENV_KEYS` lewat `loadWebEnv`/`getWebConfig()` (server-only) — tidak ada API key, token, atau private key. Jangan menambah kunci bot ke skema web.
- `proxy.ts` hanya mengalihkan permintaan tanpa cookie; pemeriksaan sesi yang sebenarnya adalah `requireSession()`, wajib di setiap page **dan** setiap server action. Token sesi `v1.<exp>.<hmac>` dengan kunci turunan scrypt dari `DASHBOARD_PASSWORD` (ganti password = semua sesi batal); limiter login 10 gagal/15 menit, di memori.
- Setiap perubahan dari dashboard lewat fungsi `@solaryna/db` dengan `{ actor: DASHBOARD_ACTOR }`, yang menulis `audit_log` di transaksi yang sama. Job bot `jobs/dashboard-audit.ts` membaca entri actor `dashboard` tiap 15 detik untuk mengumumkannya di Telegram dan memuat ulang batas risiko.
- Batas risiko runtime: kunci `settings` `risk_limits` (objek string). Nilai `.env` adalah plafon; `effectiveRiskLimits` (core) dipakai bot dan dashboard, jadi baris DB yang diedit manual tidak bisa melonggarkan apa pun. Validasi form di `apps/web/src/lib/limits-form.ts`; `COPY_DELAY_MS` dan `MAX_PRIORITY_FEE_LAMPORTS` hanya lewat `.env`.
- Mode dipilih lewat `?mode=live`; semua query dashboard memfilter `mode` dan tidak pernah menjumlahkan paper + live. Estimasi posisi terbuka memakai `positions.last_value_lamports` yang disimpan monitor bot — dashboard tidak memanggil Jupiter.
- Paginasi offset mengambil `PAGE_SIZE + 1` baris (`splitPage`) untuk tahu ada halaman berikutnya. React 19 me-reset form setelah action, jadi state action mengembalikan nilai isian saat error.
- Warna grafik (`gain`/`loss` di `globals.css`) sudah divalidasi untuk mode terang dan gelap; validasi ulang bila diubah.
- `seed:demo` menolak database yang namanya tidak mengandung `test` dan mengosongkannya; pakai `solaryna_demo_test`, karena `solaryna_test` dikosongkan oleh test suite.

Sebelum menyatakan pekerjaan selesai: jalankan `npm run typecheck`, `npm run lint`, dan `npm run test`, lalu laporkan hasilnya apa adanya.

## Lingkungan lokal (Windows + Laragon)

- Proyek ada di `C:\laragon\www\solaryna`. Shell bisa Git Bash atau PowerShell; tulis skrip npm yang jalan di keduanya (hindari `rm -rf`, `export`, dll. — pakai `rimraf`, `cross-env` bila perlu).
- MySQL dari Laragon: `127.0.0.1:3306`, user default `root` tanpa password. Buat database `solaryna` (charset `utf8mb4`).
- Helius webhook butuh URL publik. Saat development pakai tunnel (`cloudflared tunnel --url http://localhost:8787` atau ngrok), **atau** pakai sumber event websocket (`INGEST_SOURCE=websocket`) yang tidak butuh URL publik.
- Laptop harus menyala agar bot jalan. Untuk 24 jam, deploy ke VPS (lihat **Deploy**).

## Variabel lingkungan

Semua dibaca lewat `packages/config` dan divalidasi zod saat start — bot harus **gagal start** jika ada yang tidak valid. `.env.example` berisi semua kunci tanpa nilai rahasia.

```dotenv
# Umum
NODE_ENV=development
TZ_DISPLAY=Asia/Jakarta
DATABASE_URL=mysql://root:@127.0.0.1:3306/solaryna

# Data on-chain
HELIUS_API_KEY=
SOLANA_RPC_URL=                 # RPC Helius, bukan RPC publik, untuk kirim transaksi
INGEST_SOURCE=webhook           # webhook | websocket
HELIUS_WEBHOOK_ID=              # webhook raw buatan pengguna; wajib jika INGEST_SOURCE=webhook
HELIUS_WEBHOOK_SECRET=          # min. 16 karakter; dipasang sebagai authHeader & dicocokkan dengan header Authorization
WEBHOOK_HOST=127.0.0.1          # server penerima webhook, path /webhooks/helius
WEBHOOK_PORT=8787
BIRDEYE_API_KEY=

# Jupiter
JUPITER_API_KEY=

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_CHAT_IDS=      # daftar chat id yang boleh memberi perintah, pisahkan koma

# Dashboard
DASHBOARD_PASSWORD=             # wajib diisi, min. 12 karakter; dashboard menolak start jika kosong
DASHBOARD_HOST=127.0.0.1        # 0.0.0.0 agar bisa dibuka dari HP di jaringan yang sama
DASHBOARD_PORT=3000

# Mode trading
TRADING_MODE=paper              # paper | live
LIVE_TRADING_ACKNOWLEDGED=false # harus "true" juga agar live aktif
BOT_WALLET_PRIVATE_KEY=         # hanya untuk live; base58; wallet KHUSUS bot

# Batas risiko (berlaku di paper & live)
MAX_SOL_PER_TRADE=0.05
MAX_OPEN_POSITIONS=5
DAILY_LOSS_LIMIT_SOL=0.2
MIN_LIQUIDITY_USD=20000
MAX_SLIPPAGE_BPS=300
MAX_PRIORITY_FEE_LAMPORTS=200000
COPY_DELAY_MS=3000              # jeda yang disimulasikan di paper trading
TAKE_PROFIT_PCT=100
STOP_LOSS_PCT=30
MAX_HOLD_MINUTES=240
MAX_SIGNAL_AGE_SECONDS=30       # sinyal beli lebih tua dari ini (sejak swap wallet) ditolak
```

## Aturan keamanan (wajib)

### Private key & rahasia
- `BOT_WALLET_PRIVATE_KEY` hanya ada di `.env` milik pengguna. **Jangan pernah** menulisnya ke file lain, mencetaknya, me-log-nya, mengirimnya ke Telegram/dashboard, atau memasukkannya ke pesan error. Konfigurasi pino harus me-redact kunci ini dan semua `*_API_KEY`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`.
- `.env` dan `.env.*` (kecuali `.env.example`) wajib ada di `.gitignore` sejak commit pertama.
- Claude **tidak meminta, membaca, atau mengisi** private key atau API key. Pengguna mengisinya sendiri.
- Wallet bot adalah **hot wallet khusus** berisi modal kecil, bukan wallet utama pengguna. Ingatkan ini di README dan di pesan start mode live.

### Mode live
- Default selalu **paper**. Live aktif hanya jika `TRADING_MODE=live` **dan** `LIVE_TRADING_ACKNOWLEDGED=true` **dan** private key valid. Jika salah satu tidak terpenuhi, bot jalan sebagai paper dan memberi tahu lewat log + Telegram.
- Setiap eksekusi live **wajib** lewat mesin risiko. Tidak boleh ada jalur kode, flag debug, atau perintah Telegram yang melewatinya.
- **Kill switch**: tabel `settings` menyimpan `trading_paused`. Dicek tepat sebelum setiap eksekusi (bukan hanya saat start). Bisa diubah lewat `/pause` Telegram dan tombol dashboard.
- Claude **tidak menjalankan** kode yang mengirim transaksi nyata ke mainnet selama development. Test eksekutor live memakai mock Jupiter & RPC. Uji coba live pertama dilakukan pengguna sendiri dengan nominal sangat kecil.
- Jupiter tidak punya likuiditas memecoin di devnet, jadi devnet tidak bisa dipakai untuk uji swap nyata; jangan berpura-pura sebaliknya.

### Input eksternal
- Payload webhook adalah input tak tepercaya: verifikasi header rahasia, validasi dengan zod, tolak yang tidak cocok.
- Webhook Helius bisa dikirim ulang: **dedupe berdasarkan signature transaksi** (unique index) sebelum memproses.
- Nama/simbol token dari on-chain bisa berisi teks apa pun. Escape sebelum dikirim ke Telegram (mode HTML) dan dashboard.
- Jangan scraping GMGN atau situs lain yang melarangnya. Pakai API resmi (Helius, Birdeye, Jupiter).

### Perintah Telegram
- Hanya chat id di `TELEGRAM_ALLOWED_CHAT_IDS` yang boleh memberi perintah; yang lain diabaikan diam-diam.
- Perintah yang mengubah perilaku trading (`/pause`, `/resume`, `/addwallet`, `/removewallet`, `/setlimit`) dicatat di `audit_log`.

### Tampilan & klaim
- UI dan pesan tidak boleh menjanjikan profit. Tampilkan PnL apa adanya, termasuk biaya dan slippage. Tampilkan catatan "bukan saran investasi" di dashboard.

## Aturan uang & angka

- **Jangan pakai `number` JavaScript untuk jumlah token atau SOL.** Simpan jumlah mentah (lamports, raw token amount) sebagai `bigint` di kode dan `DECIMAL(40,0)` di MySQL. Untuk harga & PnL pakai `decimal.js`; konversi ke `number` hanya untuk tampilan.
- Selalu simpan `decimals` token bersama jumlah mentahnya.
- Quote currency yang didukung: SOL/WSOL dan USDC. Normalisasi WSOL = SOL. Swap token-ke-token lain dicatat tapi tidak dijadikan sinyal.
- PnL dihitung **setelah** biaya: fee jaringan + priority fee + fee DEX/Pump.fun + slippage aktual. Di paper trading, biaya diestimasi dari quote Jupiter dan priority fee yang dikonfigurasi.

## Model domain

| Istilah | Arti |
|---|---|
| Wallet incaran (`tracked_wallet`) | Wallet yang dipantau. Sumber: `manual` (ditambah pengguna) atau `discovered` (dari scoring). |
| `SwapEvent` | Swap yang sudah dinormalisasi: `signature, slot, blockTime, wallet, side (buy/sell), tokenMint, tokenAmountRaw, tokenDecimals, quoteMint, quoteAmountRaw, source (pumpfun/raydium/meteora/jupiter/…)`. |
| Sinyal (`signal`) | `SwapEvent` dari wallet incaran yang dipertimbangkan untuk diikuti. Selalu disimpan, beserta keputusan risiko (`accepted`/`rejected` + alasan). |
| Posisi (`position`) | Kepemilikan Solaryna atas satu token, hasil satu atau lebih trade. Status `open`/`closed`. Punya `mode` paper/live. |
| Trade (`trade`) | Satu eksekusi beli/jual oleh Solaryna (paper atau live), dengan harga, jumlah, biaya, signature (live). |
| Skor wallet (`wallet_score`) | Snapshot metrik per wallet per hari. |

### Tabel (Drizzle, `packages/db`)
`tracked_wallets`, `wallet_scores`, `swap_events` (unique `signature`+`wallet`), `signals`, `positions`, `trades`, `tokens` (cache metadata & likuiditas), `settings` (kill switch, batas yang bisa diubah runtime), `audit_log`.

Semua tabel punya `created_at`; tabel yang bisa berubah punya `updated_at`. Gunakan migrasi drizzle-kit — jangan ubah skema langsung di database.

## Alur copy trade (detail)

1. **Ingest** menerima transaksi → simpan mentah ringkas → normalisasi ke `SwapEvent` (`packages/core/swap`). Transaksi yang tidak bisa diparse dicatat sebagai warning, bukan crash.
2. **Engine** membuat `signal` jika wallet ada di daftar aktif.
3. **Risk** (`packages/core/risk`) memutuskan dengan input eksplisit: konfigurasi, state posisi terbuka, PnL harian, data token (likuiditas, umur token, apakah mint/freeze authority masih aktif), status kill switch. Output: `{ decision, reasons[] }`. Contoh penolakan: likuiditas di bawah minimum, posisi terbuka penuh, batas rugi harian tercapai, token di blacklist, token sudah dipegang, wallet sedang di-cooldown.
4. **Executor** (antarmuka sama untuk paper & live):
   - **Paper:** ambil quote Jupiter nyata pada waktu sinyal + `COPY_DELAY_MS`, catat harga & estimasi biaya. Tidak ada transaksi.
   - **Live:** quote → bangun transaksi swap → tanda tangani dengan wallet bot → kirim via `SOLANA_RPC_URL` → konfirmasi → catat signature & jumlah aktual dari transaksi yang terkonfirmasi (bukan dari quote). Tangani gagal/expired blockhash dengan retry terbatas, lalu laporkan.
5. **Exits** (`apps/bot/src/exits`): follow-sell (wallet incaran jual → jual proporsional), take-profit, stop-loss, max hold time. Dicek dari event dan dari job berkala.
6. **Notifikasi** Telegram untuk: sinyal diterima/ditolak (ringkas), trade dieksekusi, posisi ditutup + PnL, error eksekusi, perubahan mode/pause.

## Penemuan & skor wallet

Implementasi di `packages/core/scoring`; semua ambang ada di konfigurasi, bukan hardcode.

Metrik awal (jendela default 30 hari):
- Realized PnL (SOL), jumlah trade, win rate, median ROI per trade.
- **Konsentrasi profit**: porsi trade terbaik terhadap total profit. Wallet yang >50% profitnya dari satu trade diberi penalti (kemungkinan cuma beruntung sekali).
- Rata-rata & median lama hold.
- **Copyability**: PnL simulasi jika diikuti dengan jeda `COPY_DELAY_MS` — metrik paling penting; diisi dari hasil paper trading.

Penanda wallet curang (diturunkan skornya atau dibuang):
- **Sniper bot**: sering beli di slot yang sama/berdekatan dengan pembuatan pool, hold sangat singkat.
- **Insider/dev**: menerima token sebelum pool dibuka, atau terkait dengan wallet pembuat token.
- **Bundler**: banyak wallet didanai dari sumber yang sama dan membeli di slot yang sama.
- **Bait wallet**: pola beli yang konsisten diikuti dump besar segera setelah pengikut masuk.
- Wallet CEX/market maker (volume sangat tinggi, profit tipis).

Skor akhir = kombinasi berbobot metrik di atas; dokumentasikan rumusnya di `packages/core/scoring/README.md` dan ubah hanya bersama test.

## Dashboard (`apps/web`)

- Login sederhana dengan `DASHBOARD_PASSWORD` (cookie sesi httpOnly). Tidak ada halaman publik.
- Halaman: **Ringkasan** (PnL harian/total per mode, posisi terbuka, status pause), **Wallet** (tabel skor, tambah/hapus wallet manual, riwayat per wallet), **Sinyal** (diterima/ditolak + alasan), **Posisi & Trade**, **Pengaturan** (batas risiko runtime, kill switch).
- Dashboard **tidak bisa** mengaktifkan mode live atau melihat private key. Mode live hanya lewat `.env` + restart.
- Bedakan jelas data paper vs live (badge/warna), dan jangan menjumlahkan keduanya.

## Konvensi kode

- ESM, TypeScript strict, tanpa `any` (pakai `unknown` + zod).
- Fungsi murni di `core`; efek samping di `apps/*`. Dependency (clock, price source, Jupiter client, DB) diinjeksi agar mudah di-mock.
- Error dari API eksternal dibungkus jadi error bertipe dengan konteks (endpoint, status) tanpa membocorkan key.
- Setiap aturan risiko dan setiap metrik skor punya unit test, termasuk kasus tepi (jumlah nol, decimals berbeda, token tanpa harga).
- Parser swap di-test dengan fixture JSON transaksi nyata (disimpan di `packages/core/test/fixtures`, tanpa data rahasia).
- Pesan commit: Conventional Commits (`feat:`, `fix:`, `chore:` …), bahasa Inggris.

## Milestone

- [x] **M0 — Scaffold:** npm workspaces, TS config, ESLint/Prettier, vitest, `packages/config` (zod env), `packages/db` + migrasi awal, `.gitignore`, `.env.example`, README singkat.
- [x] **M1 — Ingest + alert:** webhook Helius (dan sumber websocket untuk dev), parser `SwapEvent` + fixture test, daftar wallet manual (impor dari GMGN secara manual), alert Telegram, perintah `/addwallet` `/removewallet` `/list`.
- [ ] **M2 — Paper trading:** mesin risiko, executor paper dengan quote Jupiter, posisi & exits, laporan PnL harian di Telegram, kill switch.
- [ ] **M3 — Dashboard:** login, ringkasan, wallet, sinyal, posisi, pengaturan.
- [ ] **M4 — Penemuan wallet:** backfill histori, metrik & penanda curang, rescoring harian, umpan balik copyability dari paper trading.
- [ ] **M5 — Live trading:** executor live Jupiter di balik flag ganda, retry & konfirmasi, rekonsiliasi saldo wallet bot vs database, panduan uji coba nominal kecil untuk pengguna.

Tandai milestone selesai di sini hanya setelah typecheck, lint, dan test lulus.

## Deploy (nanti)

- Bot di VPS (mis. Oracle Cloud Always Free atau VPS ~$5/bulan) dengan pm2 atau systemd; dashboard di server yang sama di balik reverse proxy HTTPS.
- Daftarkan URL webhook HTTPS publik di Helius; rahasia webhook sama dengan `HELIUS_WEBHOOK_SECRET`.
- Backup database harian.

## Hal yang tidak boleh dilakukan Claude

- Mengaktifkan mode live, mengubah default ke live, atau menaikkan batas risiko tanpa permintaan eksplisit pengguna di chat.
- Menjalankan skrip yang mengirim transaksi mainnet.
- Menyentuh, menampilkan, atau meminta private key / API key.
- Memberi saran investasi atau menjanjikan profit (di kode, UI, maupun jawaban).
- Mengandalkan tebakan untuk endpoint/format API eksternal tanpa mengecek dokumentasi.
