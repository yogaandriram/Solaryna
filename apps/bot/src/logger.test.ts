import { Secret } from '@solaryna/config';
import { describe, expect, it } from 'vitest';
import { createLogger, createSecretScrubber } from './logger';

const BOT_TOKEN = '123456789:AAH-fake-telegram-token';
const RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=fake-helius-key-0001';

function captureLogs() {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line) => lines.push(line) },
    secrets: [new Secret(BOT_TOKEN), new Secret(RPC_URL), new Secret('short')],
  });
  return { logger, output: () => lines.join('') };
}

describe('createLogger', () => {
  it('scrubs secret values embedded in error messages, stacks, and causes', () => {
    const { logger, output } = captureLogs();
    const error = new Error(`request to https://api.telegram.org/bot${BOT_TOKEN}/getMe failed`, {
      cause: new Error(`connect to ${RPC_URL} refused`),
    });
    logger.error({ err: error }, `Failed: ${BOT_TOKEN}`);
    expect(output()).not.toContain(BOT_TOKEN);
    expect(output()).not.toContain('fake-helius-key-0001');
    expect(output()).toContain('getMe failed');
  });

  it('keeps the error class name', () => {
    const { logger, output } = captureLogs();
    class HeliusApiError extends Error {
      override name = 'HeliusApiError';
    }
    logger.error({ err: new HeliusApiError('HTTP 401') }, 'failed');
    const line = JSON.parse(output()) as { err: { type: string; message: string } };
    expect(line.err).toMatchObject({ type: 'HeliusApiError', message: 'HTTP 401' });
  });

  it('scrubs secrets from free-form fields and leaves short values alone', () => {
    const { logger, output } = captureLogs();
    logger.info({ detail: { url: RPC_URL }, list: [`x ${BOT_TOKEN}`], note: 'short' });
    expect(output()).not.toContain('fake-helius-key-0001');
    expect(output()).not.toContain(BOT_TOKEN);
    expect(output()).toContain('"note":"short"');
  });

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

describe('createSecretScrubber', () => {
  it('removes secret values from text that leaves the process outside the logger', () => {
    const scrub = createSecretScrubber([new Secret('super-secret-key-123'), new Secret('')]);
    expect(scrub('GET https://x/?api-key=super-secret-key-123 failed')).toBe(
      'GET https://x/?api-key=[redacted] failed',
    );
    expect(scrub('nothing here')).toBe('nothing here');
  });
});
