import { describe, expect, it } from 'vitest';
import { ConfigError, loadBotConfig, loadDatabaseConfig, loadWebConfig } from './load';

const validBotEnv = {
  DATABASE_URL: 'mysql://root:@127.0.0.1:3306/solaryna',
  HELIUS_API_KEY: 'test-helius-key',
  HELIUS_WEBHOOK_SECRET: 'test-webhook-secret-123',
  HELIUS_WEBHOOK_ID: 'a1b2c3d4-0000-4000-8000-000000000000',
  SOLANA_RPC_URL: 'https://rpc.example.test/?api-key=test-rpc-key',
  BIRDEYE_API_KEY: 'test-birdeye-key',
  JUPITER_API_KEY: 'test-jupiter-key',
  TELEGRAM_BOT_TOKEN: 'test-telegram-token',
  TELEGRAM_ALLOWED_CHAT_IDS: '12345',
};

function configError(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected ConfigError');
}

describe('loadBotConfig', () => {
  it('applies the documented defaults', () => {
    const config = loadBotConfig(validBotEnv);

    expect(config.nodeEnv).toBe('development');
    expect(config.displayTimeZone).toBe('Asia/Jakarta');
    expect(config.ingest.source).toBe('webhook');
    expect(config.trading).toMatchObject({
      requestedMode: 'paper',
      liveAcknowledged: false,
      botWalletPrivateKey: null,
    });
    expect(config.risk.maxSolPerTradeLamports).toBe(50_000_000n);
    expect(config.risk.maxOpenPositions).toBe(5);
    expect(config.risk.dailyLossLimitLamports).toBe(200_000_000n);
    expect(config.risk.minLiquidityUsd.toString()).toBe('20000');
    expect(config.risk.maxSlippageBps).toBe(300);
    expect(config.risk.maxPriorityFeeLamports).toBe(200_000n);
    expect(config.risk.copyDelayMs).toBe(3000);
    expect(config.risk.takeProfitPct.toString()).toBe('100');
    expect(config.risk.stopLossPct.toString()).toBe('30');
    expect(config.risk.maxHoldMinutes).toBe(240);
  });

  it('defaults MAX_SIGNAL_AGE_SECONDS to 30 and rejects 0', () => {
    expect(loadBotConfig(validBotEnv).risk.maxSignalAgeSeconds).toBe(30);
    expect(loadBotConfig({ ...validBotEnv, MAX_SIGNAL_AGE_SECONDS: '90' }).risk).toMatchObject({
      maxSignalAgeSeconds: 90,
    });
    const error = configError(() => loadBotConfig({ ...validBotEnv, MAX_SIGNAL_AGE_SECONDS: '0' }));
    expect(error.issues.some((issue) => issue.startsWith('MAX_SIGNAL_AGE_SECONDS'))).toBe(true);
  });

  it('treats blank values as unset', () => {
    const config = loadBotConfig({ ...validBotEnv, TRADING_MODE: '   ', MAX_OPEN_POSITIONS: '' });
    expect(config.trading.requestedMode).toBe('paper');
    expect(config.risk.maxOpenPositions).toBe(5);
  });

  it('lists every missing required key', () => {
    const error = configError(() => loadBotConfig({}));
    const keys = error.issues.map((issue) => issue.split(':')[0]);
    expect(keys).toEqual(
      expect.arrayContaining([
        'DATABASE_URL',
        'HELIUS_API_KEY',
        'SOLANA_RPC_URL',
        'BIRDEYE_API_KEY',
        'JUPITER_API_KEY',
        'TELEGRAM_BOT_TOKEN',
        'TELEGRAM_ALLOWED_CHAT_IDS',
      ]),
    );
  });

  it('builds the webhook settings with defaults for host and port', () => {
    const { ingest } = loadBotConfig(validBotEnv);
    expect(ingest.source).toBe('webhook');
    if (ingest.source === 'webhook') {
      expect(ingest.webhook).toMatchObject({
        id: validBotEnv.HELIUS_WEBHOOK_ID,
        host: '127.0.0.1',
        port: 8787,
      });
      expect(ingest.webhook.secret.reveal()).toBe(validBotEnv.HELIUS_WEBHOOK_SECRET);
    }
  });

  it('requires the webhook secret and ID only for the webhook ingest source', () => {
    const withoutWebhook = { ...validBotEnv, HELIUS_WEBHOOK_SECRET: '', HELIUS_WEBHOOK_ID: '' };
    expect(configError(() => loadBotConfig(withoutWebhook)).issues).toEqual([
      'HELIUS_WEBHOOK_SECRET: wajib diisi jika INGEST_SOURCE=webhook',
      'HELIUS_WEBHOOK_ID: wajib diisi jika INGEST_SOURCE=webhook',
    ]);
    expect(loadBotConfig({ ...withoutWebhook, INGEST_SOURCE: 'websocket' }).ingest.source).toBe(
      'websocket',
    );
  });

  it('reports the missing webhook secret together with other problems', () => {
    const error = configError(() =>
      loadBotConfig({ ...validBotEnv, HELIUS_WEBHOOK_SECRET: '', JUPITER_API_KEY: '' }),
    );
    expect(error.issues).toEqual([
      'JUPITER_API_KEY: wajib diisi',
      'HELIUS_WEBHOOK_SECRET: wajib diisi jika INGEST_SOURCE=webhook',
    ]);
  });

  it('rejects short webhook secrets and unsafe webhook IDs', () => {
    expect(
      configError(() => loadBotConfig({ ...validBotEnv, HELIUS_WEBHOOK_SECRET: 'short' })).issues,
    ).toEqual(['HELIUS_WEBHOOK_SECRET: minimal 16 karakter']);
    expect(() => loadBotConfig({ ...validBotEnv, HELIUS_WEBHOOK_ID: '../../v0/x' })).toThrow(
      ConfigError,
    );
    expect(() => loadBotConfig({ ...validBotEnv, WEBHOOK_PORT: '70000' })).toThrow(ConfigError);
  });

  it('never includes secret values in errors', () => {
    const error = configError(() =>
      loadBotConfig({
        ...validBotEnv,
        DATABASE_URL: 'postgres://user:hunter2-db@host/db',
        SOLANA_RPC_URL: 'not a url hunter2-rpc',
        TRADING_MODE: 'hunter2-mode',
      }),
    );
    expect(error.issues).toHaveLength(3);
    expect(error.message).not.toMatch(/hunter2/);
  });

  it('never serializes secret values', () => {
    const serialized = JSON.stringify(loadBotConfig(validBotEnv), (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    for (const secret of Object.values(validBotEnv).filter((v) => v.startsWith('test-'))) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain('test-rpc-key');
  });

  it('converts SOL limits to lamports and rejects excess precision or zero', () => {
    expect(
      loadBotConfig({ ...validBotEnv, MAX_SOL_PER_TRADE: '0.000000001' }).risk
        .maxSolPerTradeLamports,
    ).toBe(1n);
    for (const bad of ['0', '0.0000000001', '-1', '1e-3', 'abc']) {
      expect(() => loadBotConfig({ ...validBotEnv, MAX_SOL_PER_TRADE: bad })).toThrow(ConfigError);
    }
  });

  it('validates integer ranges', () => {
    for (const [key, bad] of [
      ['MAX_OPEN_POSITIONS', '0'],
      ['MAX_OPEN_POSITIONS', '2.5'],
      ['MAX_SLIPPAGE_BPS', '10001'],
      ['COPY_DELAY_MS', '-1'],
      ['STOP_LOSS_PCT', '0'],
      ['STOP_LOSS_PCT', '101'],
      ['TAKE_PROFIT_PCT', '0'],
    ] as const) {
      expect(() => loadBotConfig({ ...validBotEnv, [key]: bad }), `${key}=${bad}`).toThrow(
        ConfigError,
      );
    }
  });

  it('parses the Telegram chat allowlist', () => {
    const config = loadBotConfig({
      ...validBotEnv,
      TELEGRAM_ALLOWED_CHAT_IDS: ' 12345, -1001234567890 ,12345,',
    });
    expect(config.telegram.allowedChatIds).toEqual([12345, -1001234567890]);
    expect(() => loadBotConfig({ ...validBotEnv, TELEGRAM_ALLOWED_CHAT_IDS: '123,abc' })).toThrow(
      ConfigError,
    );
    expect(() => loadBotConfig({ ...validBotEnv, TELEGRAM_ALLOWED_CHAT_IDS: ' , ' })).toThrow(
      ConfigError,
    );
  });

  it('accepts only the literal "true"/"false" for LIVE_TRADING_ACKNOWLEDGED', () => {
    expect(
      loadBotConfig({ ...validBotEnv, LIVE_TRADING_ACKNOWLEDGED: 'true' }).trading.liveAcknowledged,
    ).toBe(true);
    for (const bad of ['yes', '1', 'TRUE']) {
      expect(() => loadBotConfig({ ...validBotEnv, LIVE_TRADING_ACKNOWLEDGED: bad })).toThrow(
        ConfigError,
      );
    }
  });

  it('rejects unknown time zones and non-mysql database URLs', () => {
    expect(() => loadBotConfig({ ...validBotEnv, TZ_DISPLAY: 'Mars/Olympus' })).toThrow(
      ConfigError,
    );
    expect(() =>
      loadBotConfig({ ...validBotEnv, DATABASE_URL: 'mysql://root@127.0.0.1:3306/' }),
    ).toThrow(ConfigError);
  });
});

describe('loadWebConfig', () => {
  it('requires a dashboard password of at least 12 characters', () => {
    const base = { DATABASE_URL: validBotEnv.DATABASE_URL };
    expect(configError(() => loadWebConfig(base)).issues).toEqual([
      'DASHBOARD_PASSWORD: wajib diisi',
    ]);
    const error = configError(() => loadWebConfig({ ...base, DASHBOARD_PASSWORD: 'pw-hunter2' }));
    expect(error.message).not.toContain('pw-hunter2');
    expect(
      loadWebConfig({
        ...base,
        DASHBOARD_PASSWORD: 'long-enough-password',
      }).dashboardPassword.reveal(),
    ).toBe('long-enough-password');
  });
});

describe('loadDatabaseConfig', () => {
  it('needs only DATABASE_URL', () => {
    expect(
      loadDatabaseConfig({ DATABASE_URL: validBotEnv.DATABASE_URL }).databaseUrl.reveal(),
    ).toBe(validBotEnv.DATABASE_URL);
    expect(() => loadDatabaseConfig({})).toThrow(ConfigError);
  });
});
