import { sql } from 'drizzle-orm';
import { customType, datetime } from 'drizzle-orm/mysql-core';

export function rawAmountToDriver(value: bigint): string {
  return value.toString();
}

export function rawAmountFromDriver(value: unknown): bigint {
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }
  if (typeof value === 'bigint') {
    return value;
  }
  throw new TypeError('Expected an integer DECIMAL(40,0) value from the database');
}

/**
 * Raw on-chain amount (lamports, raw token units) as DECIMAL(40,0) ⇄ bigint.
 * Never use JS numbers for amounts: u64 token supplies exceed Number.MAX_SAFE_INTEGER.
 */
export const rawAmount = customType<{ data: bigint; driverData: string }>({
  dataType: () => 'decimal(40,0)',
  toDriver: rawAmountToDriver,
  fromDriver: rawAmountFromDriver,
});

/**
 * Base58 identifiers (addresses, mints, signatures) are case-sensitive, so they must not use
 * the database's case-insensitive utf8mb4 collation.
 */
export const base58 = customType<{ data: string; driverData: string; config: { length: number } }>({
  dataType: (config) => `varchar(${config?.length ?? 44}) CHARACTER SET ascii COLLATE ascii_bin`,
});

export const ADDRESS_LENGTH = 44;
export const SIGNATURE_LENGTH = 88;

/** DATETIME(3) stored as UTC (drizzle maps Date ⇄ UTC string; the client pins the session to UTC). */
export function utcDatetime(name: string) {
  return datetime(name, { mode: 'date', fsp: 3 });
}

export function createdAt() {
  return utcDatetime('created_at')
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP(3))`)
    .$defaultFn(() => new Date());
}

export function updatedAt() {
  return utcDatetime('updated_at')
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP(3))`)
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());
}
