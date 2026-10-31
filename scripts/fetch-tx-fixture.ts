import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { rawTransactionSchema } from '@solaryna/core';

// Saves a real mainnet transaction as a parser test fixture (packages/core/test/fixtures).
// Usage: npm run fixture:fetch -- <signature> <name> [--force]
// Uses the public mainnet RPC (rate limited) unless FIXTURE_RPC_URL is set. Transactions are
// public data; never put anything else in a fixture.

const PUBLIC_RPC_URL = 'https://api.mainnet-beta.solana.com';
const FIXTURE_DIR = new URL('../packages/core/test/fixtures/', import.meta.url);

async function main(): Promise<void> {
  const [signature, name] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const force = process.argv.includes('--force');
  if (signature === undefined || name === undefined || !/^[a-z0-9-]+$/.test(name)) {
    console.error('Usage: npm run fixture:fetch -- <signature> <name-in-kebab-case> [--force]');
    process.exitCode = 1;
    return;
  }
  const target = new URL(`${name}.json`, FIXTURE_DIR);
  if (existsSync(target) && !force) {
    console.error(`Fixture ${name}.json already exists; pass --force to overwrite.`);
    process.exitCode = 1;
    return;
  }

  // FIXTURE_RPC_URL may contain an API key: it is never printed.
  const response = await fetch(process.env.FIXTURE_RPC_URL ?? PUBLIC_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: [
        signature,
        { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`RPC request failed with HTTP ${response.status}`);
  }
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error !== undefined) {
    throw new Error(`RPC error: ${body.error.message ?? 'unknown'}`);
  }
  if (body.result === null || body.result === undefined) {
    throw new Error('Transaction not found (not confirmed yet, or pruned by this RPC).');
  }
  const parsed = rawTransactionSchema.safeParse(body.result);
  if (!parsed.success) {
    throw new Error(`Transaction does not match rawTransactionSchema: ${parsed.error.message}`);
  }
  await writeFile(target, JSON.stringify(body.result));
  console.log(
    `Saved packages/core/test/fixtures/${name}.json (version ${String(parsed.data.version)}).`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
