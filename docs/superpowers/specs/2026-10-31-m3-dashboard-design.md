# M3 — Dashboard design

Status: approved for build without a question round. On 2026-10-31 the user said: "Langsung aja
kamu kerjakan. Nanti hasil terakhir setelah semua selesai, baru saya tes. Gak usah tanya-tanya
dulu". Everything marked **(call)** below is a decision Claude made on the user's behalf.

## Intent

The dashboard is where the user checks how paper trading is going, and where they control the
bot without Telegram. They open it at irregular times, mostly on a laptop but sometimes on a
phone. The first thing they want to see is **stat cards: PnL and related numbers**.

CLAUDE.md fixes the rest:

- Pages: login, Ringkasan, Wallet, Sinyal, Posisi & Trade, Pengaturan.
- Show paper and live data separately and never add them together.
- Show "bukan saran investasi".
- The dashboard cannot enable live mode and cannot see the private key.
- Kill switch and wallet changes are written to `audit_log`.

## Goals

1. **Ringkasan** opens with stat cards for the selected mode:
   - Realized PnL today (WIB), over 7 days, and over all time.
   - Estimated unrealized PnL of open positions.
   - Open positions against the limit, and the capital in use.
   - Win rate of closed positions.
   - Today's signals, split into followed and skipped.
   - Fees over 7 days.

   Below the cards:
   - A bar chart of daily realized PnL for the last 14 WIB days.
   - The pause status, with a toggle.
   - Open positions.
   - The latest signals.

2. **Wallet**:
   - A table of every tracked wallet with its paper stats in the selected mode: buy signals in the last 30 days, followed count, closed positions, wins, realized PnL, open positions.
   - The latest `wallet_scores.score`, or "—" until M4.
   - Add a manual wallet (address and optional label), deactivate it, or reactivate it.
   - A detail page per wallet with stats, its latest swaps, signals and positions.
3. **Sinyal**:
   - A list of signals with time, wallet, side, token, the wallet's quote amount, the decision and the reasons in Indonesian.
   - Filters: decision (all / followed / skipped), side (all / buy / sell) and wallet.
   - Paged 50 at a time with an id cursor.
4. **Posisi & Trade**, with three tabs:
   - **Terbuka**: cost, last value, estimated PnL and age.
   - **Ditutup**: cost, proceeds, fees, PnL and %, close reason, duration. Paged.
   - **Trade**: the latest trades, paged.

   Each position also has a detail page with every trade and its fee breakdown.

5. **Pengaturan**:
   - The kill switch.
   - Runtime risk limits, editable within the `.env` ceiling (see below), with a reset to `.env`.
   - Read-only values that can only change in `.env`.
   - A note that live mode is enabled only through `.env` and a restart.
   - The last 30 `audit_log` entries.
6. **The bot follows the dashboard:**
   - The kill switch takes effect before the next execution; it is already read from the DB.
   - Changed risk limits apply within 15 s.
   - Every dashboard action (pause, resume, limit change, wallet add or remove) is announced in Telegram.
7. **Layout:**
   - Laptop first and usable on a phone: one column on phones, more as the screen widens.
   - Tables scroll sideways and hide secondary columns on small screens.
   - Dark mode follows the system.

## Non-goals

- Live trading or any live control (M5).
- Scoring and discovery (M4). Score columns show "—".
- Multiple users, roles, or password change from the UI.
- Telegram `/setlimit`.
- Charts beyond the one daily PnL chart.
- A public status page.

## Anti-goals: these count as failure even if everything works

- A page that adds paper and live numbers together, or does not say which mode it shows.
- A PnL shown before fees, or estimated values presented as realized.
- Any path that lets the dashboard enable live mode, read or show `BOT_WALLET_PRIVATE_KEY` or other bot secrets, or loosen a risk limit beyond `.env`.
- On-chain text rendered as HTML.
- A server action that skips the session check.
- Copy that promises profit.

## Decisions

### Runtime and stack

- **Location and stack:** `apps/web`, using Next.js 16 (App Router; `proxy.ts` replaces middleware), React 19 and Tailwind CSS 4. The workspace packages are consumed through `transpilePackages`.
- **Rendering (call):** Server Components read the DB directly through `@solaryna/db`. There is no client data fetching and no API routes. Mutations are Server Actions. Client components are only:
  - forms that need `useActionState`
  - the auto-refresher
  - the copy-address button
- **Auto-refresh (call):** `router.refresh()` every 30 s while the tab is visible, with "Diperbarui HH.MM.SS WIB" in the header.
- **Launcher (call):** `npm run dev:web` / `build:web` / `start:web`. `apps/web/scripts/run.ts` validates the web config first (exiting with the `ConfigError` text if it is invalid, which is how the dashboard refuses to start), then spawns `next dev|start --hostname <DASHBOARD_HOST> --port <DASHBOARD_PORT>`.
- **New env keys:** `DASHBOARD_HOST` (default `127.0.0.1`) and `DASHBOARD_PORT` (default `3000`). To open it from a phone on the same Wi-Fi, set `DASHBOARD_HOST=0.0.0.0` and use `build:web` + `start:web`.

### Env and secrets (call)

- The web process does **not** call `process.loadEnvFile`. `readRootEnvKeys(keys)` (in `packages/config`) parses the root `.env` with `node:util` `parseEnv`, copies only the keys that `webEnvSchema` declares, and lets real environment variables take precedence.
- The bot's secrets therefore never enter the web process environment.
- `webEnvSchema` adds `DASHBOARD_HOST`, `DASHBOARD_PORT` and the risk limit keys. The web needs the `.env` limits as ceilings, and these keys are shared with `botEnvSchema` as `riskEnvShape`.

### Login and session (call)

- **Password check:** compare the HMAC-SHA256 of the input and of `DASHBOARD_PASSWORD` under a random per-process key, with `timingSafeEqual`.
- **Login limit:** after 10 failed logins in 15 minutes, login is blocked for the rest of that window. The counter is global, not per IP, because a single-user dashboard has no trustworthy client IP. A failure also waits 500 ms. Restarting the web process clears the lock.
- **Session token:** a stateless cookie `solaryna_session` with the value `v1.<expiresAtMs>.<base64url HMAC>`.
  - The key comes from `scrypt(DASHBOARD_PASSWORD, 'solaryna-dashboard-session-v1', N=2^15)`, computed once per process. Changing the password logs out every session, and a stolen cookie is expensive to brute-force offline.
  - The session lasts 7 days without sliding.
  - Cookie options: `httpOnly`, `sameSite: 'strict'`, `path: '/'`. `secure` is set when the request arrived over HTTPS (`x-forwarded-proto: https`), so plain-HTTP LAN access still works.
- **Where the session is checked:**
  - `proxy.ts` only redirects requests without a session cookie to `/login`.
  - Every page and every Server Action calls `requireSession()`, which verifies the token for real. Server Actions already check Origin against Host.
- **Response headers:**
  - `X-Frame-Options: DENY`
  - `Content-Security-Policy: frame-ancestors 'none'`
  - `Referrer-Policy: no-referrer`
  - `X-Content-Type-Options: nosniff`
  - `X-Robots-Tag: noindex`
  - and `poweredByHeader: false`.

### Mode selection (call)

- Every data page takes `?mode=paper|live` and defaults to paper. A switch in the header carries the mode across pages.
- Live shows the same layout with its own (empty) data and a note that live mode is not active yet and can only be enabled through `.env` and a restart.
- Mode badges: PAPER in amber, LIVE in red.

### Unrealized PnL (call)

- The bot's position monitor already quotes every open position every 30 s. It now also saves the result to two new columns on `positions`:
  - `last_value_lamports`: net SOL from selling the remainder, after sell fees. Null means there was no route.
  - `last_valued_at`
- The save is skipped if the position changed meanwhile: it uses `WHERE status='open' AND token_amount_raw = <quoted amount>`.
- Estimated PnL = last value − remaining cost − pending buy fees. That is the same formula as Telegram `/positions`, and it moves to `packages/core`.
- Positions without a valuation, or without a route, are left out of the total, which says how many were left out.

### Runtime risk limits (call)

- **Storage:** the `settings` row `risk_limits` holds a JSON object of overrides. Values are strings: lamports, integers, or decimals.
- **The `.env` value is the ceiling; the dashboard can only make a limit stricter:**

  | Key                      | Stricter is         |
  | ------------------------ | ------------------- |
  | `maxSolPerTradeLamports` | lower               |
  | `maxOpenPositions`       | lower               |
  | `dailyLossLimitLamports` | lower               |
  | `minLiquidityUsd`        | higher              |
  | `maxSlippageBps`         | lower               |
  | `takeProfitPct`          | lower (exit sooner) |
  | `stopLossPct`            | lower               |
  | `maxHoldMinutes`         | lower               |
  | `maxSignalAgeSeconds`    | lower               |

  To loosen a limit beyond `.env`, edit `.env` and restart the bot.

- **Not editable at runtime:** `copyDelayMs` (a simulation parameter) and `maxPriorityFeeLamports` (a fee setting, not a risk limit).
- **Effective limits:** `effectiveRiskLimits(envLimits, overrides)` in core takes the stricter of the two for each key. The bot clamps too, so a hand-edited DB row cannot loosen anything.
- **Form validation:** it uses the same minimums as the env schema plus the ceiling, with Indonesian errors per field.
- **Bot side:**
  - It reloads overrides at start, every 15 s, and right after the audit notifier sees a `limits.update` entry.
  - The engine reads the limits once per signal, and the monitor reads them once per tick.
- **Audit:** each save writes `limits.update` to `audit_log` with `{changes: {key: {from, to}}}`, where `null` means "follow `.env`".

### Telegram announcements of dashboard actions (call)

- A bot job polls `audit_log` every 15 s for entries with id greater than its cursor and actor `dashboard`. The cursor starts at the max id when the bot starts, so nothing is replayed.
- For each entry it sends one message to every allowed chat:
  - pause or resume
  - limits changed (the list of changes)
  - wallet added or removed

### Shared formatting

- `describeRiskReason` (plain text), the trade and close reason labels, and `pendingBuyFeesLamports` move to `packages/core`. Telegram wraps the plain text in `escapeHtml`, and the dashboard renders it as React text.

### Queries

- The dashboard's read queries live in `packages/db/src/dashboard.ts`, because CLAUDE.md puts shared queries in `packages/db` and its MySQL test helper lives there. They are tested against `TEST_DATABASE_URL`.
- Daily buckets are computed in JS with `zonedDateKey`, not with MySQL `CONVERT_TZ`. Laragon's MySQL may not have time zone tables loaded.

### Look

- A neutral slate palette. PnL is green with "+" and red with "−", so meaning never depends on color alone.
- Numbers use `id-ID` formatting. Times are in WIB with the zone label.
- Every page has the footer "Data paper adalah hasil simulasi. Bukan saran investasi."
- The header holds the brand, the mode switch, the pause indicator and logout. Under it, navigation tabs scroll sideways on phones.
- Links to Solscan for wallets, tokens and transactions, opened with `rel="noopener noreferrer"`.

## Failure modes to handle

- **Empty database:** every page shows an empty state. There are no NaN or "undefined" values, and division by zero shows "—".
- **Token text:** a missing symbol shows the short mint. Hostile text is never rendered as HTML.
- **MySQL unreachable:** the error boundary shows "Gagal memuat data. Pastikan MySQL (Laragon) menyala, lalu muat ulang." It never shows a stack trace.
- **Bad URL parameters:** a non-numeric or unknown `before` or `id` is ignored, or returns 404.
- **Session problems:** a tampered or expired cookie leads to `/login`. A Server Action without a session is rejected.

## Left to the builder

- Component structure, Tailwind classes, exact copy beyond what is fixed above.
- Chart details (per the dataviz skill).
