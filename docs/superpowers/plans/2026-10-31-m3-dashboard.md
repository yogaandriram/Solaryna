# M3 Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A password-protected Next.js dashboard (`apps/web`) with these pages:

- **Ringkasan:** stat cards, a daily PnL chart, the kill switch.
- **Wallet:** add, deactivate and reactivate wallets, plus a detail page.
- **Sinyal**
- **Posisi & Trade**
- **Pengaturan:** kill switch, runtime risk limits within the `.env` ceiling, audit log.

The bot follows dashboard changes and announces them in Telegram.

**Architecture:**

- Server Components read MySQL through `@solaryna/db`. Mutations are Server Actions guarded by `requireSession()`.
- Pure logic lives in `packages/core` or in pure `apps/web/src/lib/*` modules, all unit-tested.
- Dashboard read queries live in `packages/db/src/dashboard.ts` and are tested against MySQL.
- On the bot side:
  - Runtime limits come from the `risk_limits` setting.
  - Open-position valuations are persisted.
  - An audit-log poller announces dashboard actions.

**Tech Stack:** Next.js 16.4 (App Router, `proxy.ts`), React 19.3, Tailwind CSS 4.3, TypeScript 6 strict, Drizzle/MySQL, vitest, zod 4.

**Spec:** `docs/superpowers/specs/2026-10-31-m3-dashboard-design.md`

## Global Constraints

- **Language:** UI copy is Indonesian. Code, identifiers and commits are English (Conventional Commits). The commit trailer is `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work directly on `main` and never push.
- **Money:** never use a JS `number` for SOL or token amounts. Use `bigint` for raw amounts and `Decimal` from `@solaryna/core` for prices and percentages. Convert to a number only for chart geometry.
- **Time:** stored in UTC, displayed in `TZ_DISPLAY` (WIB) with the zone label.
- **Purity:** `packages/core` has no I/O, which ESLint enforces.
- **Secrets:**
  - The web process reads only the `webEnvSchema` keys from `.env`.
  - It never reads, holds or shows `BOT_WALLET_PRIVATE_KEY` or the bot's API keys.
  - Never `console.log` secrets.
  - Claude never reads `.env`.
- **Safety:**
  - The dashboard cannot enable live mode or loosen a risk limit beyond `.env`.
  - The kill switch and wallet and limit changes are audited in the same DB transaction.
  - On-chain text is rendered only as React text, never with `dangerouslySetInnerHTML`.
  - Paper and live are never added together.
  - "Bukan saran investasi" appears on every page.
- **Done gate:** after every task, run `npm run typecheck`, `npm run lint` and `npm run test` (with `TEST_DATABASE_URL=mysql://root:@127.0.0.1:3306/solaryna_test` for the DB tests). Before claiming done, also run `npm run format:check` and `npm run build:web`.
- **External APIs:** for Next.js specifics, read the bundled docs in `node_modules/next/dist/docs/` (or nextjs.org), not memory.

## Review Focus

1. **Empty database:** every page renders an empty state with no NaN or "undefined", and a division by zero shows "—". Covered by the view-model tests in Tasks 11–14.
2. **Open position without a valuation, or valued with no route:** the estimated PnL is "—", the position is left out of the total, and the total says how many were left out. Task 11, `buildOverview` tests.
3. **Tampered, expired or missing session:** the request is redirected to `/login`, and a Server Action rejects it. Task 9, session-token tests; every action calls `requireSession()`.
4. **A runtime limit looser than `.env`**, whether from the form or a hand-edited DB row: the form rejects it and the bot clamps it. Task 2 (`effectiveRiskLimits`) and Task 14 (`parseLimitsForm`) tests.
5. **Garbage URL parameters** (`?mode=x`, `?page=-3`, `/positions/abc`): defaults are used, or the page returns 404. Task 10, params tests.

---

### Task 1: Shared labels and pending-fee math in core

**Files:**

- Create: `packages/core/src/labels.ts`, `packages/core/src/labels.test.ts`
- Modify:
  - `packages/core/src/pnl/position.ts` (+ test)
  - `packages/core/src/index.ts`
  - `apps/bot/src/telegram/trading-format.ts`
  - `apps/bot/src/engine/sell.ts`
  - `apps/bot/src/main.ts`

**Interfaces — Produces:**

- `describeRiskReason(reason: RiskReason, timeZone: string): string`: plain text, not escaped, with the same wording as the current Telegram version.
- `tradeReasonLabel(reason: string): string`: labels for `TradeReason` values plus `'manual'`, falling back to the raw value.
- `pendingBuyFeesLamports(p: { tokenAmountRaw: bigint; initialTokenAmountRaw: bigint; feesLamports: bigint }): bigint`, moved from `apps/bot/src/engine/sell.ts`.
- `estimatedPnlLamports(state: PositionState, netValueLamports: bigint): bigint` = `netValue − remainingCostLamports(state) − pendingBuyFeesLamports(state)`.
- In the bot, `describeRiskReason` from `trading-format.ts` stays exported as `escapeHtml(core.describeRiskReason(…))`.

- [ ] Step 1: Move the `describeRiskReason` cases from `apps/bot/src/telegram/trading-format.test.ts` into `labels.test.ts`. Assert plain text: `liquidity_below_min` with `{min:'20000', actual:'12300'}` gives `'likuiditas $12.300 < $20.000'`, and a reason with `<` is not escaped. Add `tradeReasonLabel('follow_sell') === 'ikut jual'` and `tradeReasonLabel('manual') === 'manual'`. In `position.test.ts`, add:
  - pending fees equal `feesLamports` before any sale and 0 after one;
  - `estimatedPnlLamports` for cost 50_000_000, fees 205_000, unsold, net 60_000_000 gives 9_795_000.
- [ ] Step 2: `npx vitest run packages/core/src/labels.test.ts packages/core/src/pnl/position.test.ts`. Expected: FAIL, the functions are not exported.
- [ ] Step 3: Implement. Move the private `sol`/`number`/`usd` helpers that the reason text needs. Make the bot wrap the core functions; `sell.ts` re-exports `pendingBuyFeesLamports` from core, or its callers import from core.
- [ ] Step 4: Run the full suite. Expected: PASS, with the bot's `trading-format` tests unchanged and green.
- [ ] Step 5: Commit `refactor(core): share risk reason and trade labels with the dashboard`.

### Task 2: Runtime risk limits in core

**Files:**

- Create: `packages/core/src/risk/runtime-limits.ts`, `packages/core/src/risk/runtime-limits.test.ts`
- Modify: `packages/core/src/risk/index.ts`

**Interfaces — Produces:**

```ts
export const RUNTIME_LIMIT_KEYS = [
  'maxSolPerTradeLamports',
  'maxOpenPositions',
  'dailyLossLimitLamports',
  'minLiquidityUsd',
  'maxSlippageBps',
  'takeProfitPct',
  'stopLossPct',
  'maxHoldMinutes',
  'maxSignalAgeSeconds',
] as const;
export type RuntimeLimitKey = (typeof RUNTIME_LIMIT_KEYS)[number];
export interface RuntimeLimits {
  maxSolPerTradeLamports: bigint;
  maxOpenPositions: number;
  dailyLossLimitLamports: bigint;
  minLiquidityUsd: Decimal;
  maxSlippageBps: number;
  takeProfitPct: Decimal;
  stopLossPct: Decimal;
  maxHoldMinutes: number;
  maxSignalAgeSeconds: number;
}
export type RiskLimitOverrides = Partial<RuntimeLimits>;
/** Serialized form stored in settings.risk_limits: lamports/integers/decimals as strings. */
export type SerializedRiskLimitOverrides = Partial<Record<RuntimeLimitKey, string>>;
export function effectiveRiskLimits<T extends RuntimeLimits>(
  base: T,
  overrides: RiskLimitOverrides,
): T;
export function isWithinCeiling<K extends RuntimeLimitKey>(
  key: K,
  value: RuntimeLimits[K],
  ceiling: RuntimeLimits[K],
): boolean;
export function parseRiskLimitOverrides(value: unknown): RiskLimitOverrides; // lenient
export function serializeRiskLimitOverrides(o: RiskLimitOverrides): SerializedRiskLimitOverrides;
export const RUNTIME_LIMIT_LABELS: Record<RuntimeLimitKey, string>; // Indonesian field labels
export function formatRuntimeLimit(key: RuntimeLimitKey, serialized: string): string; // "0,05 SOL", "$20.000", "300 bps", "100%", "240 menit", "30 dtk", "5"
```

**Rules:**

- `minLiquidityUsd` is stricter when higher; every other key is stricter when lower.
- `effectiveRiskLimits` takes the stricter of base and override per key, and keeps base fields that are not runtime limits (e.g. `copyDelayMs`).
- `parseRiskLimitOverrides`:
  - drops unknown keys, non-string values, and values that do not parse;
  - drops values below the env minimums: lamports > 0, positions ≥ 1, slippage 1–10000, TP > 0, 0 < SL ≤ 100, hold ≥ 1, signal age ≥ 1, liquidity ≥ 0.
  - It accepts `null` or a non-object as `{}`.

- [ ] Step 1: Write the tests:
  - an override looser than base is ignored (`maxSolPerTradeLamports` override 1 SOL with base 0.05 → 0.05);
  - a stricter one wins (0.03);
  - `minLiquidityUsd` override 10000 with base 20000 → 20000, and 30000 → 30000;
  - `copyDelayMs` is preserved;
  - parse drops `{maxOpenPositions:'0', stopLossPct:'101', foo:'1', maxHoldMinutes: 5}`, which leaves `{}`;
  - serialize then parse round-trips;
  - `formatRuntimeLimit('maxSolPerTradeLamports','50000000') === '0,05 SOL'`.
- [ ] Step 2: Run. Expected: FAIL (module missing).
- [ ] Step 3: Implement.
- [ ] Step 4: Run the full suite. Expected: PASS.
- [ ] Step 5: Commit `feat(core): runtime risk limit overrides bounded by env`.

### Task 3: DB support for valuations, limit overrides and audit polling

**Files:**

- Modify:
  - `packages/db/src/schema.ts` (positions + `lastValueLamports: rawAmount('last_value_lamports')`, `lastValuedAt: utcDatetime('last_valued_at')`)
  - `packages/db/src/trading.ts`, `packages/db/src/queries.ts` and their tests
- Create: `packages/db/migrations/0002_m3_dashboard.sql`, generated by `npx drizzle-kit generate --name m3_dashboard` from `packages/db`

**Interfaces — Produces:**

```ts
// trading.ts
export const RISK_LIMITS_SETTING = 'risk_limits';
export function savePositionValuation(
  db,
  input: { positionId: number; tokenAmountRaw: bigint; netValueLamports: bigint | null; at: Date },
): Promise<boolean>; // only WHERE status='open' AND token_amount_raw = input
export function getRiskLimitOverrides(db): Promise<unknown>; // raw JSON value or null
export type LimitChanges = Record<string, { from: string | null; to: string | null }>;
export function setRiskLimitOverrides(
  db,
  next: Record<string, string>,
  audit: AuditActor,
): Promise<{ changes: LimitChanges }>; // tx: lock row, diff, upsert, audit 'limits.update' {changes}; no write/audit when no changes
// queries.ts
export type AuditLogRow = typeof auditLog.$inferSelect;
export function maxAuditLogId(db): Promise<number>; // 0 when empty
export function listAuditLogAfter(
  db,
  afterId: number,
  actor: string,
  limit?: number,
): Promise<AuditLogRow[]>; // id asc, default 50
export function listRecentAuditLog(db, limit: number): Promise<AuditLogRow[]>; // id desc
```

- [ ] Step 1: Write the MySQL tests:
  - a valuation is saved on an open position and is a no-op (returns false) when the amount changed or the position is closed;
  - `setRiskLimitOverrides` writes the setting and one audit row with `changes {maxOpenPositions:{from:null,to:'3'}}`;
  - calling it a second time with the same values writes no audit row;
  - `listAuditLogAfter` filters by actor and id;
  - `maxAuditLogId` returns 0 when the log is empty.
- [ ] Step 2: Run with `TEST_DATABASE_URL`. Expected: FAIL.
- [ ] Step 3: Change the schema, generate migration 0002 and implement the functions.
- [ ] Step 4: Run the full suite with `TEST_DATABASE_URL`. Expected: PASS. Then `npm run db:migrate` (user DB; applies 0002).
- [ ] Step 5: Commit `feat(db): persist position valuations and runtime risk limits`.

### Task 4: Bot uses runtime limits and persists valuations

**Files:**

- Create: `apps/bot/src/engine/limits-source.ts` (+ test)
- Modify:
  - `apps/bot/src/engine/engine.ts`, `apps/bot/src/exits/monitor.ts`, `apps/bot/src/engine/store.ts`, `apps/bot/src/engine/fake-store.ts`, `apps/bot/src/main.ts`
  - the tests of the engine, the monitor and main

**Interfaces:**

- Consumes: `effectiveRiskLimits`, `parseRiskLimitOverrides` (Task 2); `getRiskLimitOverrides`, `savePositionValuation` (Task 3).
- Produces:
  - `createRiskLimitsSource({ base: RiskLimits; load: () => Promise<unknown>; logger; intervalMs?: number /*15_000*/ }): { current(): RiskLimits; refresh(): Promise<void>; start(): void; stop(): void }`.
    - It logs `info` with the changed keys when the effective limits change, and `warn` on a load error, keeping the previous limits.
  - Engine and monitor deps: `limits: () => RiskLimits` replaces `limits: RiskLimits`. The engine reads it once at the start of each `handleSwap`; the monitor once per `runOnce`.
  - `TradingStore` gains `getRiskLimitOverrides(): Promise<unknown>` and `savePositionValuation(input): Promise<boolean>`.
  - The monitor saves every valuation it computes. A failed save logs `warn` and never blocks exits.

- [ ] Step 1: Write the tests:
  - the limits source applies a stricter override after `refresh()`, ignores a looser one, and keeps the old limits on a load error;
  - the engine uses limits changed between two signals (second signal rejected with `max_open_positions` after the override sets 1 while 1 is open);
  - the monitor calls `savePositionValuation` with the quoted amount and net value (`null` for no route);
  - a monitor whose `savePositionValuation` rejects still executes take-profit.
- [ ] Step 2: Run. Expected: FAIL.
- [ ] Step 3: Implement. In `main.ts`: create the source with `base: config.risk`, `await source.refresh()` before the engine starts, `start()` it with the monitor, and `stop()` it on shutdown.
- [ ] Step 4: Run the full suite. Expected: PASS.
- [ ] Step 5: Commit `feat(bot): apply runtime risk limits and save open position valuations`.

### Task 5: Bot announces dashboard actions in Telegram

**Files:**

- Create: `apps/bot/src/jobs/dashboard-audit.ts` (+ test), `apps/bot/src/telegram/dashboard-format.ts` (+ test)
- Modify: `apps/bot/src/main.ts`

**Interfaces:**

- Consumes: `maxAuditLogId`, `listAuditLogAfter` (Task 3); `RUNTIME_LIMIT_LABELS`, `formatRuntimeLimit` (Task 2).
- Produces:
  - `DASHBOARD_ACTOR = 'dashboard'`, exported from `packages/db/src/queries.ts` so the web uses the same value.
  - `formatDashboardAction(entry: AuditLogRow): string | null` (HTML, everything escaped):
    - `trading.pause` → `⏸ Trading dijeda dari dashboard. Sinyal baru dan exit otomatis menunggu dilanjutkan.`
    - `trading.resume` → `▶️ Trading dilanjutkan dari dashboard.`
    - `limits.update` → `⚙️ Batas risiko diubah dari dashboard:`, then one line per change: `• <label>: <from or "ikut .env"> → <to or "ikut .env">`
    - `wallet.add` → `👛 Wallet ditambahkan dari dashboard: <label> <code>addr</code>`
    - `wallet.remove` → `👛 Wallet dihentikan dari dashboard: …`
    - any other action → `null`
  - `createDashboardAuditJob({ source: { maxId(): Promise<number>; listAfter(afterId: number): Promise<AuditLogRow[]> }, notify(html: string): void, onLimitsChanged(): void, logger, intervalMs?: number /*15_000*/ }): { tick(): Promise<void>; start(): void; stop(): Promise<void> }`.
    - The first tick only sets the cursor to `maxId()`.
    - Later ticks notify each new entry in id order, advance the cursor, and call `onLimitsChanged` after a `limits.update`.
    - An error is logged and the cursor is kept.

- [ ] Step 1: Write the tests:
  - for each action's text, a hostile label is escaped;
  - the first tick sends nothing;
  - new entries are sent once each, in order;
  - `onLimitsChanged` is called;
  - a throwing `listAfter` keeps the cursor and the next tick retries.
- [ ] Step 2: Run. Expected: FAIL.
- [ ] Step 3: Implement and wire it in `main.ts`:
  - source: `maxAuditLogId(db)` and `listAuditLogAfter(db, id, DASHBOARD_ACTOR)`
  - `notify: notifier.notify`
  - `onLimitsChanged: () => void limits.refresh()`
  - start it after `source.start()` and stop it in shutdown before `notices`.
- [ ] Step 4: Run the full suite. Expected: PASS.
- [ ] Step 5: Commit `feat(bot): announce dashboard actions in Telegram`.

### Task 6: Dashboard read queries

**Files:**

- Create: `packages/db/src/dashboard.ts`, `packages/db/src/dashboard.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces — Produces** (all filtered by `mode`; offset paging is `{ limit: number; offset: number }`):

```ts
export interface DashboardPosition {
  position: PositionRow;
  tokenSymbol: string | null;
  walletId: number | null;
  walletAddress: string | null;
  walletLabel: string | null;
}
export function listOpenDashboardPositions(db, mode): Promise<DashboardPosition[]>; // openedAt asc
export function listClosedDashboardPositions(
  db,
  mode,
  page,
  walletId?: number,
): Promise<DashboardPosition[]>; // closedAt desc, id desc
export function listWalletOpenPositions(db, mode, walletId: number): Promise<DashboardPosition[]>;
export function getDashboardPosition(
  db,
  id: number,
): Promise<(DashboardPosition & { trades: TradeRow[] }) | null>; // trades executedAt asc
export interface DashboardSignal {
  id: number;
  createdAt: Date;
  decision: 'accepted' | 'rejected';
  reasons: RiskReason[];
  side: SwapSide;
  signature: string;
  blockTime: Date;
  tokenMint: string;
  tokenSymbol: string | null;
  tokenAmountRaw: bigint;
  tokenDecimals: number;
  quoteMint: string;
  quoteAmountRaw: bigint;
  quoteDecimals: number;
  walletId: number;
  walletAddress: string;
  walletLabel: string | null;
}
export interface SignalFilter {
  decision?: 'accepted' | 'rejected';
  side?: SwapSide;
  walletId?: number;
}
export function listDashboardSignals(
  db,
  mode,
  filter: SignalFilter,
  page,
): Promise<DashboardSignal[]>; // id desc
export interface DashboardTrade {
  trade: TradeRow;
  tokenSymbol: string | null;
}
export function listDashboardTrades(db, mode, page): Promise<DashboardTrade[]>; // executedAt desc, id desc
export function listRealizedPnlPoints(
  db,
  mode,
  from: Date,
  to: Date,
): Promise<{ at: Date; pnlLamports: bigint }[]>;
export interface OverviewTotals {
  realizedTodayLamports: bigint;
  realizedWeekLamports: bigint;
  realizedAllLamports: bigint;
  feesWeekLamports: bigint /* network+priority */;
  closedCount: number;
  winCount: number;
  signalsToday: { accepted: number; rejected: number };
}
export function getOverviewTotals(
  db,
  mode,
  today: { from: Date; to: Date },
  week: { from: Date; to: Date },
): Promise<OverviewTotals>;
export interface WalletStats {
  buySignals: number;
  followed: number;
  closedPositions: number;
  wins: number;
  realizedPnlLamports: bigint;
  openPositions: number;
}
export interface DashboardWallet {
  wallet: TrackedWallet;
  stats: WalletStats;
  latestScore: string | null;
}
export function listDashboardWallets(db, mode, signalsSince: Date): Promise<DashboardWallet[]>; // active first, then id asc
export function getDashboardWallet(
  db,
  id: number,
  mode,
  signalsSince: Date,
): Promise<{ wallet: DashboardWallet; swaps: SwapEventRow[] /* 50, blockTime desc */ } | null>;
export function getTrackedWallet(db, id: number): Promise<TrackedWallet | undefined>;
```

`week` means the last 7 days rolling, which the caller computes; `today` is the WIB day. "Win" means a closed position with `realized_pnl_lamports > 0`. Signals for `buySignals`/`followed` count only `side='buy'`.

- [ ] Step 1: Write MySQL tests on a seeded fixture with two wallets, one open and two closed paper positions (one win, one loss), one live trade, and accepted and rejected signals. Assert:
  - the mode filter, so live rows never appear in paper results;
  - the totals;
  - each signal filter;
  - paging offsets;
  - the wallet stats;
  - the latest score (null without a `wallet_scores` row; the newest `score_date` with two rows);
  - `getDashboardPosition` for an unknown id returns null;
  - token symbol null when there is no `tokens` row.
- [ ] Step 2: Run with `TEST_DATABASE_URL`. Expected: FAIL.
- [ ] Step 3: Implement. Use `GROUP BY` subqueries or separate grouped queries merged in JS.
- [ ] Step 4: Run the full suite. Expected: PASS.
- [ ] Step 5: Commit `feat(db): dashboard read queries`.

### Task 7: Web config and selective .env loading

**Files:**

- Modify:
  - `packages/config/src/env.ts`, `load.ts`, `env-file.ts` and their tests
  - `.env.example`

**Interfaces — Produces:**

- `riskEnvShape`: the 11 risk keys, shared by `botEnvSchema` and `webEnvSchema`.
- `webEnvSchema` = common + `DASHBOARD_PASSWORD` + `DASHBOARD_HOST` (same hostname regex as `WEBHOOK_HOST`, default `127.0.0.1`) + `DASHBOARD_PORT` (`integer(1, 65535)`, default `3000`) + `riskEnvShape`.
- `WEB_ENV_KEYS: readonly string[]`, the keys of `webEnvSchema`.
- `WebConfig` gains `host: string; port: number; risk: RiskLimits`. The risk mapping is shared through a `riskLimits(e)` helper.
- `readRootEnvKeys(keys: readonly string[], startDir?: string): Record<string, string>`: parses `<root>/.env` with `parseEnv` from `node:util` and returns only the listed keys; `{}` when there is no file.
- `loadWebEnv(startDir?: string): EnvSource`, the file values overridden by `process.env` for the same keys.

- [ ] Step 1: Write the tests:
  - with a temp workspace whose `.env` has `DASHBOARD_PASSWORD`, `BOT_WALLET_PRIVATE_KEY` and `HELIUS_API_KEY`, `readRootEnvKeys(WEB_ENV_KEYS)` contains only `DASHBOARD_PASSWORD`;
  - `loadWebConfig` defaults: host 127.0.0.1, port 3000, risk equal to the env defaults;
  - an invalid `DASHBOARD_PORT` reports `DASHBOARD_PORT: harus di antara 1 dan 65535`;
  - `process.env` overrides the file.
- [ ] Step 2: Run. Expected: FAIL.
- [ ] Step 3: Implement. Add `DASHBOARD_HOST=127.0.0.1` and `DASHBOARD_PORT=3000` to `.env.example` next to `DASHBOARD_PASSWORD`, with a comment about `0.0.0.0` for phone access.
- [ ] Step 4: Run the full suite. Expected: PASS.
- [ ] Step 5: Commit `feat(config): web config with dashboard host, port and risk ceilings`.

### Task 8: Next.js app scaffold

**Files:**

- Create in `apps/web`: `package.json`, `next.config.ts`, `postcss.config.mjs`, `tsconfig.json`, `scripts/run.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx` (placeholder)
- Modify: root `package.json` (scripts `dev:web`, `build:web`, `start:web`), `eslint.config.js` if needed for `.tsx` and `.next`, `.prettierignore` (`.next`, `next-env.d.ts`)

**Interfaces — Produces:**

- `@solaryna/web` scripts: `dev` = `tsx scripts/run.ts dev`, `start` = `tsx scripts/run.ts start`, `build` = `next build`, `typecheck` (generate route types when the Next docs require it, then `tsc --noEmit`).
- `run.ts`:
  1. `loadWebConfig(loadWebEnv())`;
  2. on a `ConfigError`, print its message and exit 1;
  3. otherwise spawn `process.execPath` with `next/dist/bin/next` and `[mode, '--hostname', host, '--port', String(port)]`, inheriting stdio and forwarding the exit code.
- `next.config.ts`:
  - `transpilePackages: ['@solaryna/core','@solaryna/db','@solaryna/config']`
  - `poweredByHeader: false`
  - security `headers()` per the spec
  - a `turbopack.root` / workspace root setting if the bundled docs require one for npm workspaces.

- [ ] Step 1: Install `next@16.4.3`, `react@19.3.1` and `react-dom@19.3.1` (plus dev: `tailwindcss@4.3.3`, `@tailwindcss/postcss@4.3.3`, `@types/react`, `@types/react-dom`, `server-only`) in the web workspace. Read the bundled docs on monorepos and `transpilePackages`, TypeScript setup and route types, and Tailwind.
- [ ] Step 2: Create the files. The placeholder page imports something from `@solaryna/core` and `@solaryna/db`, to prove that transpiling works.
- [ ] Step 3: `npm run build:web`. Expected: build succeeds. Then `npm run typecheck`, `npm run lint`, `npm run test`. Expected: PASS.
- [ ] Step 4: Commit `chore(web): scaffold Next.js dashboard app`.

### Task 9: Login and session

**Files:**

- Create in `apps/web/src`:
  - `server/auth/session-token.ts` (+ test), `server/auth/password.ts` (+ test), `server/auth/login-limiter.ts` (+ test)
  - `server/auth/session.ts`, `server/config.ts`, `server/db.ts`, `proxy.ts`
  - `app/login/page.tsx`, `app/login/login-form.tsx`, `app/login/actions.ts`

**Interfaces — Produces:**

- `SESSION_COOKIE = 'solaryna_session'`, `SESSION_TTL_MS = 7 * 24 * 3600_000`.
- Session tokens:
  - `deriveSessionKey(password: string): Buffer`: scrypt with N=2^15, r=8, p=1, 32 bytes, salt `'solaryna-dashboard-session-v1'`, and `maxmem` large enough.
  - `createSessionToken(key: Buffer, nowMs: number, ttlMs?: number): string` → `v1.<exp>.<b64url sig>`.
  - `verifySessionToken(token: string | undefined, key: Buffer, nowMs: number): boolean`.
- `createPasswordChecker(password: string): (input: string) => boolean`.
- `createLoginLimiter({ maxFailures?: number /*10*/, windowMs?: number /*900_000*/ }): { check(nowMs): { allowed: true } | { allowed: false; retryAfterMs: number }; recordFailure(nowMs): void; reset(): void }`.
- `server/config.ts`: `getWebConfig(): WebConfig`, memoized.
- `server/db.ts`: `getDb(): Database`, a `globalThis` singleton.
- `server/auth/session.ts` (`'server-only'`): `requireSession(): Promise<void>` (redirects to `/login`), `createSession(): Promise<void>`, `deleteSession(): Promise<void>`. The cookie is `httpOnly`, `sameSite: 'strict'`, `path: '/'`, with `secure` when `x-forwarded-proto` is https.
- Login action: `login(prev: LoginState, formData: FormData): Promise<LoginState>`.
  - A locked limiter → `Terlalu banyak percobaan gagal. Coba lagi dalam N menit.`
  - A wrong password → wait 500 ms, record the failure, return `Password salah.`
  - Success → reset the limiter, create the session, and redirect to `/`.
- `logout()` deletes the session and redirects to `/login`.
- `proxy.ts`: a request without the cookie and with a path other than `/login` is redirected to `/login`. Matcher: `'/((?!_next/static|_next/image|favicon.ico).*)'`.

- [ ] Step 1: Write the tests:
  - token round-trip;
  - an expired token is rejected;
  - a tampered expiry or signature is rejected;
  - a token signed with a different password's key is rejected;
  - garbage strings (`''`, `'v1.x.y'`, `undefined`) are rejected;
  - the password checker accepts an exact match and rejects a prefix and a case change;
  - the limiter allows 10 failures, blocks the 11th check, unblocks after the window, and `reset()` clears it.
- [ ] Step 2: Run. Expected: FAIL.
- [ ] Step 3: Implement. The login page is a centered card titled "Solaryna", with a password field, a "Masuk" button, an error line and the disclaimer.
- [ ] Step 4: Run the full suite and `npm run build:web`. Expected: PASS.
- [ ] Step 5: Commit `feat(web): password login with signed session cookie`.

### Task 10: Formatters and URL params

**Files:**

- Create: `apps/web/src/lib/format.ts` (+ test), `apps/web/src/lib/params.ts` (+ test)

**Interfaces — Produces:**

- `format.ts`:
  - `formatSol(l: bigint): string` → `'0,05 SOL'`
  - `formatSignedSol(l: bigint): string` → `'+0,01 SOL'` / `'−0,02 SOL'` (U+2212) / `'0 SOL'`
  - `pnlTone(l: bigint): 'pos' | 'neg' | 'zero'`
  - `pnlPct(pnl: bigint, cost: bigint): Decimal | null` (null when cost ≤ 0)
  - `formatPct(v: Decimal | null, signed?: boolean): string` → `'—'` for null, `'+12,3%'`
  - `formatUsd(v: string | Decimal | null): string`
  - `formatTokenAmount(raw: bigint, decimals: number): string`
  - `formatQuoteAmount(raw: bigint, decimals: number, mint: string): string` → `'0,5 SOL'` / `'12,5 USDC'` / short mint
  - `formatDateTime(d: Date, tz: string): string` → `'31 Okt 2026, 10.53 WIB'`
  - `formatDuration(ms: number): string` → `'45 dtk'`, `'12 m'`, `'3 j 5 m'`, `'2 h 4 j'`
  - `tokenLabel(symbol: string | null, mint: string): string`
  - `walletName(label: string | null, address: string): string`
- `params.ts`:
  - `parseMode(v: unknown): TradingMode` (default `'paper'`)
  - `parsePage(v: unknown): number` (integer 1..10_000, default 1)
  - `parseId(v: unknown): number | null` (positive safe integer)
  - `parseSignalFilter(sp: Record<string, string | string[] | undefined>): SignalFilter`
  - `PAGE_SIZE = 50`
  - `pageToOffset(page: number): { limit: number; offset: number }`
  - `withParams(path: string, params: Record<string, string | number | undefined>): string`

- [ ] Step 1: Write tests with the exact strings above, plus: `parseMode('x') === 'paper'`, `parsePage('-3') === 1`, `parsePage('2.5') === 1`, `parseId('abc') === null`, and `parseSignalFilter({ decision: 'accepted', side: 'zzz', wallet: '4' })` → `{ decision: 'accepted', walletId: 4 }`.
- [ ] Step 2: Run. Expected: FAIL.
- [ ] Step 3: Implement on top of core `formatAmount`, `shortAddress` and `Intl` with string numerics.
- [ ] Step 4: Run the full suite. Expected: PASS.
- [ ] Step 5: Commit `feat(web): display formatters and URL parameter parsing`.

### Task 11: App shell and Ringkasan

**Files:**

- Create in `apps/web/src`:
  - Routes: `app/(dashboard)/layout.tsx`, `app/(dashboard)/page.tsx`, `app/(dashboard)/actions.ts` (`setTradingPausedAction`, `logoutAction`)
  - Components: `components/header.tsx`, `nav.tsx`, `mode-switch.tsx`, `auto-refresh.tsx` (client), `stat-card.tsx`, `pnl.tsx`, `badges.tsx`, `empty-state.tsx`, `daily-pnl-chart.tsx`, `pause-toggle.tsx`
  - Error pages: `app/error.tsx` (client), `app/not-found.tsx`
  - View models: `lib/overview.ts` (+ test)
- Modify: `packages/core/src/pnl/report.ts` or a new `packages/core/src/pnl/daily.ts` (+ test) for `dailyPnlSeries`

**Interfaces — Produces:**

- `dailyPnlSeries(points: { at: Date; pnlLamports: bigint }[], now: Date, days: number, timeZone: string): { key: string; pnlLamports: bigint }[]`: oldest first, one entry per zoned day ending today, zero-filled.
- `buildOverview(input: { totals: OverviewTotals; open: DashboardPosition[]; limits: RiskLimits; now: Date }): OverviewView`, where:
  - `OverviewView = { openCount; maxOpen; capitalInUseLamports; unrealized: { totalLamports: bigint; valuedCount: number; unvaluedCount: number }; winRate: Decimal | null; … }`
  - `capitalInUse` = Σ `remainingCostLamports`.
  - `unrealized` sums `estimatedPnlLamports` only over positions with `lastValueLamports !== null`.
  - `winRate` is null when `closedCount` is 0.
- The page: `requireSession()`, then gather `getOverviewTotals`, the open positions, `effectiveRiskLimits(config.risk, parseRiskLimitOverrides(await getRiskLimitOverrides(db)))`, `isTradingPaused`, `listRealizedPnlPoints` (14 days) and the latest 10 signals. It renders:
  - the stat cards from the spec;
  - the chart;
  - the pause card with a toggle;
  - the open positions;
  - the latest signals.
- `setTradingPausedAction(formData)`: `requireSession()`, then `setTradingPaused(db, formData.get('paused') === 'true', { actor: DASHBOARD_ACTOR })`, then `revalidatePath('/', 'layout')`.

- [ ] Step 1: Load the `dataviz` skill (before writing the chart). Write the tests:
  - `dailyPnlSeries` buckets by WIB date: 2026-10-30T18:00Z counts on 31 Okt; empty days are 0; the length is 14.
  - `buildOverview` with no positions and no closed positions gives win rate null and unrealized 0/0/0.
  - One valued position and one unvalued: `valuedCount` 1, `unvaluedCount` 1, the total equals that position's estimate.
- [ ] Step 2: Run. Expected: FAIL.
- [ ] Step 3: Implement the core function, the view model, the components and the page.
  - Layout: the header (brand, mode switch, pause badge, last-refreshed time, logout), horizontally scrollable nav tabs (Ringkasan, Wallet, Sinyal, Posisi & Trade, Pengaturan), and the footer disclaimer.
  - In live mode the page shows the not-active note.
  - Empty states link to the Wallet page.
- [ ] Step 4: Run the full suite and `npm run build:web`. Expected: PASS.
- [ ] Step 5: Commit `feat(web): dashboard shell and summary page`.

### Task 12: Sinyal and Posisi & Trade pages

**Files:**

- Create in `apps/web/src`:
  - Routes: `app/(dashboard)/signals/page.tsx`, `app/(dashboard)/positions/page.tsx` (tabs `?tab=open|closed|trades`), `app/(dashboard)/positions/[id]/page.tsx`
  - Components: `components/pagination.tsx`, `components/signal-table.tsx`, `components/position-tables.tsx`, `components/trade-table.tsx`
  - View models: `lib/positions.ts` (+ test)

**Interfaces — Produces:**

- `positionRow(p: DashboardPosition, now: Date)`: `{ costLamports (remaining for open, total for closed), valueLamports: bigint | null, pnlLamports: bigint | null, pnlPct: Decimal | null, ageMs, durationMs | null, closeReasonLabel }`.
  - For an open position, PnL = `estimatedPnlLamports` when valued, else null.
  - For a closed one, PnL = `realizedPnlLamports`.
- Signals page:
  - Filter chips (decision, side) preserve the other params; a wallet filter comes from `?wallet=`.
  - The reason text uses `describeRiskReason`; accepted signals show "Diikuti".
- The position detail page returns `notFound()` for an unknown or garbage id, and also when the position's mode differs from `?mode`, linking to the right mode instead.
- Live trades show a Solscan tx link.

- [ ] Step 1: Write the tests: `positionRow` gives:
  - for an open position valued with no route → value null, PnL null;
  - for an open valued position → the estimate and %;
  - for a closed loss → negative PnL, the duration, and the label `'stop-loss'`.
- [ ] Step 2: Run. Expected: FAIL.
- [ ] Step 3: Implement the pages. Wrap tables in `overflow-x-auto` and hide secondary columns below `md`.
- [ ] Step 4: Run the full suite and `npm run build:web`. Expected: PASS.
- [ ] Step 5: Commit `feat(web): signals, positions and trades pages`.

### Task 13: Wallet pages and actions

**Files:**

- Create in `apps/web/src`:
  - Routes: `app/(dashboard)/wallets/page.tsx`, `app/(dashboard)/wallets/[id]/page.tsx`, `app/(dashboard)/wallets/actions.ts`
  - Components: `components/add-wallet-form.tsx` (client), `components/copy-button.tsx` (client)
  - `lib/wallet-form.ts` (+ test)

**Interfaces — Produces:**

- `parseAddWalletForm(formData: FormData): { ok: true; address: string; label: string | null } | { ok: false; error: string }`:
  - It trims the input.
  - It checks `isValidSolanaAddress`; when that fails the error is `'Alamat wallet Solana tidak valid.'`.
  - It runs the label through `normalizeWalletLabel`.
- `addWalletAction(prev, formData)`: `requireSession()` → `addManualWallet(db, …, { actor: DASHBOARD_ACTOR })`, returning one of:
  - `{ message: 'Wallet ditambahkan.' | 'Wallet diaktifkan kembali.' | 'Wallet sudah dipantau.' }`
  - `{ error }`
- `setWalletActiveAction(formData)`: `requireSession()`, `parseId(formData.get('id'))`, `getTrackedWallet`, then `deactivateWallet` (actor dashboard), or `addManualWallet` with the existing label to reactivate. Then `revalidatePath`.
- The list and detail pages carry the note: "Bot memuat perubahan wallet dalam ±1 menit."

- [ ] Step 1: Write the tests: an invalid address returns the error; a valid address with a label containing a bidi char is cleaned; an empty label becomes null.
- [ ] Step 2: Run. Expected: FAIL.
- [ ] Step 3: Implement the pages:
  - The list shows the stats per mode, the score column, a status badge, and active/inactive filter chips.
  - The detail page shows the header with copy and Solscan, the stats cards, the open positions, the latest 20 signals (with a link to `/signals?wallet=id`), the closed positions and the latest swaps.
- [ ] Step 4: Run the full suite and `npm run build:web`. Expected: PASS.
- [ ] Step 5: Commit `feat(web): wallet list, detail and management`.

### Task 14: Pengaturan

**Files:**

- Create in `apps/web/src`:
  - Routes: `app/(dashboard)/settings/page.tsx`, `app/(dashboard)/settings/actions.ts`
  - Components: `components/limits-form.tsx` (client)
  - `lib/limits-form.ts` (+ test), `lib/audit.ts` (+ test)

**Interfaces — Produces:**

- `LIMIT_FIELDS`: an ordered list of `{ key: RuntimeLimitKey; label; unit: 'SOL' | 'USD' | 'bps' | '%' | 'menit' | 'detik' | '' }`.
- `parseLimitsForm(formData: FormData, ceilings: RiskLimits): { ok: true; overrides: SerializedRiskLimitOverrides } | { ok: false; errors: Partial<Record<RuntimeLimitKey, string>> }`:
  - An empty input means "follow `.env`" and leaves the key out.
  - SOL values are parsed with `parseUnits(v, 9)` and at most 9 decimals.
  - Errors:
    - `'Harus angka.'`
    - `'Harus lebih dari 0.'`
    - `'Tidak boleh melebihi batas .env (X).'`
    - for `minLiquidityUsd`: `'Tidak boleh di bawah batas .env (X).'`
    - for SL: `'Harus di antara 0 dan 100.'`
  - A value equal to the ceiling is allowed but left out (stored as "follow `.env`").
- `saveLimitsAction(prev, formData)`: `requireSession()`, `parseLimitsForm`, `setRiskLimitOverrides(db, overrides, { actor: DASHBOARD_ACTOR })`, then return `{ message: 'Tersimpan. Bot memakai batas baru dalam ±15 detik.' }` or `'Tidak ada perubahan.'`.
- `resetLimitsAction()`: `requireSession()`, `setRiskLimitOverrides(db, {}, …)`.
- `describeAuditEntry(row: AuditLogRow): { actorLabel: string; text: string }`:
  - actors: `telegram:*` → `'Telegram'`, `dashboard` → `'Dashboard'`, `script:*` → `'Skrip'`, anything else as is.
  - texts: pause, resume, `limits.update` (the list of changes), wallet add or remove (label + short address); unknown actions show the action name.

- [ ] Step 1: Write the tests:
  - with a ceiling of 0.05 SOL, `'0.1'` gives the exceed error, `'0.03'` is accepted as `'30000000'`, and `'0.05'` is left out;
  - `minLiquidityUsd` `'10000'` with a ceiling of 20000 gives the error;
  - `stopLossPct` `'150'` gives the range error;
  - `'abc'` gives `'Harus angka.'`;
  - an all-empty form gives `{}`;
  - `describeAuditEntry` for each action and actor.
- [ ] Step 2: Run. Expected: FAIL.
- [ ] Step 3: Implement the page. It has these sections:
  - **Kill switch:** the status and a toggle that reuses `setTradingPausedAction`.
  - **Batas risiko:** a table of label, `.env` value, active value and input, with Save and Reset buttons and per-field errors.
  - **Hanya lewat .env:** the copy delay and priority fee cap, plus the live-mode note "Mode live hanya bisa diaktifkan lewat .env lalu restart bot. Dashboard tidak bisa mengaktifkannya."
  - **Riwayat perubahan:** the last 30 audit entries, in WIB.
- [ ] Step 4: Run the full suite and `npm run build:web`. Expected: PASS.
- [ ] Step 5: Commit `feat(web): settings page with kill switch and runtime risk limits`.

### Task 15: Docs, demo seed and smoke run

**Files:**

- Create: `apps/web/scripts/seed-demo.ts`. It refuses to run unless the DB name contains `test`, wipes the DB like `test-db.ts`, then inserts demo wallets, signals, positions and trades with obviously fake labels such as "demo alpha".
- Modify:
  - `README.md`: a Dashboard section covering how to start it, phone access, what the pages show, runtime limits, and the disclaimer; plus the command table and the structure.
  - `CLAUDE.md`: move `dev:web` from "Belum dibuat" into Perintah, add `build:web`/`start:web`, add `DASHBOARD_HOST`/`DASHBOARD_PORT` to Variabel lingkungan, and add a "Catatan implementasi M3" block.

- [ ] Step 1: Write the docs.
- [ ] Step 2: Seed `solaryna_test` and run `npm run build:web`. Start the web with `DATABASE_URL` pointed at `solaryna_test`, a throwaway `DASHBOARD_PASSWORD` set in the process env (never `.env`), and port 3100. Check with curl:
  - `GET /` → 307 to `/login`;
  - `GET /login` → 200;
  - the headers include `x-frame-options: DENY`.
    If browser tools are available: log in, then visit every page at 1280px and 390px wide and check the empty-state and data renders. Stop the server.
- [ ] Step 3: `npm run typecheck && npm run lint && npm run format:check && TEST_DATABASE_URL=… npm run test`. Expected: all PASS.
- [ ] Step 4: Commit `docs: dashboard usage and M3 notes`.
