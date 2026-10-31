import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';

export function createDb(databaseUrl: string) {
  const pool = mysql.createPool({
    uri: databaseUrl,
    supportBigNumbers: true,
    bigNumberStrings: true,
    connectionLimit: 10,
  });
  // CURRENT_TIMESTAMP defaults must produce UTC like the values written by the app.
  pool.pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'", (error) => {
      // A connection with the wrong time zone would silently skew timestamps: drop it.
      if (error) {
        connection.destroy();
      }
    });
  });

  const db = drizzle({ client: pool, schema, mode: 'default' });

  return {
    db,
    async ping(): Promise<void> {
      await db.execute(sql`SELECT 1`);
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

export type Database = ReturnType<typeof createDb>['db'];
