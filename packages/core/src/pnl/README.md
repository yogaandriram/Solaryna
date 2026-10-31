# PnL & penguraian penyebab

Semua jumlah dalam lamports (`bigint`), harga dalam lamports per unit token mentah (`Decimal`).
Ubah rumus di sini hanya bersama `position.test.ts` dan `report.test.ts`.

## Akuntansi posisi (`position.ts`)

- Modal sisa = `cost × tokenSisa / tokenAwal` (dibulatkan ke bawah).
- Penjualan sebagian merealisasikan `SOL diterima − cost × q / tokenAwal − biaya jual`; biaya beli
  ikut direalisasikan pada penjualan pertama.
- Penjualan terakhir merealisasikan sisa persis, sehingga total realisasi posisi selalu
  `total diterima − cost − semua biaya` tanpa selisih pembulatan.
- Follow-sell: porsi = jumlah dijual wallet ÷ saldo wallet sebelum swap; jual semua bila ≥ 100% atau
  saldo sebelum tidak diketahui.

## Exit (`exits.ts`)

Nilai bersih = `outAmount` quote jual seluruh sisa − biaya jual. Urutan cek: take-profit
(`nilai ≥ modal sisa × (100 + TP) / 100`), stop-loss (`nilai ≤ modal sisa × (100 − SL) / 100`),
max hold. Tanpa rute: tetap terbuka sampai max hold, lalu ditutup `unsellable` dengan nilai 0.

## Penguraian penyebab (`report.ts`)

Per posisi yang ditutup:

```
C   = modal (lamports)                    I = jumlah token awal
e   = C / I                               harga masuk kita
x   = total diterima / I                  harga keluar rata-rata kita (0 bila unsellable)
w_e = harga masuk wallet                  (swap beli wallet yang membuka posisi)
w_x = harga keluar rata-rata wallet       (swap jual wallet sesudah masuk, s.d. akhir periode)
      bila wallet belum menjual: w_x = x  (ditandai "wallet masih memegang")

wallet = C × (w_x / w_e − 1)              hasil wallet itu sendiri, diskalakan ke modal kita
masuk  = C × (w_x / e − w_x / w_e)        rugi/untung karena harga masuk kita beda dari wallet
keluar = (diterima − C) − wallet − masuk  = C × (x − w_x) / e; karena keluar lebih cepat/lambat

wallet + masuk + keluar = diterima − C    (bruto)
bersih = bruto − biaya
```

- Swap wallet ber-quote USDC dikonversi ke SOL dengan harga SOL/USD trade kita (beli untuk `w_e`,
  jual terakhir untuk `w_x`).
- Bila `w_e` (atau `w_x` dari penjualan wallet) tidak bisa dihitung, seluruh bruto posisi masuk
  `unattributed` ("tidak tersedia"), sehingga jumlah komponen tetap persis menjelaskan PnL.
- `wallet` dan `masuk` dibulatkan ke lamports terdekat (half-even); `keluar` adalah sisanya.
