import { WSOL_MINT, type RiskReason } from '@solaryna/core';
import { describe, expect, it } from 'vitest';
import {
  getDashboardPosition,
  getDashboardWallet,
  getOverviewTotals,
  getTrackedWallet,
  listClosedDashboardPositions,
  listDashboardSignals,
  listDashboardTrades,
  listDashboardWallets,
  listOpenDashboardPositions,
  listRealizedPnlPoints,
} from './dashboard';
import {
  positions,
  signals,
  swapEvents,
  tokens,
  trackedWallets,
  trades,
  walletScores,
} from './schema';
import { TEST_DATABASE_URL, useTestDatabase } from './test-db';

const W_A = 'J8M2wM8vtBLZJfajpczrjbs78PWhW1sqVFVJdE5d43jX';
const W_B = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const MINT = (n: number) => `Mint${String(n).repeat(40)}`;
const T0 = new Date('2026-10-31T03:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const DAY = 24 * 60;
const today = {
  from: new Date('2026-10-30T17:00:00.000Z'),
  to: new Date('2026-10-31T17:00:00.000Z'),
};
const week = { from: at(-7 * DAY), to: at(DAY) };
const page = (limit: number, offset = 0) => ({ limit, offset });

describe.skipIf(TEST_DATABASE_URL === undefined)('dashboard queries (MySQL)', () => {
  const { db } = useTestDatabase();

  async function seed() {
    const [a] = await db
      .insert(trackedWallets)
      .values({ address: W_A, label: 'alpha', source: 'manual' })
      .$returningId();
    const [b] = await db
      .insert(trackedWallets)
      .values({ address: W_B, label: null, source: 'manual', isActive: false })
      .$returningId();
    const walletA = a?.id ?? 0;
    const walletB = b?.id ?? 0;
    await db.insert(tokens).values({ mint: MINT(1), symbol: 'AAA', name: 'Aaa', decimals: 6 });
    await db.insert(walletScores).values([
      {
        walletAddress: W_A,
        scoreDate: '2026-10-29',
        windowDays: 30,
        realizedPnlLamports: 0n,
        tradeCount: 1,
        flags: [],
        score: '1.5',
      },
      {
        walletAddress: W_A,
        scoreDate: '2026-10-30',
        windowDays: 30,
        realizedPnlLamports: 0n,
        tradeCount: 1,
        flags: [],
        score: '2.25',
      },
    ]);

    let n = 0;
    async function signal(input: {
      wallet: 'A' | 'B';
      side: 'buy' | 'sell';
      mint: number;
      decision: 'accepted' | 'rejected';
      minutes: number;
      mode?: 'paper' | 'live';
      reasons?: RiskReason[];
    }) {
      n += 1;
      const [swap] = await db
        .insert(swapEvents)
        .values({
          signature: `sig${n}`,
          slot: BigInt(n),
          blockTime: at(input.minutes),
          wallet: input.wallet === 'A' ? W_A : W_B,
          side: input.side,
          tokenMint: MINT(input.mint),
          tokenAmountRaw: 1_000_000n,
          tokenDecimals: 6,
          quoteMint: WSOL_MINT,
          quoteAmountRaw: 500_000_000n,
          quoteDecimals: 9,
          source: 'pumpfun',
        })
        .$returningId();
      const [row] = await db
        .insert(signals)
        .values({
          swapEventId: swap?.id ?? 0,
          trackedWalletId: input.wallet === 'A' ? walletA : walletB,
          mode: input.mode ?? 'paper',
          decision: input.decision,
          reasons: input.reasons ?? [],
          createdAt: at(input.minutes),
        })
        .$returningId();
      return row?.id ?? 0;
    }

    const s1 = await signal({
      wallet: 'A',
      side: 'buy',
      mint: 1,
      decision: 'accepted',
      minutes: -10,
    });
    const s2 = await signal({
      wallet: 'A',
      side: 'buy',
      mint: 2,
      decision: 'accepted',
      minutes: 0,
    });
    const s3 = await signal({
      wallet: 'A',
      side: 'sell',
      mint: 1,
      decision: 'accepted',
      minutes: 30,
    });
    const s4 = await signal({
      wallet: 'A',
      side: 'buy',
      mint: 3,
      decision: 'rejected',
      minutes: 5,
      reasons: [{ code: 'liquidity_below_min', detail: { min: '20000', actual: '100' } }],
    });
    const s5 = await signal({
      wallet: 'B',
      side: 'buy',
      mint: 4,
      decision: 'rejected',
      minutes: 6,
    });
    await signal({
      wallet: 'A',
      side: 'buy',
      mint: 6,
      decision: 'accepted',
      minutes: 35,
      mode: 'live',
    });

    async function position(input: {
      wallet: 'A' | 'B';
      mint: number;
      mode?: 'paper' | 'live';
      openedMinutes: number;
      closedMinutes?: number;
      realized?: bigint;
    }) {
      const closed = input.closedMinutes !== undefined;
      const mode = input.mode ?? 'paper';
      const [row] = await db
        .insert(positions)
        .values({
          mode,
          status: closed ? 'closed' : 'open',
          tokenMint: MINT(input.mint),
          tokenDecimals: 6,
          trackedWalletId: input.wallet === 'A' ? walletA : walletB,
          initialTokenAmountRaw: 1_000_000n,
          tokenAmountRaw: closed ? 0n : 1_000_000n,
          costLamports: 50_000_000n,
          proceedsLamports: closed ? 50_000_000n + (input.realized ?? 0n) + 410_000n : 0n,
          feesLamports: closed ? 410_000n : 205_000n,
          realizedPnlLamports: closed ? (input.realized ?? 0n) : 0n,
          closeReason: closed ? 'follow_sell' : null,
          lastValueLamports: closed ? null : 55_000_000n,
          lastValuedAt: closed ? null : at(1),
          openedAt: at(input.openedMinutes),
          closedAt: closed ? at(input.closedMinutes ?? 0) : null,
        })
        .$returningId();
      const id = row?.id ?? 0;
      const trade = (side: 'buy' | 'sell', minutes: number, realized: bigint | null) => ({
        positionId: id,
        mode,
        side,
        reason: side === 'buy' ? ('copy_buy' as const) : ('follow_sell' as const),
        status: 'simulated' as const,
        tokenMint: MINT(input.mint),
        tokenAmountRaw: 1_000_000n,
        tokenDecimals: 6,
        solAmountLamports: 50_000_000n,
        networkFeeLamports: 5000n,
        priorityFeeLamports: 200_000n,
        dexFeeLamports: 1000n,
        realizedPnlLamports: realized,
        executedAt: at(minutes),
      });
      await db.insert(trades).values(trade('buy', input.openedMinutes, null));
      if (closed) {
        await db
          .insert(trades)
          .values(trade('sell', input.closedMinutes ?? 0, input.realized ?? 0n));
      }
      return id;
    }

    const p1 = await position({
      wallet: 'A',
      mint: 1,
      openedMinutes: -10,
      closedMinutes: 30,
      realized: 5_000_000n,
    });
    const p2 = await position({ wallet: 'A', mint: 2, openedMinutes: 0 });
    const p3 = await position({
      wallet: 'B',
      mint: 5,
      openedMinutes: -2 * DAY - 60,
      closedMinutes: -2 * DAY,
      realized: -3_000_000n,
    });
    const p4 = await position({
      wallet: 'A',
      mint: 7,
      openedMinutes: -10 * DAY - 60,
      closedMinutes: -10 * DAY,
      realized: 1_000_000n,
    });
    const p5 = await position({
      wallet: 'A',
      mint: 6,
      mode: 'live',
      openedMinutes: 35,
      closedMinutes: 40,
      realized: 100_000_000n,
    });
    return { walletA, walletB, s1, s2, s3, s4, s5, p1, p2, p3, p4, p5 };
  }

  it('totals realized PnL, fees, win rate and signals for one mode', async () => {
    await seed();
    expect(await getOverviewTotals(db, 'paper', today, week)).toEqual({
      realizedTodayLamports: 5_000_000n,
      realizedWeekLamports: 2_000_000n,
      realizedAllLamports: 3_000_000n,
      feesWeekLamports: 5n * 205_000n,
      closedCount: 3,
      winCount: 2,
      signalsToday: { accepted: 3, rejected: 2 },
    });
    expect(await getOverviewTotals(db, 'live', today, week)).toMatchObject({
      realizedAllLamports: 100_000_000n,
      closedCount: 1,
      signalsToday: { accepted: 1, rejected: 0 },
    });
  });

  it('lists signals newest first with filters, paging and token symbols', async () => {
    const ids = await seed();
    const all = await listDashboardSignals(db, 'paper', {}, page(50));
    expect(all.map((s) => s.id)).toEqual([ids.s5, ids.s4, ids.s3, ids.s2, ids.s1]);
    expect(all.find((s) => s.id === ids.s1)).toMatchObject({
      tokenSymbol: 'AAA',
      walletLabel: 'alpha',
      walletAddress: W_A,
      side: 'buy',
      quoteAmountRaw: 500_000_000n,
      signature: 'sig1',
    });
    expect(all.find((s) => s.id === ids.s4)).toMatchObject({
      tokenSymbol: null,
      decision: 'rejected',
      reasons: [{ code: 'liquidity_below_min', detail: { min: '20000', actual: '100' } }],
    });
    const ofIds = async (filter: Parameters<typeof listDashboardSignals>[2], p = page(50)) =>
      (await listDashboardSignals(db, 'paper', filter, p)).map((s) => s.id);
    expect(await ofIds({ decision: 'rejected' })).toEqual([ids.s5, ids.s4]);
    expect(await ofIds({ side: 'sell' })).toEqual([ids.s3]);
    expect(await ofIds({ walletId: ids.walletB })).toEqual([ids.s5]);
    expect(await ofIds({}, page(2, 1))).toEqual([ids.s4, ids.s3]);
  });

  it('lists open and closed positions per mode with wallet and token labels', async () => {
    const ids = await seed();
    const open = await listOpenDashboardPositions(db, 'paper');
    expect(open.map((p) => p.position.id)).toEqual([ids.p2]);
    expect(open[0]).toMatchObject({
      walletLabel: 'alpha',
      walletId: ids.walletA,
      tokenSymbol: null,
    });
    expect(open[0]?.position.lastValueLamports).toBe(55_000_000n);

    const closed = await listClosedDashboardPositions(db, 'paper', page(50));
    expect(closed.map((p) => p.position.id)).toEqual([ids.p1, ids.p3, ids.p4]);
    expect(closed[0]?.tokenSymbol).toBe('AAA');
    expect(
      (await listClosedDashboardPositions(db, 'paper', page(50), ids.walletA)).map(
        (p) => p.position.id,
      ),
    ).toEqual([ids.p1, ids.p4]);
    expect(
      (await listClosedDashboardPositions(db, 'paper', page(1, 1))).map((p) => p.position.id),
    ).toEqual([ids.p3]);
    expect(
      (await listClosedDashboardPositions(db, 'live', page(50))).map((p) => p.position.id),
    ).toEqual([ids.p5]);
  });

  it('returns a position with its trades, or null for an unknown id', async () => {
    const ids = await seed();
    const detail = await getDashboardPosition(db, ids.p1);
    expect(detail?.trades.map((t) => t.side)).toEqual(['buy', 'sell']);
    expect(detail?.walletLabel).toBe('alpha');
    expect(await getDashboardPosition(db, 999_999)).toBeNull();
  });

  it('lists trades newest first and realized PnL points in a range', async () => {
    const ids = await seed();
    const recent = await listDashboardTrades(db, 'paper', page(3));
    expect(recent.map((t) => [t.trade.positionId, t.trade.side])).toEqual([
      [ids.p1, 'sell'],
      [ids.p2, 'buy'],
      [ids.p1, 'buy'],
    ]);
    expect(recent[0]?.tokenSymbol).toBe('AAA');
    expect(await listRealizedPnlPoints(db, 'paper', at(-3 * DAY), at(DAY))).toEqual([
      { at: at(-2 * DAY), pnlLamports: -3_000_000n },
      { at: at(30), pnlLamports: 5_000_000n },
    ]);
  });

  it('summarizes each wallet in one mode, active wallets first', async () => {
    const ids = await seed();
    const wallets = await listDashboardWallets(db, 'paper', at(-30 * DAY));
    expect(wallets.map((w) => w.wallet.id)).toEqual([ids.walletA, ids.walletB]);
    expect(wallets[0]).toMatchObject({
      latestScore: '2.2500000000',
      stats: {
        buySignals: 3,
        followed: 2,
        closedPositions: 2,
        wins: 2,
        realizedPnlLamports: 6_000_000n,
        openPositions: 1,
      },
    });
    expect(wallets[1]).toMatchObject({
      latestScore: null,
      stats: {
        buySignals: 1,
        followed: 0,
        closedPositions: 1,
        wins: 0,
        realizedPnlLamports: -3_000_000n,
        openPositions: 0,
      },
    });
    const live = await listDashboardWallets(db, 'live', at(-30 * DAY));
    expect(live[0]?.stats).toMatchObject({
      buySignals: 1,
      closedPositions: 1,
      realizedPnlLamports: 100_000_000n,
    });
    expect((await listDashboardWallets(db, 'paper', at(DAY)))[0]?.stats.buySignals).toBe(0);
  });

  it('returns one wallet with its latest swaps, or null', async () => {
    const ids = await seed();
    const detail = await getDashboardWallet(db, ids.walletA, 'paper', at(-30 * DAY));
    expect(detail?.wallet.stats.openPositions).toBe(1);
    expect(detail?.swaps.map((s) => s.signature)).toEqual(['sig6', 'sig3', 'sig4', 'sig2', 'sig1']);
    expect(await getDashboardWallet(db, 999_999, 'paper', at(-30 * DAY))).toBeNull();
    expect((await getTrackedWallet(db, ids.walletB))?.isActive).toBe(false);
    expect(await getTrackedWallet(db, 999_999)).toBeUndefined();
  });
});
