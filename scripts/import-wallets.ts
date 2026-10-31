import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ConfigError, loadDatabaseConfig, loadRootEnvFile } from '@solaryna/config';
import { parseWalletList, shortAddress } from '@solaryna/core';
import { addManualWallet, createDb, type AddWalletStatus } from '@solaryna/db';

// Imports tracked wallets from a text file copied by hand (e.g. from GMGN), one per line:
//   <address> [label]
// Usage: npm run wallets:import -- wallets.txt
// The running bot picks the new wallets up within a minute.

const ACTOR = 'script:import-wallets';

async function main(): Promise<void> {
  const file = process.argv[2];
  if (file === undefined) {
    console.error('Usage: npm run wallets:import -- <file>');
    process.exitCode = 1;
    return;
  }
  // npm runs scripts from the repo root; resolve the path from where the user typed it.
  const path = resolve(process.env.INIT_CWD ?? process.cwd(), file);
  const { entries, errors } = parseWalletList(await readFile(path, 'utf8'));
  for (const error of errors) {
    const why = error.reason === 'duplicate' ? 'duplicate address' : 'invalid address';
    console.warn(`Line ${error.line} skipped (${why}): ${error.text.slice(0, 80)}`);
  }
  if (entries.length === 0) {
    console.error('No valid wallet addresses found.');
    process.exitCode = 1;
    return;
  }

  loadRootEnvFile();
  const database = createDb(loadDatabaseConfig(process.env).databaseUrl.reveal());
  const counts: Record<AddWalletStatus, number> = { added: 0, reactivated: 0, already_active: 0 };
  try {
    for (const entry of entries) {
      const { status } = await addManualWallet(database.db, entry, { actor: ACTOR });
      counts[status]++;
      console.log(`${status.padEnd(14)} ${shortAddress(entry.address)} ${entry.label ?? ''}`);
    }
  } finally {
    await database.close();
  }
  console.log(
    `Done: ${counts.added} added, ${counts.reactivated} reactivated, ` +
      `${counts.already_active} already active, ${errors.length} skipped.`,
  );
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    // mysql2 and fs errors carry code/message, not the connection URI.
    const { code, message } = error as { code?: string; message?: string };
    console.error(`Import failed: ${code ?? ''} ${message ?? String(error)}`);
  }
  process.exitCode = 1;
});
