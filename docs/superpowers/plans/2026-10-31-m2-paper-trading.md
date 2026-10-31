# M2 Paper Trading — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sinyal dari wallet incaran diputuskan oleh mesin risiko, dieksekusi sebagai paper trade
dengan quote Jupiter nyata, posisinya ditutup oleh follow-sell/TP/SL/max hold, dan hasilnya
dilaporkan harian & mingguan di Telegram beserta penguraian penyebab untung/rugi.

**Architecture:** Logika murni (risiko, akuntansi PnL, exit, waktu WIB, agregasi laporan) di
`packages/core`. Query posisi/trade/sinyal/settings di `packages/db`. Di `apps/bot`: klien Jupiter
dengan penjadwal rate limit berprioritas, executor paper (antarmuka `Executor` dua langkah
`prepare*` → `execute`), engine sinyal, monitor posisi, job laporan, dan perintah Telegram.

**Tech Stack:** TypeScript 6 strict, Node 22, zod 4, decimal.js (`Decimal` dari `@solaryna/core`),
Drizzle + MySQL 8, grammY, pino, vitest.

**Spec:** `docs/superpowers/specs/2026-10-31-m2-paper-trading-design.md` (wajib dibaca bersama
rencana ini; `CLAUDE.md` berlaku untuk semua task).

## Global Constraints

- Semua jumlah token/SOL `bigint` (DB: `rawAmount()` = `DECIMAL(40,0)`); harga, persen, PnL rasio
  pakai `Decimal`. Tidak ada `number` untuk uang.
- `packages/core/src` tanpa I/O: waktu (`now`) dan data dioper sebagai argumen (ESLint menegakkan).
- Respons API eksternal divalidasi zod; error dibungkus tipe dengan konteks (operasi, status) tanpa
  API key/URL berkunci.
- Jupiter: base `https://api.jup.ag`, header `x-api-key`; quote `GET /swap/v2/order` (tanpa
  `taker`); data token `GET /tokens/v2/search?query=<mint>`; batas bersama 60 request / 60 detik;
  429 + header `x-ratelimit-reset` (detik Unix). Cek ulang dokumentasi developers.jup.ag sebelum
  menulis klien.
- Biaya paper per transaksi: fee jaringan `5000n` lamports + priority fee `MAX_PRIORITY_FEE_LAMPORTS`
  - fee DEX/platform dari quote.
- Ukuran beli selalu `MAX_SOL_PER_TRADE`; `slippageBps = MAX_SLIPPAGE_BPS`; jeda `COPY_DELAY_MS`;
  `MAX_SIGNAL_AGE_SECONDS` default `30`; cek posisi tiap `30_000` ms; laporan harian 07.00 WIB,
  mingguan Senin 07.00 WIB (zona dari `TZ_DISPLAY`).
- Semua record trading `mode = 'paper'`; `LIVE_EXECUTOR_AVAILABLE` tetap `false`.
- Teks pengguna (Telegram) Bahasa Indonesia, teks on-chain di-escape (`escapeHtml`), pesan ≤ 4096
  karakter, laporan berlabel PAPER + "Hasil simulasi, bukan saran investasi."
- Kode, nama tabel, commit: bahasa Inggris, Conventional Commits, trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Kerjakan di branch `feat/m2-paper-trading`. Setiap task diakhiri `npm run typecheck`,
  `npm run lint`, test terkait hijau, lalu commit. Test DB dijalankan dengan
  `TEST_DATABASE_URL=mysql://root:@127.0.0.1:3306/solaryna_test`.
- Tidak ada test yang memanggil Jupiter/Helius/Telegram sungguhan.

## Review Focus

1. **Dua wallet membeli token yang sama dalam hitungan detik** → hanya satu posisi terbuka; slot
   `MAX_OPEN_POSITIONS` dihitung termasuk pembelian yang sedang berjalan. (Test di Task 10.)
2. **Follow-sell datang saat monitor sedang menjual posisi yang sama** (atau posisi baru saja
   ditutup) → tidak ada penjualan ganda / jumlah token negatif; posisi dibaca ulang di dalam lock.
   (Test di Task 10 dan 11.)
3. **Lonjakan request / 429 dari Jupiter** → penjadwal berhenti sampai `x-ratelimit-reset`, exit
   tetap didahulukan, permintaan monitor yang menunggu ≥ 30 detik naik prioritas. (Test di Task 8.)
4. **Bot restart / start pertama** → posisi terbuka dipantau lagi; laporan yang terlewat dikirim
   sekali; start pertama (belum ada cursor) tidak mengirim laporan kosong. (Test di Task 2 dan 14.)
5. **Wallet bertransaksi dalam USDC atau harga SOL/USD tidak tersedia** → penguraian penyebab
   menampilkan komponen `null` ("tidak tersedia"), bukan crash atau angka palsu. (Test di Task 4.)

---

### Task 1: Konfigurasi `MAX_SIGNAL_AGE_SECONDS` + tipe domain M2

**Files:**

- Modify: `packages/config/src/env.ts`, `packages/config/src/load.ts`,
  `packages/config/src/load.test.ts`, `.env.example`, `CLAUDE.md` (blok env)
- Modify: `packages/core/src/types.ts`, `packages/core/src/constants.ts`

**Interfaces:**

- Produces:
  - `RiskLimits.maxSignalAgeSeconds: number` (env `MAX_SIGNAL_AGE_SECONDS`, `integer(1, 3600)`, default `'30'`).
  - `TRADE_REASONS = ['copy_buy','follow_sell','take_profit','stop_loss','max_hold','unsellable'] as const`, `type TradeReason`.
  - `CLOSE_REASONS = ['follow_sell','take_profit','stop_loss','max_hold','unsellable','manual'] as const`, `type CloseReason`.
  - `BASE_NETWORK_FEE_LAMPORTS = 5000n`.

- [ ] **Step 1: Test** di `load.test.ts`: `it('defaults MAX_SIGNAL_AGE_SECONDS to 30 and rejects 0')` —
      `loadBotConfig(validBotEnv).risk.maxSignalAgeSeconds === 30`; `MAX_SIGNAL_AGE_SECONDS: '0'` →
      `ConfigError` yang menyebut `MAX_SIGNAL_AGE_SECONDS`.
- [ ] **Step 2:** `npx vitest run packages/config` → FAIL.
- [ ] **Step 3:** Tambah key di `botEnvSchema`, field di `RiskLimits`/`loadBotConfig`, baris di
      `.env.example` (grup batas risiko, komentar "Sinyal beli lebih tua dari ini ditolak") dan di
      blok env `CLAUDE.md`. Tambah konstanta & tipe core.
- [ ] **Step 4:** `npx vitest run packages/config` → PASS; `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(config): add MAX_SIGNAL_AGE_SECONDS and trading enums`.

### Task 2: Waktu zona tampilan & jadwal laporan (core)

**Files:**

- Create: `packages/core/src/time.ts`, `packages/core/src/time.test.ts`; export dari `index.ts`

**Interfaces:**

- Produces:
  - `interface PeriodRange { key: string; from: Date; to: Date }` (`to` eksklusif; `key` = `YYYY-MM-DD` hari pertama periode di zona tsb).
  - `zonedDateKey(date: Date, timeZone: string): string`
  - `startOfZonedDay(dateKey: string, timeZone: string): Date`
  - `zonedDayRange(date: Date, timeZone: string): PeriodRange`
  - `zonedWeekRange(date: Date, timeZone: string): PeriodRange` (Senin 00:00 s.d. Senin berikutnya)
  - `dueReports(input: { now: Date; timeZone: string; reportHour: number; lastDailyKey: string | null; lastWeeklyKey: string | null }): { daily: PeriodRange | null; weekly: PeriodRange | null; initialize: { dailyKey: string; weeklyKey: string } | null }`

- [ ] **Step 1: Tests**
  - `startOfZonedDay('2026-10-31','Asia/Jakarta').toISOString() === '2026-10-30T17:00:00.000Z'`
  - `zonedDayRange(new Date('2026-10-30T18:00:00Z'),'Asia/Jakarta')` → key `'2026-10-31'`, `to` = `'2026-10-31T17:00:00.000Z'`.
  - `zonedWeekRange(new Date('2026-11-01T10:00:00Z'),'Asia/Jakarta')` (Minggu) → key `'2026-10-26'`.
  - `dueReports` pada `2026-11-02T00:30:00Z` (Senin 07.30 WIB), `lastDailyKey: '2026-10-31'`, `lastWeeklyKey: '2026-10-19'` → `daily.key === '2026-11-01'`, `weekly.key === '2026-10-26'`.
  - Sebelum 07.00 WIB → `daily === null`. Cursor sudah terkini → keduanya `null`.
  - Kedua cursor `null` → `daily` & `weekly` `null`, `initialize` berisi key periode terakhir yang sudah lewat (start pertama tidak mengirim laporan).
- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Implementasi. Offset zona via `Intl.DateTimeFormat(..., { timeZoneName: 'longOffset' })`
      (`"GMT+07:00"`); `startOfZonedDay`: tebak `Date.UTC(y, m-1, d)` lalu kurangi offset pada titik
      itu, ulangi sekali untuk zona ber-DST. `dueReports` hanya melaporkan periode **terakhir** yang
      sudah lewat (tidak mengejar beberapa hari mundur).
- [ ] **Step 4:** PASS. **Step 5:** Commit `feat(core): add zoned day/week ranges and report schedule`.

### Task 3: Akuntansi posisi, exit, dan follow-sell (core)

**Files:**

- Create: `packages/core/src/pnl/position.ts`, `packages/core/src/pnl/exits.ts`,
  `packages/core/src/pnl/index.ts`, `packages/core/src/pnl/position.test.ts`,
  `packages/core/src/pnl/exits.test.ts`; export dari `index.ts`

**Interfaces:**

- Produces:
  - `interface PositionState { initialTokenAmountRaw: bigint; tokenAmountRaw: bigint; costLamports: bigint; proceedsLamports: bigint; feesLamports: bigint; realizedPnlLamports: bigint }` (`feesLamports` = semua biaya yang sudah terjadi, termasuk beli).
  - `remainingCostLamports(state): bigint` = `costLamports × tokenAmountRaw / initialTokenAmountRaw` (floor).
  - `applySell(state, sell: { tokenAmountRaw: bigint; solAmountLamports: bigint; feesLamports: bigint }): { next: PositionState; realizedPnlLamports: bigint; closed: boolean }`
  - `followSellTokenAmount(positionTokenAmountRaw: bigint, walletSoldRaw: bigint, walletBalanceBeforeRaw: bigint | null): bigint`
  - `type ExitTrigger = 'take_profit' | 'stop_loss' | 'max_hold' | 'unsellable'`
  - `evaluateExit(input: { remainingCostLamports: bigint; netValueLamports: bigint | null; openedAt: Date; now: Date; takeProfitPct: Decimal; stopLossPct: Decimal; maxHoldMinutes: number }): ExitTrigger | null`

Aturan `applySell` (algoritma yang ditetapkan rencana):

```
partial (q < tokenAmountRaw):
  realized = solOut − cost×q/initial − sellFees − (proceeds == 0 ? feesSoFar : 0)   // biaya beli direalisasi di penjualan pertama
final (q == tokenAmountRaw):
  realized = (proceeds + solOut) − cost − (fees + sellFees) − realizedSoFar            // sisa persis, total = PnL bersih posisi
q > tokenAmountRaw → throw RangeError
```

`evaluateExit`: `netValue === null` → `'unsellable'` bila umur ≥ max hold, selain itu `null`. Urutan
cek: TP (`net ≥ cost × (100+TP)/100`), SL (`net ≤ cost × (100−SL)/100`), lalu max hold.

- [ ] **Step 1: Tests** (nilai persis):
  - Posisi `initial=1_000_000n, cost=50_000_000n, fees=205_000n`: jual 400_000 token untuk 30_000_000 lamports, fee jual 205_000 → `realized = 30_000_000 − 20_000_000 − 205_000 − 205_000 = 9_590_000n`, `closed=false`.
  - Lalu jual sisa 600_000 untuk 10_000_000, fee 205_000 → `realized` membuat total `realizedPnl === (40_000_000 − 50_000_000 − 615_000) = −10_615_000n`, `closed=true`.
  - `applySell` dengan q > sisa → `RangeError`.
  - `followSellTokenAmount(1000n, 250n, 1000n) === 250n`; `(1000n, 2000n, 1000n) === 1000n`; `(1000n, 5n, null) === 1000n`; `(3n, 1n, 1000n) === 0n` (porsi terlalu kecil → 0; engine menolak dengan `sell_amount_zero`).
  - `evaluateExit`: cost 50_000_000, TP 100, SL 30, max 240: net 100_000_000 → `'take_profit'`; net 35_000_000 → `'stop_loss'`; net 60_000_000 umur 241 menit → `'max_hold'`; `null` umur 10 menit → `null`; `null` umur 241 → `'unsellable'`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(core): add position accounting, exit rules, follow-sell sizing`.

### Task 4: Aturan risiko dan agregasi laporan (core)

**Files:**

- Create: `packages/core/src/risk/types.ts`, `packages/core/src/risk/rules.ts`,
  `packages/core/src/risk/index.ts`, `packages/core/src/risk/rules.test.ts`
- Create: `packages/core/src/pnl/report.ts`, `packages/core/src/pnl/report.test.ts`,
  `packages/core/src/pnl/README.md` (rumus penguraian)

**Interfaces:**

- Produces (risk):
  - `RISK_REASON_CODES` (urutan tabel §5 spec + kode khusus jual `'not_holding'`, `'sell_amount_zero'`), `type RiskReasonCode`.
  - `interface RiskReason { code: RiskReasonCode; detail?: Record<string, string | number | boolean | null> }` (angka Decimal/bigint sebagai string).
  - `interface RiskResult { decision: 'accepted' | 'rejected'; reasons: RiskReason[] }`
  - `interface RiskLimitsInput { maxOpenPositions: number; dailyLossLimitLamports: bigint; minLiquidityUsd: Decimal; maxSlippageBps: number; maxSignalAgeSeconds: number }`
  - `interface TokenMarketData { liquidityUsd: Decimal | null; mintAuthorityActive: boolean; freezeAuthorityActive: boolean; suspicious: boolean; createdAt: Date | null }`
  - `evaluateLocalRisk(input: { limits: RiskLimitsInput; tradingPaused: boolean; openPositionCount: number; holdingToken: boolean; realizedPnlTodayLamports: bigint; tokenBlacklisted: boolean; walletCooldownUntil: Date | null; signalBlockTime: Date; now: Date }): RiskResult`
  - `evaluateMarketRisk(input: { limits: RiskLimitsInput; token: TokenMarketData | null; quote: { priceImpactPct: Decimal } | null }): RiskResult` (`token === null` → `token_data_unavailable`; `quote === null` → `no_route`; liquidity `null` → `liquidity_below_min` dengan `actual: null`).
- Produces (report):
  - `interface WalletLeg { quoteMint: string; quoteAmountRaw: bigint; quoteDecimals: number; tokenAmountRaw: bigint }`
  - `interface ReportPosition { id: number; tokenMint: string; tokenSymbol: string | null; tokenDecimals: number; walletId: number | null; walletAddress: string | null; walletLabel: string | null; closeReason: CloseReason; costLamports: bigint; initialTokenAmountRaw: bigint; proceedsLamports: bigint; feesLamports: bigint; realizedPnlLamports: bigint; walletEntry: WalletLeg | null; walletExits: WalletLeg[]; buySolUsd: Decimal | null; exitSolUsd: Decimal | null }`
  - `interface ReportTrade { side: SwapSide; reason: TradeReason; networkFeeLamports: bigint; priorityFeeLamports: bigint; dexFeeLamports: bigint; realizedPnlLamports: bigint | null }`
  - `interface ReportSignal { walletId: number; decision: 'accepted' | 'rejected'; reasons: RiskReason[] }` (hanya sinyal beli)
  - `interface Decomposition { walletLamports: bigint | null; entryLamports: bigint | null; exitLamports: bigint | null; feesLamports: bigint; walletStillHolding: boolean }`
  - `decomposePosition(p: ReportPosition): Decomposition`
  - `buildDailySummary(input: { trades: ReportTrade[]; closedPositions: ReportPosition[]; signals: ReportSignal[]; open: { remainingCostLamports: bigint; netValueLamports: bigint | null }[] }): DailySummary` — `{ realizedPnlLamports, buys, sells, wins, losses, fees: { network, priority, dex, total }, openCount, unrealizedPnlLamports: bigint | null, acceptedSignals, rejectedSignals, topRejections: { code, count }[] }` (top 3).
  - `buildWeeklyReport(input: { trades; closedPositions; signals }): WeeklyReport` — `{ totals (seperti DailySummary tanpa open), winRate: Decimal | null, perWallet: { walletId, walletAddress, walletLabel, buySignals, positions, realizedPnlLamports, winRate, decomposition: Decomposition }[], decomposition: Decomposition, perExitReason: { reason: CloseReason, count, realizedPnlLamports }[], rejectedByReason: { code, count }[], best: ReportPosition | null, worst: ReportPosition | null }`.

Rumus penguraian (tulis juga di `pnl/README.md`): harga dalam SOL per token mentah, `Decimal`.

```
C = costLamports;  e = C / initialTokenAmountRaw            (harga masuk kita)
x = proceedsLamports / initialTokenAmountRaw                (harga keluar rata-rata kita; 0 bila unsellable)
w_e = harga masuk wallet (quote/token; USDC → ÷ buySolUsd)  (null bila tak bisa dihitung)
w_x = Σquote/Σtoken dari walletExits (USDC → ÷ exitSolUsd)  (null bila wallet belum jual)
bila w_x null tapi w_e ada: w_x := x, walletStillHolding = true
wallet = C × (w_x/w_e − 1)
entry  = C × (w_x/e − w_x/w_e)
exit   = C × (x/e − w_x/e)
wallet + entry + exit = proceeds − C (bruto);  fees = feesLamports;  bersih = bruto − fees
w_e null → wallet/entry/exit semuanya null (bruto tetap terlihat dari total)
```

Pembulatan ke lamports: `Decimal.toFixed(0, ROUND_HALF_EVEN)` → `BigInt`; selisih pembulatan
dimasukkan ke `exit` agar ketiganya tetap berjumlah persis bruto.

- [ ] **Step 1: Tests risk** — satu `it` per kode alasan (kondisi tepat di batas: liquidity = min →
      lolos; posisi = max → ditolak; rugi hari ini = −limit → ditolak; umur = batas detik → lolos,
      +1 ms → `signal_too_old`), plus: beberapa alasan sekaligus terkumpul semua; semua lolos →
      `accepted` dengan `reasons: []`; `detail` likuiditas `{ actual: '12300', min: '20000' }`.
- [ ] **Step 2: Tests report**
  - `decomposePosition`: C=1 SOL, 1000 token, proceeds 1,5 SOL, wallet masuk 0,9 SOL/1000 token, keluar 1,8 SOL/1000 token → `wallet=1_000_000_000n`, `entry = −500_000_000n`... (hitung dari rumus; assert `wallet+entry+exit === 500_000_000n`).
  - Wallet belum jual → `walletStillHolding: true`, `exit === 0n`.
  - Wallet USDC & `buySolUsd: null` → semua komponen `null`.
  - `unsellable` (proceeds 0) → bruto `−C`, tidak crash.
  - `buildWeeklyReport`: dua wallet → `perWallet` terurut PnL naik (terburuk dulu), `perExitReason` menjumlah benar, `rejectedByReason` menghitung setiap kode per sinyal.
- [ ] **Step 3:** FAIL → implementasi → PASS.
- [ ] **Step 4:** Commit `feat(core): add risk rules and PnL report aggregation`.

### Task 5: Saldo token wallet sebelum swap + konteks ingest

**Files:**

- Modify: `packages/core/src/swap/normalize.ts`, `packages/core/src/swap/normalize.test.ts`
- Modify: `apps/bot/src/ingest/ingestor.ts`, `apps/bot/src/ingest/ingestor.test.ts`

**Interfaces:**

- Produces:
  - `SwapBreakdown.walletTokenBalanceBeforeRaw: bigint` (jumlah `pre ?? 0n` semua akun milik wallet untuk `tokenMint`).
  - `IngestorDeps.saveSwapEvent(event, raw): Promise<{ status: 'inserted'; id: number } | { status: 'duplicate' }>` (sama dengan return `insertSwapEvent`).
  - `IngestorDeps.now?: () => Date`.
  - `interface NewSwapContext { swapEventId: number; receivedAt: Date; walletTokenBalanceBeforeRaw: bigint }`; `onNewSwap(event, wallet, context: NewSwapContext): void`.

- [ ] **Step 1: Tests** — fixture `pumpfun-sell-v1`: `walletTokenBalanceBeforeRaw` ≥ `tokenAmountRaw`
      (assert nilai persis dari fixture); fixture `pumpfun-buy-v1-new-ata` → `0n`. Ingestor test:
      `onNewSwap` menerima `{ swapEventId: 1, receivedAt: <now palsu>, walletTokenBalanceBeforeRaw }`.
- [ ] **Step 2:** FAIL → implementasi → PASS (`npx vitest run packages/core apps/bot/src/ingest`).
- [ ] **Step 3:** Perbarui pemanggil di `main.ts` agar tetap typecheck (`saveSwapEvent: (e, raw) => insertSwapEvent(db, e, raw)`; `onNewSwap` mengabaikan konteks sampai Task 15).
- [ ] **Step 4:** Commit `feat: expose wallet token balance before swap to the engine`.

### Task 6: Skema & query trading (db)

**Files:**

- Modify: `packages/db/src/schema.ts`; Generate: `packages/db/migrations/0001_*.sql` (`npm run db:generate`)
- Create: `packages/db/src/trading.ts`, `packages/db/src/trading.test.ts`,
  `packages/db/src/test-db.ts`; Modify: `packages/db/src/queries.test.ts` (pakai helper),
  `packages/db/src/index.ts`, `vitest.config.ts`

**Interfaces:**

- Skema:
  - `signals`: + `receivedAt: utcDatetime('received_at')`, + `riskInputs: json('risk_inputs')`, `reasons` bertipe `RiskReason[]`.
  - `positions`: + `initialTokenAmountRaw: rawAmount('initial_token_amount_raw').notNull()`, `closeReason` memakai `CLOSE_REASONS`.
  - `trades`: + `reason: mysqlEnum('reason', TRADE_REASONS).notNull()`, + `realizedPnlLamports: rawAmount('realized_pnl_lamports')`, + `solUsdPrice: decimal('sol_usd_price', { precision: 30, scale: 12 })`, + `quotedAt: utcDatetime('quoted_at')`.
- Produces (`trading.ts`, semua menerima `db: Database` sebagai argumen pertama):
  - `type PositionRow`, `type TradeRow`, `type NewSignal = typeof signals.$inferInsert`, `NewPosition`, `NewTrade` (tanpa id/FK yang diisi fungsi).
  - `isTradingPaused(db): Promise<boolean>`; `setTradingPaused(db, paused: boolean, audit: AuditActor): Promise<boolean /* berubah? */>` (setting `trading_paused` + `audit_log` action `trading.pause`/`trading.resume` dalam satu transaksi).
  - `getSettingString(db, name): Promise<string | null>`; `setSettingString(db, name, value): Promise<void>`.
  - `insertSignal(db, signal: NewSignal): Promise<number>`
  - `openPosition(db, input: { signal: NewSignal; position: Omit<NewPosition,'openedFromSignalId'>; trade: Omit<NewTrade,'positionId'|'signalId'> }): Promise<{ signalId; positionId; tradeId }>` (satu transaksi).
  - `recordSell(db, input: { signal: NewSignal | null; positionId: number; trade: Omit<NewTrade,'positionId'|'signalId'>; position: Pick<NewPosition,'tokenAmountRaw'|'proceedsLamports'|'feesLamports'|'realizedPnlLamports'|'status'|'closeReason'|'closedAt'> }): Promise<{ signalId: number | null; tradeId: number }>` (satu transaksi).
  - `listOpenPositions(db, mode): Promise<PositionRow[]>`; `findOpenPositionByToken(db, mode, tokenMint)`; `getPosition(db, id)`.
  - `sumRealizedPnl(db, mode, from: Date, to: Date): Promise<bigint>` (jumlah `trades.realized_pnl_lamports`, `executed_at` ∈ [from, to)).
  - `getWalletCooldown(db, walletId): Promise<Date | null>`; `isTokenBlacklisted(db, mint): Promise<boolean>`.
  - `saveTokenMarketData(db, input: { mint; decimals; liquidityUsd: Decimal | null; mintAuthorityActive; freezeAuthorityActive; tokenCreatedAt: Date | null; fetchedAt: Date }): Promise<void>` (upsert; tidak menimpa symbol/name).
  - `test-db.ts`: `useTestDatabase(): { db: Database }` — memuat pola `beforeAll/beforeEach/afterAll` dari `queries.test.ts` (cek nama DB berisi "test", migrate, kosongkan tabel).
- `vitest.config.ts`: `fileParallelism: process.env.TEST_DATABASE_URL === undefined` (file test DB berbagi satu database).

- [ ] **Step 1:** Ubah skema, `npm run db:generate`, periksa SQL migrasi (hanya ALTER yang diharapkan).
- [ ] **Step 2: Tests** (`describe.skipIf(!TEST_DATABASE_URL)`): pause toggle + audit (`setTradingPaused(true)` dua kali → `true` lalu `false`, satu baris audit); `openPosition` lalu `recordSell` parsial & final memperbarui posisi dan `sumRealizedPnl` hari itu = jumlah realized trade; `findOpenPositionByToken` tidak mengembalikan posisi closed; `rawAmount` 10^30 tersimpan utuh; rollback bila insert trade gagal (posisi tidak tertinggal).
- [ ] **Step 3:** FAIL → implementasi → PASS (dengan `TEST_DATABASE_URL`), juga `queries.test.ts` tetap lulus.
- [ ] **Step 4:** Commit `feat(db): add trading schema changes and queries`.

### Task 7: Query laporan (db)

**Files:**

- Create: `packages/db/src/reports.ts`, `packages/db/src/reports.test.ts`; export dari `index.ts`

**Interfaces:**

- Consumes: tipe `ReportPosition`, `ReportTrade`, `ReportSignal`, `WalletLeg` dari Task 4.
- Produces:
  - `listReportTrades(db, mode, from, to): Promise<ReportTrade[]>`
  - `listReportBuySignals(db, mode, from, to): Promise<ReportSignal[]>` (join `swap_events.side = 'buy'`, `signals.created_at` ∈ periode)
  - `listClosedReportPositions(db, mode, from, to): Promise<ReportPosition[]>` — posisi `closed_at` ∈ periode; `walletEntry` dari swap event sinyal pembuka; `walletExits` = swap event `sell` wallet itu untuk token itu dengan `block_time` > masuk wallet dan < `to`; `buySolUsd`/`exitSolUsd` dari trade beli / trade jual terakhir; `tokenSymbol` dari `tokens`.

- [ ] **Step 1: Tests** dengan data seed: posisi ditutup di dalam & di luar periode (hanya yang di dalam); wallet exit sebelum masuk wallet tidak ikut; sinyal sell tidak ikut `listReportBuySignals`.
- [ ] **Step 2:** FAIL → implementasi → PASS. **Step 3:** Commit `feat(db): add report queries`.

### Task 8: Penjadwal rate limit & klien Jupiter

**Files:**

- Create: `apps/bot/src/jupiter/rate-limiter.ts`, `apps/bot/src/jupiter/rate-limiter.test.ts`,
  `apps/bot/src/jupiter/client.ts`, `apps/bot/src/jupiter/client.test.ts`

**Interfaces:**

- Produces:
  - `type RequestPriority = 'exit' | 'buy' | 'monitor'`
  - `createRateLimiter(options?: { minIntervalMs?: number /* 1000 */; promoteAfterMs?: number /* 30_000 */; now?: () => number; sleep?: (ms: number) => Promise<void> }): RateLimiter`
  - `interface RateLimiter { schedule<T>(priority: RequestPriority, task: () => Promise<T>): Promise<T>; pauseUntil(epochMs: number): void; readonly pending: number }`
  - `class JupiterApiError extends Error { operation; status: number | null }`
  - `interface JupiterOrder { inAmountRaw: bigint; outAmountRaw: bigint; minOutAmountRaw: bigint; priceImpactPct: Decimal; slippageBps: number; feeBps: number; platformFee: { amountRaw: bigint; mint: string } | null; inUsdValue: Decimal | null; outUsdValue: Decimal | null; router: string; snapshot: unknown }`
  - `interface JupiterToken { mint: string; decimals: number; market: TokenMarketData; usdPrice: Decimal | null }`
  - `createJupiterClient(options: { apiKey: Secret; limiter: RateLimiter; fetch?: typeof fetch; baseUrl?: string; timeoutMs?: number }): JupiterClient`
  - `interface JupiterClient { getOrder(params: { inputMint: string; outputMint: string; amountRaw: bigint; slippageBps: number }, priority: RequestPriority): Promise<JupiterOrder | null /* tanpa rute */>; getToken(mint: string, priority: RequestPriority): Promise<JupiterToken | null> }`

Penjadwal: antrean berprioritas `exit` < `buy` < `monitor`, FIFO di prioritas yang sama; request
`monitor` yang menunggu ≥ `promoteAfterMs` diperlakukan sebagai `exit`; jarak antar-mulai request ≥
`minIntervalMs`; `pauseUntil` menahan semua request sampai waktu itu. Klien: pada 429 panggil
`limiter.pauseUntil(x-ratelimit-reset × 1000, atau now + 1000 bila header tidak ada)` lalu ulang
maksimal 2 kali melalui penjadwal. `mintAuthorityActive = mintAuthority != null ||
audit?.mintAuthorityDisabled === false` (sama untuk freeze); `suspicious = audit?.isSus !== undefined`;
`createdAt` dari `createdAt` atau `firstPool.createdAt`. Builder memastikan dari dokumentasi Jupiter
bentuk respons "tanpa rute" (mis. 400 dengan pesan rute / `routePlan` kosong) → `null`; error lain →
`JupiterApiError`. Pesan error tidak memuat key.

- [ ] **Step 1: Tests limiter** (jam palsu): urutan eksekusi `monitor, buy, exit` yang diantrekan bersamaan → `exit, buy, monitor`; `monitor` yang sudah menunggu 30 detik mendahului `buy` baru; jarak ≥ 1000 ms; `pauseUntil(now+5000)` menunda request berikutnya 5000 ms; task yang throw tidak menghentikan antrean.
- [ ] **Step 2: Tests klien** (fetch mock): query `/swap/v2/order` berisi `inputMint, outputMint, amount, slippageBps` dan header `x-api-key`, tanpa `taker`; parsing `outAmount` string → `bigint`; 429 dengan `x-ratelimit-reset` → `pauseUntil` dipanggil lalu sukses di percobaan kedua; respons tanpa rute → `null`; token: `mintAuthority: null` + `audit.mintAuthorityDisabled: true` → `false`, `audit.isSus: true` → `suspicious`, array kosong → `null`; error tidak memuat API key.
- [ ] **Step 3:** FAIL → implementasi → PASS. **Step 4:** Commit `feat(bot): add Jupiter client with prioritized rate limiting`.

### Task 9: Executor paper

**Files:**

- Create: `apps/bot/src/executor/types.ts`, `apps/bot/src/executor/paper.ts`,
  `apps/bot/src/executor/paper.test.ts`

**Interfaces:**

- Consumes: `JupiterClient`, `RequestPriority` (Task 8); `BASE_NETWORK_FEE_LAMPORTS` (Task 1).
- Produces:
  - `interface PreparedOrder { side: SwapSide; tokenMint: string; inAmountRaw: bigint; outAmountRaw: bigint; priceImpactPct: Decimal; quote: JupiterOrder; quotedAt: Date }`
  - `type PrepareResult = { ok: true; order: PreparedOrder } | { ok: false; reason: 'no_route' }`
  - `interface TradeFill { side: SwapSide; tokenMint: string; tokenAmountRaw: bigint; solAmountLamports: bigint; networkFeeLamports: bigint; priorityFeeLamports: bigint; dexFeeLamports: bigint; slippageBps: number; solUsdPrice: Decimal | null; quotedAt: Date; executedAt: Date; quoteSnapshot: unknown; txSignature: string | null }`
  - `interface Executor { readonly mode: TradingMode; prepareBuy(p: { tokenMint: string; solAmountLamports: bigint }, priority: RequestPriority): Promise<PrepareResult>; prepareSell(p: { tokenMint: string; tokenAmountRaw: bigint }, priority: RequestPriority): Promise<PrepareResult>; execute(order: PreparedOrder): Promise<TradeFill> }`
  - `createPaperExecutor(options: { jupiter: JupiterClient; slippageBps: number; priorityFeeLamports: bigint; now: () => Date }): Executor`

Paper: beli = WSOL→token (`tokenAmountRaw = outAmount`, `solAmountLamports = inAmount`); jual =
token→WSOL (`solAmountLamports = outAmount`). `dexFeeLamports` dari `platformFee` (mint WSOL →
apa adanya; mint token → dikonversi dengan rasio SOL/token quote itu, floor). Builder memeriksa di
dokumentasi apakah `outAmount` sudah neto `platformFee`; fee dicatat terpisah dan **tidak**
dikurangkan dua kali. `solUsdPrice = usdValue sisi SOL ÷ jumlah SOL` atau `null`. `txSignature = null`.

- [ ] **Step 1: Tests:** beli 50_000_000 lamports → quote diminta dengan `amountRaw 50_000_000n`, `slippageBps` dari opsi, prioritas diteruskan; fill memakai `outAmount`, fee jaringan `5000n`, priority fee = opsi; platform fee dalam token dikonversi ke lamports; `no_route` bila klien `null`; `solUsdPrice` dari `inUsdValue`.
- [ ] **Step 2:** FAIL → implementasi → PASS. **Step 3:** Commit `feat(bot): add paper executor`.

### Task 10: Engine sinyal

**Files:**

- Create: `apps/bot/src/engine/store.ts` (antarmuka + adapter DB), `apps/bot/src/engine/locks.ts`,
  `apps/bot/src/engine/engine.ts`, `apps/bot/src/engine/engine.test.ts`,
  `apps/bot/src/engine/fake-store.ts` (store in-memory untuk test)

**Interfaces:**

- Consumes: Task 3, 4, 6, 8, 9.
- Produces:
  - `interface TradingStore` — metode setara fungsi Task 6 tanpa argumen `db` (`isTradingPaused`, `setTradingPaused`, `insertSignal`, `openPosition`, `recordSell`, `listOpenPositions`, `findOpenPositionByToken`, `getPosition`, `sumRealizedPnl`, `getWalletCooldown`, `isTokenBlacklisted`, `saveTokenMarketData`, `getSettingString`, `setSettingString`) + `createDbTradingStore(db): TradingStore`.
  - `interface KeyedMutex { run<T>(key: string, task: () => Promise<T>): Promise<T> }`; `createKeyedMutex(): KeyedMutex`
  - `type SignalOutcome = { decision: 'accepted'; side: SwapSide; fill: TradeFill; soldPct: Decimal | null /* jual saja */ } | { decision: 'rejected'; side: SwapSide; reasons: RiskReason[] } | { decision: 'failed'; side: SwapSide; message: string }` (`failed` = error Jupiter/DB setelah keputusan; baris alert "🧪 Paper: gagal dieksekusi")
  - `interface TradingEvents { tradeExecuted(e: { fill: TradeFill; position: PositionRow; walletEvent: SwapEvent | null; reason: TradeReason; realizedPnlLamports: bigint | null }): void; positionClosed(e: { position: PositionRow; reason: CloseReason }): void; executionError(e: { tokenMint: string; side: SwapSide; message: string }): void }`
  - `createEngine(deps: { store: TradingStore; executor: Executor; jupiter: Pick<JupiterClient,'getToken'>; locks: KeyedMutex; limits: RiskLimits; displayTimeZone: string; now: () => Date; sleep: (ms: number) => Promise<void>; events: TradingEvents; logger: Logger }): { handleSwap(event: SwapEvent, wallet: TrackedWalletInfo, context: NewSwapContext): Promise<SignalOutcome> }`

Alur `handleSwap` mengikuti §4 spec persis. Detail yang ditetapkan rencana:

- Beli: token dimasukkan ke `pendingBuys: Set<string>` sebelum tahap lokal dan dikeluarkan di
  `finally`; `openPositionCount = posisi terbuka + pendingBuys.size` (tanpa token sendiri),
  `holdingToken = posisi terbuka token itu || pendingBuys.has(token)` dicek **sebelum** menambah.
- Umur sinyal dicek di tahap lokal dan sekali lagi di dalam task penjadwal tepat sebelum request
  Jupiter pertama (antrean rate limit).
- `getToken` (prioritas `buy`) lalu `prepareBuy` (prioritas `buy`); hasil `getToken` disimpan via
  `saveTokenMarketData`.
- Kill switch dibaca dari store tepat sebelum `execute`.
- Simpan: tolak → `insertSignal` (dengan `reasons`, `riskInputs`, `receivedAt`); terima → `openPosition`
  (posisi `initialTokenAmountRaw = tokenAmountRaw = fill.tokenAmountRaw`, `costLamports = fill.solAmountLamports`,
  `feesLamports` = total fee, `realizedPnlLamports = 0n`, `proceedsLamports = 0n`).
- Jual: `findOpenPositionByToken` dengan `trackedWalletId === wallet.id`, jika tidak → `rejected
not_holding`; tunggu `COPY_DELAY_MS` (§4 spec); lalu di dalam `locks.run(tokenMint)`: baca ulang
  posisi (sudah closed → `not_holding`), porsi via `followSellTokenAmount` (`0n` →
  `sell_amount_zero`), `prepareSell` prioritas `exit`, cek pause, `execute`, `applySell`,
  `recordSell` (reason `follow_sell`). Tanpa batas umur sinyal.
- [keputusan rencana] Follow-sell yang datang saat pause ditolak `trading_paused` dan tidak
  diantrekan; posisinya tetap terbuka dan ditangani monitor (TP/SL/max hold) setelah `/resume`.
- Error Jupiter/DB → `events.executionError` + log, outcome `failed`; sinyal tetap dicatat bila
  keputusan sudah ada.

- [ ] **Step 1: Tests** (fake store, executor palsu, `sleep` palsu, jam palsu):
  - beli lolos → satu posisi + satu trade `copy_buy`, `sleep` dipanggil dengan `COPY_DELAY_MS`;
  - tahap lokal gagal (pause) → tidak ada panggilan Jupiter, sinyal `rejected` `trading_paused`;
  - likuiditas rendah → `rejected liquidity_below_min`, quote tidak dieksekusi;
  - pause diaktifkan selama jeda → `rejected trading_paused`, tidak ada posisi;
  - **dua `handleSwap` beli token sama bersamaan** → satu `accepted`, satu `already_holding`;
  - `MAX_OPEN_POSITIONS=1` dengan dua token berbeda bersamaan → satu ditolak `max_open_positions`;
  - sinyal terlalu tua → `signal_too_old` tanpa request Jupiter;
  - follow-sell 25% → `sleep(COPY_DELAY_MS)`, trade jual 25% posisi, posisi tetap open; follow-sell dari wallet lain → `not_holding`; porsi `0n` → `sell_amount_zero` tanpa request Jupiter; follow-sell saat pause → `trading_paused`, posisi tetap open;
  - **follow-sell setelah posisi ditutup monitor** (posisi closed di store saat lock diperoleh) → `not_holding`, tidak ada trade.
- [ ] **Step 2:** FAIL → implementasi → PASS. **Step 3:** Commit `feat(bot): add signal engine`.

### Task 11: Monitor posisi (exits)

**Files:**

- Create: `apps/bot/src/exits/monitor.ts`, `apps/bot/src/exits/monitor.test.ts`

**Interfaces:**

- Consumes: `TradingStore`, `Executor`, `KeyedMutex`, `TradingEvents` (Task 10), `evaluateExit`,
  `applySell`, `remainingCostLamports` (Task 3).
- Produces:
  - `interface Valuation { positionId: number; netValueLamports: bigint | null; remainingCostLamports: bigint; at: Date }`
  - `interface PositionMonitor { runOnce(): Promise<void>; start(): void; stop(): Promise<void> /* menunggu siklus berjalan */; valuation(positionId: number): Valuation | undefined }`
  - `createPositionMonitor(deps: { store; executor; locks; limits: RiskLimits; priorityFeeLamports: bigint; now; events; logger; intervalMs?: number /* 30_000 */ }): PositionMonitor`

`runOnce`: untuk tiap posisi terbuka (urut), di dalam `locks.run(tokenMint)`: baca ulang posisi
(lewati bila sudah closed); `prepareSell(seluruh sisa, 'monitor')`; `netValue = outAmount −
(BASE_NETWORK_FEE_LAMPORTS + priorityFeeLamports + dexFee)` atau `null` bila `no_route`; simpan
valuasi; `evaluateExit`; bila terpicu dan tidak pause → `execute` order yang sama (tanpa quote baru),
`applySell`, `recordSell` dengan reason = trigger, `events.tradeExecuted` + `positionClosed`.
`unsellable` → `recordSell` dengan fill nol (0 SOL, fee 0, `tokenAmountRaw` = sisa). Satu posisi gagal
tidak menghentikan posisi lain. Gagal quote pemantauan rutin hanya `logger.warn` (tidak ke
Telegram); `events.executionError` hanya bila exit sudah terpicu tetapi eksekusi/penyimpanan gagal. `runOnce` tidak berjalan tumpang-tindih (siklus berikut dilewati bila
sebelumnya belum selesai).

- [ ] **Step 1: Tests:** TP terpicu → posisi closed reason `take_profit`, PnL = hasil `applySell`; nilai di antara TP & SL → tidak ada trade, valuasi tersimpan; pause → tidak menjual walau SL terpicu; `no_route` sebelum max hold → tetap open; setelah max hold → closed `unsellable` dengan proceeds 0; **posisi sudah ditutup engine saat lock diperoleh** → dilewati; error satu posisi → posisi berikutnya tetap dicek.
- [ ] **Step 2:** FAIL → implementasi → PASS. **Step 3:** Commit `feat(bot): add position monitor for exits`.

### Task 12: Format pesan trading & laporan (Telegram)

**Files:**

- Create: `apps/bot/src/telegram/trading-format.ts`, `apps/bot/src/telegram/trading-format.test.ts`
- Modify: `apps/bot/src/telegram/format.ts` (`formatStartupMessage`: hapus baris "Versi ini baru
  mengirim alert…", tambah `paused: boolean` → baris "Status: ⏸ dijeda" atau "Paper trading aktif")

**Interfaces:**

- Produces:
  - `describeRiskReason(reason: RiskReason): string` (Indonesia; mis. `liquidity_below_min` → `"likuiditas $12.300 < $20.000"`, `signal_too_old` → `"sinyal terlambat 45 dtk (maks 30)"`).
  - `formatDecisionLine(outcome: SignalOutcome): string` → `"🧪 Paper: diikuti"` / `"🧪 Paper: dilewati — <alasan1>; <alasan2>"` / follow-sell: `"🧪 Paper: ikut jual 25%"` / `"🧪 Paper: gagal dieksekusi"`. Jual `not_holding` → `"🧪 Paper: tidak memegang token ini"`.
  - `formatTradeExecuted(input: { fill: TradeFill; token: TokenLabel; wallet: TrackedWalletInfo | null; walletEvent: SwapEvent | null; reason: TradeReason; realizedPnlLamports: bigint | null; tokenDecimals: number; timeZone: string }): string` — memuat jumlah, harga, biaya per jenis, dan selisih harga vs wallet (%) bila `walletEvent` ber-quote SOL.
  - `formatPositionClosed(input: { position: PositionRow; reason: CloseReason; token: TokenLabel }): string` — modal, hasil, PnL bersih SOL & %, total biaya.
  - `formatStatus(input: { mode: TradingMode; paused: boolean; openCount: number; realizedTodayLamports: bigint }): string`
  - `formatPositions(items: { position: PositionRow; token: TokenLabel; walletLabel: string | null; valuation: Valuation | undefined; now: Date }[]): string`
  - `formatDailyReport(summary: DailySummary, range: PeriodRange, timeZone: string): string[]`
  - `formatWeeklyReport(report: WeeklyReport, range: PeriodRange, timeZone: string, tokenLabels: Map<string, TokenLabel>): string[]`
  - `splitMessage(text: string, limit?: number /* 4096 */): string[]` (memotong di batas baris).

- [ ] **Step 1: Tests:** semua pesan escape simbol token berbahaya; laporan berisi "PAPER" dan "Hasil simulasi, bukan saran investasi"; komponen penguraian `null` tampil "tidak tersedia"; `walletStillHolding` tampil "wallet masih memegang"; laporan mingguan dengan 60 wallet → setiap bagian ≤ 4096; `splitMessage` tidak memotong di tengah baris; lamports negatif tampil `-0,0106 SOL`; startup message baru (`paused: true`).
- [ ] **Step 2:** FAIL → implementasi → PASS. **Step 3:** Commit `feat(bot): add trading and report message formats`.

### Task 13: Perintah Telegram trading + notifier send/edit

**Files:**

- Create: `apps/bot/src/telegram/trading-commands.ts`, `apps/bot/src/telegram/trading-commands.test.ts`
- Modify: `apps/bot/src/telegram/notifier.ts` (+test baru `notifier.test.ts`),
  `apps/bot/src/telegram/bot.ts`, `apps/bot/src/telegram/bot.test.ts`

**Interfaces:**

- Produces:
  - Notifier: `interface SentMessage { chatId: number; messageId: number }`; `send(html): Promise<SentMessage[]>` (masuk antrean yang sama dengan `notify`); `edit(sent: SentMessage[], html): Promise<void>` (error dicatat, tidak dilempar); `notify(html, options?: { excludeChatId?: number }): void`.
  - `interface TradingCommandDeps { store: TradingStore; monitor: Pick<PositionMonitor,'valuation'>; resolveTokenLabel: ResolveTokenLabel; loadReport(kind: 'day' | 'week'): Promise<string[]>; notifyOthers(html: string, excludeChatId: number): void; timeZone: string; now: () => Date }`
  - `handlePause(deps, actor, chatId): Promise<string>`, `handleResume(...)`, `handleStatus(deps)`, `handlePositions(deps)`, `handleReport(deps, args): Promise<string[]>` (`''` → `'day'`, `'minggu'` → `'week'`, lainnya → teks bantuan).
  - `BOT_COMMANDS` + `/status`, `/positions`, `/pause`, `/resume`, `/report`; `createTelegramBot` menerima `trading: TradingCommandDeps`.

- [ ] **Step 1: Tests:** `/pause` memanggil `setTradingPaused(true, { actor })`, membalas "⏸ Trading paper dijeda", memberi tahu chat lain; `/pause` saat sudah pause → "sudah dijeda" tanpa notifikasi; `/report minggu` mengirim beberapa pesan; chat tak diizinkan tetap diabaikan untuk perintah baru (bot test); notifier `send` mengembalikan `messageId` per chat dan `edit` memanggil `editMessageText` dengan HTML options; `edit` yang gagal tidak melempar.
- [ ] **Step 2:** FAIL → implementasi → PASS. **Step 3:** Commit `feat(bot): add trading commands and editable alerts`.

### Task 14: Job laporan terjadwal

**Files:**

- Create: `apps/bot/src/jobs/reports.ts`, `apps/bot/src/jobs/reports.test.ts`

**Interfaces:**

- Consumes: `dueReports`, `zonedDayRange`, `zonedWeekRange` (Task 2); `buildDailySummary`,
  `buildWeeklyReport` (Task 4); query Task 7 via `ReportSource`; format Task 12.
- Produces:
  - `interface ReportSource { trades(from, to): Promise<ReportTrade[]>; buySignals(from, to); closedPositions(from, to); openForSummary(): Promise<{ remainingCostLamports: bigint; netValueLamports: bigint | null }[]> }`
  - `createReportJob(deps: { source: ReportSource; store: Pick<TradingStore,'getSettingString'|'setSettingString'>; send(messages: string[]): Promise<void>; resolveTokenLabel; timeZone: string; now: () => Date; logger; intervalMs?: number /* 60_000 */ }): { tick(): Promise<void>; start(): void; stop(): void; render(kind: 'day' | 'week'): Promise<string[]> }`

`tick`: baca cursor `last_daily_report`/`last_weekly_report`; `dueReports(reportHour: 7)`; bila
`initialize` → simpan cursor tanpa mengirim; kirim laporan yang jatuh tempo lalu simpan cursor
**setelah** terkirim. `render('day')` = hari ini sampai `now`, `render('week')` = 7×24 jam terakhir
(untuk `/report`). `start()` menjalankan `tick` segera (mengejar laporan terlewat) lalu tiap menit.

- [ ] **Step 1: Tests:** start pertama → cursor diinisialisasi, `send` tidak dipanggil; Senin 07.05 dengan cursor lama → harian & mingguan terkirim sekali, `tick` kedua tidak mengirim ulang; `send` gagal → cursor tidak maju (dicoba lagi tick berikutnya).
- [ ] **Step 2:** FAIL → implementasi → PASS. **Step 3:** Commit `feat(bot): schedule daily and weekly paper reports`.

### Task 15: Rangkai di `main.ts`, dokumentasi, verifikasi akhir

**Files:**

- Modify: `apps/bot/src/main.ts`, `README.md`, `CLAUDE.md`

- [ ] **Step 1:** Rangkai: `createRateLimiter` → `createJupiterClient` (key `config.jupiter.apiKey`) →
      `createPaperExecutor` → `createDbTradingStore` → `createEngine` → `createPositionMonitor` →
      `createReportJob`. Di `onNewSwap`: alert dikirim lewat `notifier.send` (urutan alert tetap
      serial seperti M1), `engine.handleSwap` berjalan paralel, lalu alert diedit dengan
      `formatAlert + '\n' + formatDecisionLine(outcome)`. [keputusan rencana] Id pesan alert
      disimpan di memori saja (bukan DB): edit terjadi dalam proses yang sama beberapa detik
      kemudian; bila bot restart di antaranya, baris keputusan hilang tetapi sinyal tetap tercatat.
      `TradingEvents` → format Task 12 + `notifier.notify`.
      Startup message memakai `paused`. Shutdown menghentikan monitor & job laporan sebelum menutup DB.
- [ ] **Step 2:** README: status M2, perintah baru, cara membaca laporan, catatan biaya paper.
      CLAUDE.md: catatan implementasi M2 (antarmuka `Executor` dua langkah, prioritas rate limit,
      rumus penguraian di `packages/core/src/pnl/README.md`, settings keys).
- [ ] **Step 3: Verifikasi:** `npm run typecheck`, `npm run lint`, `npm run format:check`,
      `TEST_DATABASE_URL=... npm run test` — semua hijau, laporkan jumlah test.
- [ ] **Step 4: Smoke** (`.env` pengguna, tanpa membaca isinya): jalankan bot ±60 detik, pastikan log
      `Solaryna bot started`, monitor & job laporan berjalan tanpa error, startup message terkirim.
      Tidak ada transaksi; hanya quote Jupiter bila ada sinyal.
- [ ] **Step 5:** Commit `feat(bot): wire paper trading into the bot (M2)`. Centang M2 di CLAUDE.md
      hanya setelah langkah 3 lulus dan pengguna mengonfirmasi uji end-to-end.
