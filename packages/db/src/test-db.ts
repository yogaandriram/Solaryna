import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { createDb, type Database } from './client';

// Shared setup for tests that run against a real MySQL database, e.g.
//   TEST_DATABASE_URL=mysql://root:@127.0.0.1:3306/solaryna_test npm run test
// The database must exist (npm run db:create with that URL); it is migrated and wiped before
// every test. Test files using it run one at a time (see vitest.config.ts).

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** Children first, so foreign keys never block the wipe. */
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

/** Registers migrate/wipe/close hooks for the current describe block. */
export function useTestDatabase(): { db: Database } {
  const database = createDb(TEST_DATABASE_URL ?? '');

  beforeAll(async () => {
    if (!/\/[A-Za-z0-9_]*test[A-Za-z0-9_]*$/.test(new URL(TEST_DATABASE_URL ?? '').pathname)) {
      throw new Error('TEST_DATABASE_URL must point to a database whose name contains "test"');
    }
    await migrate(database.db, {
      migrationsFolder: new URL('../migrations', import.meta.url).pathname.replace(
        /^\/(\w:)/,
        '$1',
      ),
    });
  });

  beforeEach(async () => {
    for (const table of TABLES) {
      await database.db.execute(sql.raw(`DELETE FROM \`${table}\``));
    }
  });

  afterAll(async () => {
    await database.close();
  });

  return { db: database.db };
}
