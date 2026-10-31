import { WSOL_MINT, type SwapEvent } from '@solaryna/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  addManualWallet,
  deactivateWallet,
  findToken,
  insertAuditLog,
  insertSwapEvent,
  isDuplicateKeyError,
  listActiveWallets,
  listAuditLogAfter,
  listRecentAuditLog,
  maxAuditLogId,
  upsertTokenMetadata,
} from './queries';
import { TEST_DATABASE_URL, useTestDatabase } from './test-db';

describe.skipIf(TEST_DATABASE_URL === undefined)('queries (MySQL)', () => {
  const { db } = useTestDatabase();
  const wallet = 'J8M2wM8vtBLZJfajpczrjbs78PWhW1sqVFVJdE5d43jX';

  it('adds, reactivates, and deactivates manual wallets', async () => {
    expect((await addManualWallet(db, { address: wallet, label: 'alpha' })).status).toBe('added');
    expect((await addManualWallet(db, { address: wallet, label: null })).status).toBe(
      'already_active',
    );
    expect(await deactivateWallet(db, wallet)).toBe('deactivated');
    expect(await deactivateWallet(db, wallet)).toBe('already_inactive');
    expect(await listActiveWallets(db)).toEqual([]);

    const reactivated = await addManualWallet(db, { address: wallet, label: null });
    expect(reactivated.status).toBe('reactivated');
    expect(reactivated.wallet).toMatchObject({ label: 'alpha', source: 'manual', isActive: true });
    expect(await deactivateWallet(db, 'So11111111111111111111111111111111111111112')).toBe(
      'not_found',
    );
  });

  it('dedupes swap events by (signature, wallet)', async () => {
    const event: SwapEvent = {
      signature:
        'ZZmZgznrDWqm2fGnWiSjQfU1XHPbhC6arvAVDnhNsFoJ9GQGvuBBf9wiwFejKkTitn8y5Xvkh3gZQCrRNUxgTHQ',
      slot: 463_539_517n,
      blockTime: new Date('2026-10-31T03:36:40.000Z'),
      wallet,
      side: 'sell',
      tokenMint: '4CLJSkwJ7JsNvrtZrVwqcXecYrAwUTSkTC1p7gzqpump',
      tokenAmountRaw: 27_483_996_149_265n,
      tokenDecimals: 6,
      quoteMint: WSOL_MINT,
      quoteAmountRaw: 3_639_046_262n,
      quoteDecimals: 9,
      source: 'pumpfun',
    };
    const first = await insertSwapEvent(db, event, { fee: '9000' });
    expect(first.status).toBe('inserted');
    expect(await insertSwapEvent(db, event, { fee: '9000' })).toEqual({ status: 'duplicate' });
    // Same transaction, different (case-sensitive) wallet: a separate event.
    expect(
      (await insertSwapEvent(db, { ...event, wallet: wallet.toLowerCase() }, null)).status,
    ).toBe('inserted');
  });

  it('caches token metadata and updates it in place', async () => {
    const mint = '4CLJSkwJ7JsNvrtZrVwqcXecYrAwUTSkTC1p7gzqpump';
    await upsertTokenMetadata(db, { mint, decimals: 6, symbol: null, name: null });
    await upsertTokenMetadata(db, { mint, decimals: 6, symbol: 'PEPE', name: 'Pepe 🐸' });
    expect(await findToken(db, mint)).toMatchObject({
      symbol: 'PEPE',
      name: 'Pepe 🐸',
      decimals: 6,
    });
  });

  it('writes audit entries', async () => {
    await insertAuditLog(db, { actor: 'telegram:1', action: 'settings.test', details: { wallet } });
    const [rows] = await db.execute(sql`SELECT actor, action, details FROM audit_log`);
    expect(rows).toEqual([{ actor: 'telegram:1', action: 'settings.test', details: { wallet } }]);
  });

  it('audits wallet changes inside the same transaction', async () => {
    const actor = { actor: 'telegram:10:20' };
    await addManualWallet(db, { address: wallet, label: 'alpha' }, actor);
    await deactivateWallet(db, wallet, actor);
    await deactivateWallet(db, wallet, actor);
    const [rows] = await db.execute(sql`SELECT actor, action, details FROM audit_log ORDER BY id`);
    expect(rows).toEqual([
      {
        actor: 'telegram:10:20',
        action: 'wallet.add',
        details: { address: wallet, label: 'alpha', status: 'added' },
      },
      {
        actor: 'telegram:10:20',
        action: 'wallet.remove',
        details: { address: wallet, status: 'deactivated' },
      },
    ]);
  });

  it('lists audit entries after a cursor for one actor', async () => {
    expect(await maxAuditLogId(db)).toBe(0);
    await insertAuditLog(db, { actor: 'dashboard', action: 'trading.pause' });
    await insertAuditLog(db, { actor: 'telegram:1:2', action: 'trading.resume' });
    await insertAuditLog(db, { actor: 'dashboard', action: 'trading.resume' });
    const max = await maxAuditLogId(db);
    expect(max).toBeGreaterThan(0);
    const all = await listAuditLogAfter(db, 0, 'dashboard');
    expect(all.map((row) => row.action)).toEqual(['trading.pause', 'trading.resume']);
    const first = all[0]?.id ?? 0;
    expect((await listAuditLogAfter(db, first, 'dashboard')).map((row) => row.action)).toEqual([
      'trading.resume',
    ]);
    expect(await listAuditLogAfter(db, max, 'dashboard')).toEqual([]);
    expect((await listRecentAuditLog(db, 2)).map((row) => row.actor)).toEqual([
      'dashboard',
      'telegram:1:2',
    ]);
  });
});

describe('isDuplicateKeyError', () => {
  it('recognizes wrapped and unwrapped MySQL duplicate errors only', () => {
    expect(isDuplicateKeyError({ code: 'ER_DUP_ENTRY' })).toBe(true);
    expect(isDuplicateKeyError(new Error('x', { cause: { code: 'ER_DUP_ENTRY' } }))).toBe(true);
    expect(isDuplicateKeyError(new Error('x', { cause: { code: 'ER_PARSE_ERROR' } }))).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
  });
});
