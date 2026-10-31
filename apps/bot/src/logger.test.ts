import { Secret } from '@solaryna/config';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger';

function captureLogs() {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line) => lines.push(line) },
  });
  return { logger, output: () => lines.join('') };
}

describe('createLogger', () => {
  it('redacts secret env keys at the top level and nested', () => {
    const { logger, output } = captureLogs();
    logger.info({
      HELIUS_API_KEY: 'leak-1',
      env: { BOT_WALLET_PRIVATE_KEY: 'leak-2', TELEGRAM_BOT_TOKEN: 'leak-3' },
      deep: { env: { JUPITER_API_KEY: 'leak-4' } },
    });
    expect(output()).not.toMatch(/leak-\d/);
    expect(output()).toContain('[redacted]');
  });

  it('redacts camelCase secret fields used in config objects and requests', () => {
    const { logger, output } = captureLogs();
    logger.info({
      jupiter: { apiKey: 'leak-5' },
      config: { telegram: { botToken: 'leak-6' } },
      req: { headers: { authorization: 'leak-7' } },
      privateKey: 'leak-8',
      ingest: { solanaRpcUrl: 'https://rpc.test/?api-key=leak-9' },
    });
    expect(output()).not.toMatch(/leak-\d/);
  });

  it('never prints Secret values even under non-secret field names', () => {
    const { logger, output } = captureLogs();
    logger.info({ harmlessLookingName: new Secret('leak-10') }, 'message');
    expect(output()).not.toContain('leak-10');
  });

  it('keeps non-secret fields', () => {
    const { logger, output } = captureLogs();
    logger.info({ mode: 'paper', wallet: 'So11111111111111111111111111111111111111112' });
    expect(output()).toContain('"mode":"paper"');
  });
});
