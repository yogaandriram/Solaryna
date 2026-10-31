# Desain M2 — Paper Trading

Tanggal: 2026-10-31 · Status: draf, menunggu persetujuan pengguna

Dokumen ini melengkapi `CLAUDE.md` (aturan proyek, stack, aturan keamanan & angka). Jika ada yang
bertentangan, `CLAUDE.md` yang berlaku. Penanda **[keputusan pengguna]** = disampaikan pengguna;
**[keputusan desain]** = pilihan penulis desain yang boleh dikoreksi pengguna; sisanya mengikuti
`CLAUDE.md`.

## 1. Maksud

Solaryna M1 sudah mengirim alert saat wallet incaran beli/jual. M2 menambahkan **paper trading**:
bot ikut "membeli" dan "menjual" secara simulasi dengan harga pasar sungguhan (quote Jupiter),
melewati mesin risiko yang sama yang nanti dipakai mode live, lalu mencatat hasilnya apa adanya.

**Untuk apa [keputusan pengguna]:** pengguna membaca laporan **mingguan** untuk melihat untung atau
rugi. Jika rugi, laporan harus bisa menjawab **kenapa** — apakah karena wallet yang diikuti, karena
sistem kita (telat masuk, slippage, biaya, aturan keluar), atau hal lain. Laporan yang hanya
memberi satu angka bersih tidak memenuhi tujuan ini.

Hasil M2 juga menjadi dasar keputusan apakah layak lanjut ke mode live (M5) dan bahan metrik
"copyability" untuk penilaian wallet (M4).

## 2. Tujuan, bukan tujuan, anti-tujuan

**Tujuan**

1. Setiap swap wallet incaran yang lolos normalisasi menjadi `signal` dengan keputusan risiko
   (`accepted`/`rejected` + alasan) yang tersimpan.
2. Sinyal beli yang diterima dieksekusi oleh **executor paper** (quote Jupiter nyata, tanpa
   transaksi) dan membuka posisi `mode = paper`.
3. Posisi ditutup oleh **follow-sell, take-profit, stop-loss, atau max hold time**, dengan PnL
   setelah biaya.
4. **Kill switch** (`settings.trading_paused`) lewat `/pause` dan `/resume`, dicek tepat sebelum
   setiap eksekusi, tercatat di `audit_log`.
5. **Laporan harian** ringkas dan **laporan mingguan** berisi rincian penyebab untung/rugi (§9),
   dikirim lewat Telegram.
6. Antarmuka `Executor` yang sama nanti diimplementasikan executor live (M5) tanpa mengubah engine.

**Bukan tujuan M2**

- Mode live atau apa pun yang mengirim transaksi. `LIVE_EXECUTOR_AVAILABLE` tetap `false`.
- Dashboard (M3), termasuk mengubah batas risiko saat runtime (`/setlimit` ditunda ke M3 bersama
  halaman Pengaturan; di M2 batas hanya dari `.env` + restart) [keputusan desain].
- Penilaian/penemuan wallet otomatis (M4). M2 cukup menyimpan data yang dibutuhkan M4.
- Aturan umur token minimum: belum ada konfigurasinya di `CLAUDE.md`; umur token hanya dicatat.
- Perintah untuk blacklist token atau cooldown wallet. Aturan risikonya tetap dihormati bila kolom
  di database terisi (mis. diisi manual), tetapi tidak ada UI untuk mengisinya di M2.

**Anti-tujuan (gagal walau secara teknis jalan)**

- Hasil paper yang lebih bagus dari kenyataan: mengabaikan biaya, slippage, jeda, atau menganggap
  token yang tidak bisa dijual masih bernilai.
- Laporan yang menyembunyikan biaya atau mencampur paper dengan live.
- Jalur kode apa pun yang mengeksekusi tanpa lewat mesin risiko atau tanpa cek kill switch.
- Telegram jadi berisik: sinyal yang ditolak tidak boleh menjadi pesan terpisah tersendiri.
- Melebihi rate limit Jupiter sehingga exit (take-profit/stop-loss) terlambat atau terlewat.

## 3. Batasan

- Semua aturan `CLAUDE.md`: core tanpa I/O, `bigint` untuk jumlah, `decimal.js` untuk harga/PnL,
  validasi zod untuk respons eksternal, UTC disimpan / WIB ditampilkan, teks on-chain di-escape,
  tidak ada janji profit (laporan menampilkan "hasil simulasi, bukan saran investasi").
- **Jupiter, paket gratis** (dicek 2026-10-31 di developers.jup.ag):
  - Satu batas bersama **1 request/detik (60 per 60 detik, sliding window)** untuk Swap, Price,
    dan Tokens API. Respons membawa `x-ratelimit-remaining`, `x-ratelimit-reset`; kelebihan → 429.
  - Quote: `GET https://api.jup.ag/swap/v2/order` dengan header `x-api-key`. Tanpa `taker` hanya
    quote (`transaction = null`). Field penting: `inAmount`, `outAmount`, `otherAmountThreshold`,
    `priceImpact` (poin persen), `slippageBps`, `feeBps`, `platformFee`, `signatureFeeLamports`,
    `prioritizationFeeLamports`, `rentFeeLamports`, `inUsdValue`, `outUsdValue`, `router`,
    `routePlan`.
  - Data token: `GET https://api.jup.ag/tokens/v2/search?query=<mint>` → `liquidity` (USD),
    `mintAuthority`, `freezeAuthority`, `audit.{mintAuthorityDisabled, freezeAuthorityDisabled,
isSus, topHoldersPercentage}`, `createdAt`, `firstPool.createdAt`, `usdPrice`, `organicScore`.
  - Price API V3 menghilangkan token yang harganya dianggap tidak andal (umum untuk memecoin
    baru), jadi **tidak dipakai** untuk menilai posisi [keputusan desain].
- **Birdeye paket Standard** tidak menyediakan endpoint keamanan token dan info pembuatan token,
  jadi **M2 tidak memakai Birdeye** [keputusan desain]; semua data token dari Jupiter.
- Detail API eksternal di atas wajib dicek ulang ke dokumentasi saat implementasi.

## 4. Alur

```
SwapEvent baru (M1) → alert Telegram langsung dikirim (baris keputusan menyusul, §9)
  └─ Engine: buat signal untuk wallet incaran
       ├─ side = buy
       │    1. Risiko tahap lokal (tanpa Jupiter): pause, posisi penuh, sudah pegang, rugi harian,
       │       blacklist, cooldown, sinyal terlalu tua → ada alasan? → rejected, selesai
       │    2. tunggu COPY_DELAY_MS
       │    3. Executor.prepareBuy: data token + quote beli (2 request Jupiter)
       │    4. Risiko tahap pasar (pakai data token + quote dari langkah 3) → rejected / accepted
       │    5. accepted → cek kill switch → Executor.execute(order yang sama) → posisi baru
       └─ side = sell → ada posisi terbuka dari wallet ini untuk token ini?
             ya → accepted (follow-sell) → tunggu COPY_DELAY_MS → prepareSell → cek kill switch
                  → execute
             tidak → rejected (not_holding); tidak dihitung di statistik penolakan sinyal beli
Job posisi (berkala) → quote jual per posisi → take-profit / stop-loss / max hold → execute
Job laporan (terjadwal) → laporan harian & mingguan → Telegram
```

- Jeda simulasi: quote diambil **setelah sinyal diterima bot + `COPY_DELAY_MS`** (meniru waktu
  bangun-kirim-konfirmasi transaksi di mode live).
- [keputusan desain] **Satu quote per sinyal beli:** risiko tahap pasar dinilai dengan quote yang
  sama yang dipakai untuk eksekusi (diambil setelah jeda). Tidak ada keadaan "diterima tapi gagal
  dieksekusi" karena rute/impact; sinyal baru diputuskan setelah quote ada.
- [keputusan desain] **Dua tahap risiko:** aturan yang hanya butuh database dinilai dulu; bila ada
  yang gagal, sinyal langsung ditolak tanpa memanggil Jupiter (menghemat kuota 1 request/detik).
  Di tiap tahap semua alasan yang berlaku tetap dikumpulkan. Konsekuensinya, statistik penolakan
  di laporan mencatat alasan dari tahap yang menghentikan sinyal itu.
- Kill switch dicek tepat sebelum setiap eksekusi (beli maupun jual), sesuai `CLAUDE.md`. Saat
  pause, sinyal tetap dicatat (ditolak dengan alasan `trading_paused`), dan exit menunggu sampai
  `/resume`.
- [keputusan desain] **Sinyal beli yang terlambat ditolak** (`signal_too_old`) bila selisih antara
  `blockTime` swap wallet dan saat quote akan diambil melebihi `MAX_SIGNAL_AGE_SECONDS` (env baru,
  default **30**). Ini mencegah paper membeli jauh lebih lambat dari wallet akibat retry webhook,
  reconnect websocket, restart bot, atau antrean rate limit. **Follow-sell tidak dibatasi umur**:
  posisi yang sudah dipegang tetap ikut dijual walau sinyalnya terlambat.

## 5. Aturan risiko (`packages/core/src/risk`)

Fungsi murni: input eksplisit → `{ decision, reasons[] }`. **Semua** alasan yang berlaku
dikumpulkan, bukan hanya yang pertama. Setiap alasan punya kode stabil + data angka untuk laporan
(mis. `liquidity_below_min` dengan nilai aktual & batas).

Penolakan sinyal beli:

| Kode                       | Kondisi                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| `trading_paused`           | kill switch aktif                                                   |
| `max_open_positions`       | posisi terbuka (paper) ≥ `MAX_OPEN_POSITIONS`                       |
| `already_holding`          | sudah ada posisi terbuka untuk token ini (dari wallet mana pun)     |
| `daily_loss_limit`         | PnL realisasi hari ini (WIB) ≤ −`DAILY_LOSS_LIMIT_SOL`              |
| `token_data_unavailable`   | data token Jupiter tidak bisa didapat                               |
| `liquidity_below_min`      | likuiditas USD < `MIN_LIQUIDITY_USD`, atau tidak diketahui          |
| `mint_authority_active`    | mint authority belum dicabut                                        |
| `freeze_authority_active`  | freeze authority belum dicabut                                      |
| `token_flagged_suspicious` | Jupiter menandai `audit.isSus`                                      |
| `token_blacklisted`        | `tokens.is_blacklisted = true`                                      |
| `wallet_cooldown`          | `tracked_wallets.cooldown_until` > sekarang                         |
| `signal_too_old`           | umur sinyal (dari `blockTime`) > `MAX_SIGNAL_AGE_SECONDS`           |
| `price_impact_too_high`    | \|`priceImpact`\| quote beli > `MAX_SLIPPAGE_BPS` / 100 poin persen |
| `no_route`                 | Jupiter tidak memberi rute untuk beli                               |

Tahap lokal: `trading_paused` sampai `signal_too_old`, kecuali `token_data_unavailable`,
`liquidity_below_min`, `mint_authority_active`, `freeze_authority_active`, dan
`token_flagged_suspicious`. Kelima aturan itu, ditambah `price_impact_too_high` dan `no_route`,
termasuk tahap pasar.

[keputusan desain] Ukuran posisi **selalu `MAX_SOL_PER_TRADE`** per sinyal beli, berapa pun besar
beli wallet. Wallet yang menambah beli token yang sudah kita pegang **tidak** menambah posisi
(`already_holding`). Satu token hanya punya satu posisi terbuka.

[keputusan desain] Mint/freeze authority aktif dan tanda `isSus` selalu menolak (tidak bisa
dimatikan lewat konfigurasi di M2). Wallet yang membeli dengan USDC tetap kita ikuti dengan SOL.

Batas rugi harian memakai **hari kalender WIB** dan hanya PnL **realisasi** (posisi/porsi yang sudah
dijual) setelah biaya [keputusan desain]. Batas ini hanya menghentikan beli baru; exit tetap jalan.

## 6. Executor paper (`apps/bot/src/executor/paper.ts`)

Antarmuka `Executor` (dipakai juga oleh live di M5) terdiri dari dua langkah [keputusan desain]:

- `prepareBuy({ tokenMint, solAmountLamports })` / `prepareSell({ tokenMint, tokenAmountRaw })` →
  "order": quote (jumlah masuk/keluar, price impact, rincian biaya) yang dipakai mesin risiko. Di
  live (M5) langkah ini adalah `/order` dengan `taker`, yang sekaligus mengembalikan transaksi.
- `execute(order)` → hasil trade: jumlah token & SOL (mentah, `bigint`), harga, rincian biaya,
  snapshot quote, atau error bertipe. Paper mencatat hasil dari order itu sendiri; live (M5)
  menandatangani, mengirim, dan membaca jumlah aktual dari transaksi yang terkonfirmasi.

Paper:

- Beli: quote `inputMint = WSOL`, `outputMint = token`, `amount = MAX_SOL_PER_TRADE`,
  `slippageBps = MAX_SLIPPAGE_BPS`, tanpa `taker`. Jumlah token yang "didapat" = `outAmount`.
- Jual: quote kebalikannya untuk jumlah token yang dijual; SOL yang "diterima" = `outAmount`.
- [keputusan desain] Eksekusi paper memakai `outAmount` (bukan `otherAmountThreshold`); keduanya
  disimpan di snapshot quote supaya selisih dengan hasil live bisa diukur di M5.
- Trade disimpan dengan `status = simulated`, `mode = paper`.

Biaya (dicatat terpisah di `trades`):

| Biaya                   | Estimasi paper                                                                   |
| ----------------------- | -------------------------------------------------------------------------------- |
| Fee jaringan            | 5.000 lamports per transaksi (base fee, 1 signature)                             |
| Priority fee            | `MAX_PRIORITY_FEE_LAMPORTS` per transaksi (batas atas, konservatif)              |
| Fee DEX/platform        | dari quote (`feeBps`/`platformFee`); fee pool DEX sudah tercermin di `outAmount` |
| Slippage & price impact | tercermin di `outAmount` quote yang diambil setelah jeda                         |
| Rent akun token         | dianggap netral (dikembalikan saat akun ditutup); nilainya disimpan di snapshot  |

Builder wajib memastikan dari dokumentasi Jupiter apakah `outAmount` sudah dikurangi `platformFee`,
supaya fee tidak terhitung dua kali atau terlewat.

## 7. Posisi & exit (`apps/bot/src/exits`)

- **Follow-sell:** wallet asal posisi menjual token itu → kita jual **proporsional**: porsi =
  jumlah yang dijual wallet ÷ saldo token wallet sebelum transaksi itu (dibaca dari saldo token
  pre/post di transaksi yang sama). Bila porsi ≥ 100% atau saldo sebelum tidak diketahui → jual
  semua. Hanya wallet asal posisi yang memicu follow-sell.
- **Take-profit / stop-loss:** job berkala (default tiap 30 detik [keputusan desain]) mengambil quote
  jual untuk seluruh sisa token tiap posisi terbuka. Nilai bersih = `outAmount` − estimasi biaya
  jual. TP bila nilai bersih ≥ modal sisa × (1 + `TAKE_PROFIT_PCT`/100); SL bila ≤ modal sisa ×
  (1 − `STOP_LOSS_PCT`/100). Pemicu → jual seluruh sisa (tanpa jeda tambahan).
- **Max hold:** umur posisi ≥ `MAX_HOLD_MINUTES` → jual seluruh sisa.
- **Token tidak bisa dijual** (tidak ada rute) saat harus keluar: dicoba lagi pada siklus berikut;
  bila masih tanpa rute melewati max hold, posisi ditutup dengan **nilai jual 0** (rugi penuh) dan
  alasan tersendiri (mis. `unsellable`), supaya laporan tidak menganggap token itu masih bernilai.
- PnL posisi = total SOL diterima − total SOL dibayar − semua biaya. Penjualan sebagian
  merealisasikan PnL proporsional terhadap modal (metode biaya rata-rata).
- Saat bot restart, posisi terbuka dimuat dari database dan dipantau lagi.

## 8. Kill switch & perintah Telegram

- `settings.trading_paused` (boolean). Belum ada baris = tidak pause.
- Perintah baru (hanya chat di `TELEGRAM_ALLOWED_CHAT_IDS`):
  - `/pause`, `/resume` — ubah kill switch; dicatat di `audit_log`; balasan + notifikasi perubahan.
  - `/status` — mode (PAPER), pause atau tidak, jumlah posisi terbuka, PnL realisasi hari ini.
  - `/positions` — posisi terbuka: token, wallet asal, modal, estimasi nilai sekarang, umur.
  - `/report` — laporan hari ini sejauh ini; `/report minggu` — laporan 7 hari terakhir.

## 9. Notifikasi & laporan

**Notifikasi kejadian**

- Alert swap M1 tetap dikirim seketika, lalu **pesan yang sama diedit** untuk menambah satu baris
  keputusan begitu keputusannya ada (bisa beberapa detik karena `COPY_DELAY_MS` + Jupiter):
  "🧪 Paper: diikuti" atau "🧪 Paper: dilewati — likuiditas $12.300 < $20.000" [keputusan desain].
  Sinyal ditolak tidak mengirim pesan terpisah. Bila edit gagal, cukup dicatat di log.
- Trade paper tereksekusi: beli/jual, jumlah, harga, biaya, dan **selisih harga dibanding wallet**
  (berapa persen lebih mahal/murah dari harga wallet).
- Posisi ditutup: alasan keluar, modal, hasil, PnL bersih SOL & %, rincian biaya.
- Error eksekusi (quote gagal, rate limit berulang) dan perubahan pause/resume.

**Laporan harian** — setiap hari pukul **07.00 WIB** untuk hari WIB sebelumnya [keputusan desain]:
PnL realisasi bersih, jumlah trade, menang/kalah, total biaya per jenis, posisi terbuka + estimasi
PnL belum terealisasi, jumlah sinyal beli diterima/ditolak + alasan penolakan teratas.

**Laporan mingguan** — setiap **Senin 07.00 WIB** untuk Senin–Minggu sebelumnya [keputusan desain]:

1. Total: PnL realisasi bersih, win rate, jumlah posisi, total biaya per jenis.
2. **Per wallet:** jumlah sinyal, posisi, PnL bersih, win rate.
3. **Penguraian penyebab** per posisi yang ditutup, dijumlahkan per wallet dan total:
   - hasil **wallet itu sendiri** pada token tersebut (harga beli & jual wallet);
   - **selisih masuk**: harga beli kita vs harga beli wallet (efek jeda & slippage);
   - **selisih keluar**: harga jual kita vs harga jual wallet (follow-sell) atau vs apa yang
     akhirnya dilakukan wallet (TP/SL/max hold keluar lebih cepat/lambat);
   - **biaya**.

   Komponen ini harus konsisten (jumlahnya menjelaskan PnL kita) dan rumusnya didokumentasikan di
   `packages/core` beserta test. Bila data wallet tidak lengkap (mis. wallet belum menjual), tampilkan
   apa adanya ("wallet masih memegang").

4. **Per alasan keluar:** jumlah posisi dan PnL untuk follow-sell, TP, SL, max hold, unsellable.
5. **Sinyal beli ditolak** per alasan (jumlah), untuk menilai apakah aturan terlalu ketat/longgar.
6. Posisi terbaik dan terburuk.

Laporan panjang dipecah agar tiap pesan ≤ 4096 karakter. Laporan yang terlewat karena bot mati
dikirim sekali saat bot menyala lagi [keputusan desain]. Semua laporan berlabel PAPER dan
mencantumkan "hasil simulasi, bukan saran investasi".

## 10. Data

Tabel `signals`, `positions`, `trades`, `settings` sudah ada sejak M0 dan mencakup sebagian besar
kebutuhan. Perubahan skema lewat migrasi drizzle-kit, misalnya:

- alasan penolakan terstruktur + snapshot input risiko per sinyal (likuiditas, authority, dsb.);
- waktu sinyal diterima bot dan waktu quote diambil (untuk mengukur jeda);
- jumlah token awal posisi (untuk penjualan sebagian) dan alasan tutup `unsellable`;
- harga SOL dalam USD saat trade (dari `inUsdValue`/`outUsdValue`) untuk membandingkan dengan wallet
  yang bertransaksi dalam USDC;
- `settings`: `trading_paused`, tanggal laporan harian/mingguan terakhir yang terkirim.
- id pesan Telegram per chat untuk alert swap (agar bisa diedit dengan baris keputusan).

Env baru: `MAX_SIGNAL_AGE_SECONDS` (default 30), divalidasi zod di `packages/config` dan
ditambahkan ke `.env.example` serta `CLAUDE.md`.

Normalisasi swap (M1) perlu menyertakan **saldo token wallet sebelum transaksi** untuk follow-sell
proporsional.

## 11. Rate limit Jupiter

Satu klien Jupiter untuk semua panggilan dengan penjadwal ≤ 60 request / 60 detik, mengikuti header
`x-ratelimit-*` dan menangani 429 [keputusan desain untuk seluruh bagian ini]:

- **Prioritas:** (1) exit — quote untuk follow-sell dan untuk TP/SL/max hold yang sudah terpicu;
  (2) sinyal beli; (3) pemantauan rutin posisi.
- **Pemantauan tidak pernah kelaparan:** bila antrean penuh, siklus pemantauan berikutnya boleh
  digeser, tetapi setiap posisi terbuka tetap dicek setidaknya sekali per 60 detik. Kapasitas untuk
  itu dicadangkan lebih dulu sebelum sinyal beli dilayani.
- **Lonjakan sinyal beli** tidak membuat pembelian terlambat diam-diam: sinyal menunggu di antrean,
  dan bila saat gilirannya umur sinyal sudah melewati `MAX_SIGNAL_AGE_SECONDS`, sinyal ditolak
  `signal_too_old` tanpa memanggil Jupiter.
- Anggaran normal: tiap sinyal beli yang lolos tahap lokal ±2 request (data token + quote); dengan
  `MAX_OPEN_POSITIONS = 5` dan cek tiap 30 detik, pemantauan memakai ±10 request/menit.

## 12. Pengujian

- Setiap aturan risiko + kasus tepi (nol, decimals berbeda, data token kosong) — unit test di core.
- Matematika PnL & biaya (`bigint`/`decimal.js`), penjualan sebagian, porsi follow-sell.
- Agregasi laporan harian/mingguan dan penguraian penyebab — fungsi murni dengan data contoh.
- Executor paper & klien Jupiter dengan respons mock yang divalidasi zod; penjadwal rate limit.
- Query posisi/trade/settings — test integrasi MySQL (`TEST_DATABASE_URL`).
- Format pesan Telegram (escape, batas 4096).
- Tidak ada test yang memanggil API Jupiter sungguhan; tidak ada transaksi.

## 13. Diserahkan ke builder

Nama tabel/kolom baru, struktur modul di dalam folder yang sudah ditentukan `CLAUDE.md`, format
persis pesan Telegram (selama memuat isi di atas dan berbahasa Indonesia), strategi retry quote,
cara menyimpan snapshot quote, dan urutan pengerjaan.
