import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WSOL_MINT, type RiskReason } from '@solaryna/core';
import {
  auditLog,
  createDb,
  positions,
  settings,
  signals,
  swapEvents,
  tokens,
  trackedWallets,
  trades,
} from '@solaryna/db';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/mysql2/migrator';

// Fills a *test* database with obviously fake demo data so the dashboard can be looked at
// without a running bot:
//   DATABASE_URL=mysql://root:@127.0.0.1:3306/solaryna_test npm run seed:demo -w @solaryna/web
// It wipes every table first, so it refuses any database whose name does not contain "test".
// DATABASE_URL is read from the process environment only, never from .env.

const url = process.env.DATABASE_URL ?? '';
if (!/\/[A-Za-z0-9_]*test[A-Za-z0-9_]*$/.test(url === '' ? '' : new URL(url).pathname)) {
  console.error('Tolak: set DATABASE_URL ke database yang namanya mengandung "test".');
  process.exit(1);
}

const TABLES = [
  'trades',
  'positions',
  'signals',
  'swap_events',
  'wallet_scores',
  'tokens',
  'settings',
  'audit_log',
  'tracked_wallets',
];

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58(bytes: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(bytes).toString('hex')}`);
  let out = '';
  while (n > 0n) {
    out = `${ALPHABET[Number(n % 58n)] ?? ''}${out}`;
    n /= 58n;
  }
  return out;
}

const fakeAddress = (seed: string) => base58(createHash('sha256').update(seed).digest());
const fakeSignature = (seed: string) => base58(createHash('sha512').update(seed).digest());

const SOL = 1_000_000_000n;
const NETWORK_FEE = 5_000n;
const PRIORITY_FEE = 100_000n;
const now = Date.now();
const ago = (hours: number) => new Date(now - hours * 3_600_000);

const database = createDb(url);
const { db } = database;
try {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)),
  });
  for (const table of TABLES) {
    await db.execute(sql.raw(`DELETE FROM \`${table}\``));
  }

  const walletSeeds = [
    { label: 'demo alpha', active: true },
    { label: 'demo beta', active: true },
    { label: 'demo gamma', active: true },
    { label: 'demo nonaktif', active: false },
  ];
  const walletIds: number[] = [];
  const walletAddresses: string[] = [];
  for (const seed of walletSeeds) {
    const address = fakeAddress(seed.label);
    const [row] = await db
      .insert(trackedWallets)
      .values({ address, label: seed.label, source: 'manual', isActive: seed.active })
      .$returningId();
    walletIds.push(row?.id ?? 0);
    walletAddresses.push(address);
  }

  const tokenSymbols = ['DEMOA', 'DEMOB', 'DEMOC', 'DEMOD', 'DEMOE', 'DEMOF', null];
  const mints = tokenSymbols.map((_, i) => fakeAddress(`demo token ${i}`));
  await db.insert(tokens).values(
    tokenSymbols.map((symbol, i) => ({
      mint: mints[i] ?? '',
      symbol,
      name: symbol === null ? null : `Demo Token ${symbol.slice(4)}`,
      decimals: 6,
      liquidityUsd: String(15_000 + i * 9_000),
      mintAuthorityActive: false,
      freezeAuthorityActive: false,
    })),
  );

  let counter = 0;
  async function signal(input: {
    wallet: number;
    side: 'buy' | 'sell';
    token: number;
    hoursAgo: number;
    solLamports: bigint;
    decision: 'accepted' | 'rejected';
    reasons: RiskReason[];
  }): Promise<number> {
    counter += 1;
    const at = ago(input.hoursAgo);
    const [event] = await db
      .insert(swapEvents)
      .values({
        signature: fakeSignature(`demo swap ${counter}`),
        slot: BigInt(300_000_000 + counter),
        blockTime: at,
        wallet: walletAddresses[input.wallet] ?? '',
        side: input.side,
        tokenMint: mints[input.token] ?? '',
        tokenAmountRaw: 1_000_000n * BigInt(100 + counter),
        tokenDecimals: 6,
        quoteMint: WSOL_MINT,
        quoteAmountRaw: input.solLamports,
        quoteDecimals: 9,
        source: 'pumpfun',
      })
      .$returningId();
    const [row] = await db
      .insert(signals)
      .values({
        // Ids follow time, as they do when the bot inserts signals as they arrive.
        id: Math.round((400 - input.hoursAgo) * 3600) * 100 + counter,
        swapEventId: event?.id ?? 0,
        trackedWalletId: walletIds[input.wallet] ?? 0,
        mode: 'paper',
        decision: input.decision,
        reasons: input.reasons,
        receivedAt: at,
        createdAt: at,
      })
      .$returningId();
    return row?.id ?? 0;
  }

  const fees = NETWORK_FEE + PRIORITY_FEE;

  // Closed positions spread over the last 14 days: proceeds as a percent of the cost.
  const closed = [
    { hoursAgo: 300, holdHours: 3, pct: 162n, reason: 'take_profit' as const },
    { hoursAgo: 270, holdHours: 2, pct: 71n, reason: 'stop_loss' as const },
    { hoursAgo: 220, holdHours: 4, pct: 118n, reason: 'follow_sell' as const },
    { hoursAgo: 190, holdHours: 1, pct: 92n, reason: 'follow_sell' as const },
    { hoursAgo: 150, holdHours: 4, pct: 64n, reason: 'stop_loss' as const },
    { hoursAgo: 120, holdHours: 2, pct: 201n, reason: 'take_profit' as const },
    { hoursAgo: 98, holdHours: 4, pct: 103n, reason: 'max_hold' as const },
    { hoursAgo: 70, holdHours: 1, pct: 0n, reason: 'unsellable' as const },
    { hoursAgo: 45, holdHours: 3, pct: 131n, reason: 'follow_sell' as const },
    { hoursAgo: 20, holdHours: 2, pct: 88n, reason: 'follow_sell' as const },
    { hoursAgo: 3, holdHours: 1, pct: 124n, reason: 'take_profit' as const },
  ];
  for (const [i, item] of closed.entries()) {
    const wallet = i % 3;
    const token = i % 6;
    const cost = 50_000_000n;
    const proceeds = (cost * item.pct) / 100n;
    const sellFees = item.reason === 'unsellable' ? 0n : fees;
    const realized = proceeds - cost - fees - sellFees;
    const openedAt = ago(item.hoursAgo + item.holdHours);
    const closedAt = ago(item.hoursAgo);
    const signalId = await signal({
      wallet,
      side: 'buy',
      token,
      hoursAgo: item.hoursAgo + item.holdHours,
      solLamports: SOL / 2n + BigInt(i) * 70_000_000n,
      decision: 'accepted',
      reasons: [],
    });
    const [position] = await db
      .insert(positions)
      .values({
        mode: 'paper',
        status: 'closed',
        tokenMint: mints[token] ?? '',
        tokenDecimals: 6,
        trackedWalletId: walletIds[wallet] ?? null,
        openedFromSignalId: signalId,
        initialTokenAmountRaw: 5_000_000_000n,
        tokenAmountRaw: 0n,
        costLamports: cost,
        proceedsLamports: proceeds,
        feesLamports: fees + sellFees,
        realizedPnlLamports: realized,
        closeReason: item.reason,
        openedAt,
        closedAt,
      })
      .$returningId();
    const positionId = position?.id ?? 0;
    await db.insert(trades).values([
      {
        positionId,
        signalId,
        mode: 'paper',
        side: 'buy',
        reason: 'copy_buy',
        status: 'simulated',
        tokenMint: mints[token] ?? '',
        tokenAmountRaw: 5_000_000_000n,
        tokenDecimals: 6,
        solAmountLamports: cost,
        priceSol: '0.00001',
        networkFeeLamports: NETWORK_FEE,
        priorityFeeLamports: PRIORITY_FEE,
        dexFeeLamports: 250_000n,
        slippageBps: 120,
        executedAt: openedAt,
      },
      {
        positionId,
        signalId: null,
        mode: 'paper',
        side: 'sell',
        reason: item.reason,
        status: 'simulated',
        tokenMint: mints[token] ?? '',
        tokenAmountRaw: 5_000_000_000n,
        tokenDecimals: 6,
        solAmountLamports: proceeds,
        priceSol: null,
        networkFeeLamports: item.reason === 'unsellable' ? 0n : NETWORK_FEE,
        priorityFeeLamports: item.reason === 'unsellable' ? 0n : PRIORITY_FEE,
        dexFeeLamports: item.reason === 'unsellable' ? 0n : 250_000n,
        slippageBps: item.reason === 'unsellable' ? null : 150,
        realizedPnlLamports: realized,
        executedAt: closedAt,
      },
    ]);
  }

  // Open positions: valued, valued after a partial sell, without a route, not valued yet.
  const open = [
    { token: 0, wallet: 0, hoursAgo: 2.5, value: 61_000_000n as bigint | null, valued: true },
    { token: 2, wallet: 1, hoursAgo: 1.2, value: 18_500_000n as bigint | null, valued: true },
    { token: 4, wallet: 2, hoursAgo: 0.6, value: null, valued: true },
    { token: 6, wallet: 0, hoursAgo: 0.05, value: null, valued: false },
  ];
  for (const [i, item] of open.entries()) {
    const partial = i === 1;
    const signalId = await signal({
      wallet: item.wallet,
      side: 'buy',
      token: item.token,
      hoursAgo: item.hoursAgo,
      solLamports: 900_000_000n + BigInt(i) * 250_000_000n,
      decision: 'accepted',
      reasons: [],
    });
    const [position] = await db
      .insert(positions)
      .values({
        mode: 'paper',
        status: 'open',
        tokenMint: mints[item.token] ?? '',
        tokenDecimals: 6,
        trackedWalletId: walletIds[item.wallet] ?? null,
        openedFromSignalId: signalId,
        initialTokenAmountRaw: 4_000_000_000n,
        tokenAmountRaw: partial ? 2_000_000_000n : 4_000_000_000n,
        costLamports: 50_000_000n,
        proceedsLamports: partial ? 33_000_000n : 0n,
        feesLamports: partial ? 2n * fees : fees,
        realizedPnlLamports: partial ? 33_000_000n - 25_000_000n - 2n * fees : null,
        lastValueLamports: item.value,
        lastValuedAt: item.valued ? ago(0.01) : null,
        openedAt: ago(item.hoursAgo),
      })
      .$returningId();
    await db.insert(trades).values({
      positionId: position?.id ?? 0,
      signalId,
      mode: 'paper',
      side: 'buy',
      reason: 'copy_buy',
      status: 'simulated',
      tokenMint: mints[item.token] ?? '',
      tokenAmountRaw: 4_000_000_000n,
      tokenDecimals: 6,
      solAmountLamports: 50_000_000n,
      priceSol: '0.0000125',
      networkFeeLamports: NETWORK_FEE,
      priorityFeeLamports: PRIORITY_FEE,
      dexFeeLamports: 250_000n,
      slippageBps: 110,
      executedAt: ago(item.hoursAgo),
    });
  }

  // Skipped signals with the reasons the risk engine gives.
  const rejected: { hoursAgo: number; side: 'buy' | 'sell'; reasons: RiskReason[] }[] = [
    {
      hoursAgo: 0.3,
      side: 'buy',
      reasons: [{ code: 'liquidity_below_min', detail: { min: '20000', actual: '8412.5' } }],
    },
    { hoursAgo: 1.5, side: 'buy', reasons: [{ code: 'already_holding' }] },
    {
      hoursAgo: 4,
      side: 'buy',
      reasons: [{ code: 'max_open_positions', detail: { open: 5, max: 5 } }],
    },
    {
      hoursAgo: 7,
      side: 'buy',
      reasons: [{ code: 'mint_authority_active' }, { code: 'freeze_authority_active' }],
    },
    { hoursAgo: 30, side: 'sell', reasons: [{ code: 'already_holding' }] },
    { hoursAgo: 60, side: 'buy', reasons: [{ code: 'token_flagged_suspicious' }] },
    { hoursAgo: 130, side: 'buy', reasons: [{ code: 'trading_paused' }] },
  ];
  for (const [i, item] of rejected.entries()) {
    await signal({
      wallet: (i + 1) % 3,
      side: item.side,
      token: (i + 3) % 7,
      hoursAgo: item.hoursAgo,
      solLamports: 300_000_000n + BigInt(i) * 120_000_000n,
      decision: 'rejected',
      reasons: item.reasons,
    });
  }

  await db.insert(settings).values([
    { name: 'trading_paused', value: false },
    { name: 'risk_limits', value: { maxOpenPositions: '4' } },
  ]);
  await db.insert(auditLog).values([
    {
      actor: 'dashboard',
      action: 'limits.update',
      details: { changes: { maxOpenPositions: { from: null, to: '4' } } },
    },
    { actor: 'telegram:demo', action: 'trading.resume', details: { paused: false } },
  ]);

  console.log(`Data demo dimasukkan ke ${new URL(url).pathname.slice(1)}.`);
} finally {
  await database.close();
}
