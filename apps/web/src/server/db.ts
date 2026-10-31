import 'server-only';
import { createDb, type Database } from '@solaryna/db';
import { getWebConfig } from './config';

// Kept on globalThis so dev hot reloads reuse one connection pool instead of leaking new ones.
const holder = globalThis as typeof globalThis & { solarynaDb?: ReturnType<typeof createDb> };

export function getDb(): Database {
  holder.solarynaDb ??= createDb(getWebConfig().databaseUrl.reveal());
  return holder.solarynaDb.db;
}
