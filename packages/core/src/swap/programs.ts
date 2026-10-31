import type { SwapSource } from '../types';

// Verified on mainnet (executable, recent swap activity) on 2026-10-31.
export const SWAP_PROGRAMS: Readonly<Record<string, Exclude<SwapSource, 'unknown'>>> = {
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: 'jupiter', // Jupiter Aggregator v6
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'pumpfun', // Pump.fun bonding curve
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: 'pumpswap', // Pump.fun AMM
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'raydium', // Raydium AMM v4
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: 'raydium', // Raydium CPMM
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: 'raydium', // Raydium CLMM
  LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj: 'raydium', // Raydium LaunchLab
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: 'meteora', // Meteora DLMM
  Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB: 'meteora', // Meteora DAMM v1
  cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG: 'meteora', // Meteora DAMM v2
  dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN: 'meteora', // Meteora Dynamic Bonding Curve
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: 'orca', // Orca Whirlpool
};

/** When several are invoked (aggregator routes), the earliest in this list wins. */
const SOURCE_PRIORITY: readonly SwapSource[] = [
  'jupiter',
  'pumpfun',
  'pumpswap',
  'raydium',
  'meteora',
  'orca',
];

export function detectSwapSource(programIds: Iterable<string>): SwapSource {
  const sources = new Set<SwapSource>();
  for (const programId of programIds) {
    const source = SWAP_PROGRAMS[programId];
    if (source) {
      sources.add(source);
    }
  }
  return SOURCE_PRIORITY.find((source) => sources.has(source)) ?? 'unknown';
}
