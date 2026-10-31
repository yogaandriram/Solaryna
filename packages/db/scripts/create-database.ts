import { ConfigError, loadDatabaseConfig, loadRootEnvFile } from '@solaryna/config';
import mysql from 'mysql2/promise';

// Creates the database named in DATABASE_URL (utf8mb4) if it does not exist yet.
async function main(): Promise<void> {
  loadRootEnvFile();
  const url = new URL(loadDatabaseConfig(process.env).databaseUrl.reveal());
  // Validated by the config schema: letters, digits, and underscores only.
  const databaseName = url.pathname.slice(1);
  url.pathname = '/';

  const connection = await mysql.createConnection({ uri: url.toString() });
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
    console.log(`Database "${databaseName}" is ready.`);
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    // mysql2 errors carry code/message but not the connection URI.
    const { code, message } = error as { code?: string; message?: string };
    console.error(`Failed to create database: ${code ?? ''} ${message ?? String(error)}`);
  }
  process.exitCode = 1;
});
