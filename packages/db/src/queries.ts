import type { SwapEvent } from '@solaryna/core';
import { asc, eq } from 'drizzle-orm';
import type { Database } from './client';
import { auditLog, swapEvents, tokens, trackedWallets } from './schema';

export type TrackedWallet = typeof trackedWallets.$inferSelect;
export type TokenRow = typeof tokens.$inferSelect;

/** MySQL duplicate-key error, possibly wrapped by drizzle. */
export function isDuplicateKeyError(error: unknown): boolean {
  for (let current: unknown = error; current instanceof Object;) {
    if ('code' in current && current.code === 'ER_DUP_ENTRY') {
      return true;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

export async function listActiveWallets(db: Database): Promise<TrackedWallet[]> {
  return db
    .select()
    .from(trackedWallets)
    .where(eq(trackedWallets.isActive, true))
    .orderBy(asc(trackedWallets.id));
}

export type AddWalletStatus = 'added' | 'reactivated' | 'already_active';

/** Who made a change; when given, the change is written to audit_log in the same transaction. */
export interface AuditActor {
  actor: string;
}

/** Adds a manual wallet, or reactivates it. A given label replaces the stored one. */
export async function addManualWallet(
  db: Database,
  input: { address: string; label: string | null },
  audit?: AuditActor,
): Promise<{ status: AddWalletStatus; wallet: TrackedWallet }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(trackedWallets)
      .where(eq(trackedWallets.address, input.address))
      .for('update');

    if (existing === undefined) {
      await tx
        .insert(trackedWallets)
        .values({ address: input.address, label: input.label, source: 'manual' });
    } else {
      await tx
        .update(trackedWallets)
        .set({ isActive: true, label: input.label ?? existing.label })
        .where(eq(trackedWallets.id, existing.id));
    }

    const [wallet] = await tx
      .select()
      .from(trackedWallets)
      .where(eq(trackedWallets.address, input.address));
    if (wallet === undefined) {
      throw new Error('Tracked wallet disappeared inside its own transaction');
    }
    const status: AddWalletStatus =
      existing === undefined ? 'added' : existing.isActive ? 'already_active' : 'reactivated';
    if (audit !== undefined) {
      await tx.insert(auditLog).values({
        actor: audit.actor,
        action: 'wallet.add',
        details: { address: input.address, label: wallet.label, status },
      });
    }
    return { status, wallet };
  });
}

export type RemoveWalletStatus = 'deactivated' | 'already_inactive' | 'not_found';

/** Soft-removes a wallet: history (signals, positions) keeps pointing at it. */
export async function deactivateWallet(
  db: Database,
  address: string,
  audit?: AuditActor,
): Promise<RemoveWalletStatus> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(trackedWallets)
      .where(eq(trackedWallets.address, address))
      .for('update');
    if (existing === undefined) {
      return 'not_found';
    }
    if (!existing.isActive) {
      return 'already_inactive';
    }
    await tx
      .update(trackedWallets)
      .set({ isActive: false })
      .where(eq(trackedWallets.id, existing.id));
    if (audit !== undefined) {
      await tx.insert(auditLog).values({
        actor: audit.actor,
        action: 'wallet.remove',
        details: { address, status: 'deactivated' },
      });
    }
    return 'deactivated';
  });
}

/** Inserts a swap; a redelivered (signature, wallet) pair is reported instead of failing. */
export async function insertSwapEvent(
  db: Database,
  event: SwapEvent,
  raw: unknown,
): Promise<{ status: 'inserted'; id: number } | { status: 'duplicate' }> {
  try {
    const [row] = await db
      .insert(swapEvents)
      .values({ ...event, raw })
      .$returningId();
    if (row === undefined) {
      throw new Error('Insert into swap_events returned no id');
    }
    return { status: 'inserted', id: row.id };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return { status: 'duplicate' };
    }
    throw error;
  }
}

export async function findToken(db: Database, mint: string): Promise<TokenRow | undefined> {
  const [row] = await db.select().from(tokens).where(eq(tokens.mint, mint));
  return row;
}

/** Caches token metadata. Name/symbol must already be sanitized to the column lengths. */
export async function upsertTokenMetadata(
  db: Database,
  input: { mint: string; decimals: number; symbol: string | null; name: string | null },
): Promise<void> {
  await db
    .insert(tokens)
    .values(input)
    .onDuplicateKeyUpdate({
      set: {
        decimals: input.decimals,
        symbol: input.symbol,
        name: input.name,
        updatedAt: new Date(),
      },
    });
}

export async function insertAuditLog(
  db: Database,
  entry: { actor: string; action: string; details?: Record<string, unknown> },
): Promise<void> {
  await db.insert(auditLog).values({
    actor: entry.actor,
    action: entry.action,
    details: entry.details ?? null,
  });
}
