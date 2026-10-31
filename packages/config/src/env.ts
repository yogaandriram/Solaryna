import { Decimal, SOL_DECIMALS, TRADING_MODES, parseUnits } from '@solaryna/core';
import { z } from 'zod';
import { Secret } from './secret';

// Validation messages are shown to the user at startup, so they are in Indonesian.
// They must never include the offending value: several of these variables are secrets.

const REQUIRED = 'wajib diisi';

/** Treats unset and blank values the same, then falls back to `defaultValue` (if any). */
function env<T extends z.ZodType>(schema: T, defaultValue?: string) {
  return z.preprocess((value) => {
    const trimmed = typeof value === 'string' ? value.trim() : value;
    return trimmed === undefined || trimmed === '' ? defaultValue : trimmed;
  }, schema);
}

const toSecret = (value: string) => new Secret(value);

function requiredSecret() {
  return env(z.string({ error: REQUIRED }).transform(toSecret));
}

function optionalSecret() {
  return env(
    z
      .string()
      .optional()
      .transform((value) => (value === undefined ? null : new Secret(value))),
  );
}

function isUrlWithProtocol(value: string, protocols: readonly string[]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const httpUrl = z
  .string({ error: REQUIRED })
  .refine((value) => isUrlWithProtocol(value, ['http:', 'https:']), {
    error: 'harus berupa URL http(s) yang valid',
  });

const mysqlUrl = z
  .string({ error: REQUIRED })
  .refine((value) => isUrlWithProtocol(value, ['mysql:']), {
    error: 'harus berupa URL mysql://user:password@host:port/database',
  })
  .refine((value) => /^\/[A-Za-z0-9_]+$/.test(new URL(value).pathname), {
    error: 'nama database harus ada dan hanya berisi huruf, angka, atau _',
  });

const timeZone = z.string({ error: REQUIRED }).refine(
  (value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  },
  { error: 'zona waktu IANA tidak dikenal (contoh: Asia/Jakarta)' },
);

function integer(min: number, max: number) {
  return z
    .string({ error: REQUIRED })
    .regex(/^-?\d+$/, { error: 'harus bilangan bulat' })
    .transform(Number)
    .refine((value) => value >= min && value <= max, {
      error: `harus di antara ${min} dan ${max}`,
    });
}

function solAmount() {
  return z
    .string({ error: REQUIRED })
    .regex(/^\d+(\.\d{1,9})?$/, { error: 'harus jumlah SOL dengan maksimal 9 angka desimal' })
    .transform((value) => parseUnits(value, SOL_DECIMALS))
    .refine((lamports) => lamports > 0n, { error: 'harus lebih dari 0' });
}

function lamports() {
  return z
    .string({ error: REQUIRED })
    .regex(/^\d+$/, { error: 'harus bilangan bulat lamports (>= 0)' })
    .transform((value) => BigInt(value));
}

function decimalInRange(options: { min: string; max?: string; minExclusive?: boolean }) {
  const range = `${options.minExclusive ? '>' : '>='} ${options.min}${options.max ? ` dan <= ${options.max}` : ''}`;
  return z
    .string({ error: REQUIRED })
    .regex(/^\d+(\.\d+)?$/, { error: 'harus angka desimal (contoh: 12.5)' })
    .transform((value) => new Decimal(value))
    .refine(
      (value) =>
        (options.minExclusive ? value.gt(options.min) : value.gte(options.min)) &&
        (options.max === undefined || value.lte(options.max)),
      { error: `harus ${range}` },
    );
}

const telegramChatIds = z
  .string({ error: REQUIRED })
  .transform((value) =>
    value
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== ''),
  )
  .pipe(
    z
      .array(z.string().regex(/^-?\d+$/, { error: 'chat id harus bilangan bulat' }))
      .min(1, { error: 'minimal satu chat id' }),
  )
  .transform((ids) => [...new Set(ids.map(Number))])
  .refine((ids) => ids.every((id) => Number.isSafeInteger(id)), {
    error: 'chat id di luar jangkauan',
  });

const booleanFlag = z
  .enum(['true', 'false'], { error: 'harus "true" atau "false"' })
  .transform((value) => value === 'true');

export const databaseEnvShape = {
  DATABASE_URL: env(mysqlUrl.transform(toSecret)),
};

const commonEnvShape = {
  NODE_ENV: env(
    z.enum(['development', 'test', 'production'], {
      error: 'harus development, test, atau production',
    }),
    'development',
  ),
  TZ_DISPLAY: env(timeZone, 'Asia/Jakarta'),
  ...databaseEnvShape,
};

export const botEnvSchema = z
  .object({
    ...commonEnvShape,

    HELIUS_API_KEY: requiredSecret(),
    HELIUS_WEBHOOK_SECRET: env(
      z
        .string()
        .min(16, { error: 'minimal 16 karakter' })
        .optional()
        .transform((value) => (value === undefined ? null : new Secret(value))),
    ),
    // Created by the user in the Helius dashboard (type "raw"); the bot only syncs its addresses.
    HELIUS_WEBHOOK_ID: env(
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,64}$/, { error: 'format webhook ID tidak valid' })
        .optional()
        .transform((value) => value ?? null),
    ),
    WEBHOOK_HOST: env(
      z.string().regex(/^[A-Za-z0-9.:-]+$/, { error: 'harus hostname atau alamat IP' }),
      '127.0.0.1',
    ),
    WEBHOOK_PORT: env(integer(1, 65_535), '8787'),
    // Helius RPC URLs carry the API key in the query string, so the URL itself is a secret.
    SOLANA_RPC_URL: env(httpUrl.transform(toSecret)),
    INGEST_SOURCE: env(
      z.enum(['webhook', 'websocket'], { error: 'harus webhook atau websocket' }),
      'webhook',
    ),
    BIRDEYE_API_KEY: requiredSecret(),

    JUPITER_API_KEY: requiredSecret(),

    TELEGRAM_BOT_TOKEN: requiredSecret(),
    TELEGRAM_ALLOWED_CHAT_IDS: env(telegramChatIds),

    TRADING_MODE: env(z.enum(TRADING_MODES, { error: 'harus paper atau live' }), 'paper'),
    LIVE_TRADING_ACKNOWLEDGED: env(booleanFlag, 'false'),
    BOT_WALLET_PRIVATE_KEY: optionalSecret(),

    MAX_SOL_PER_TRADE: env(solAmount(), '0.05'),
    MAX_OPEN_POSITIONS: env(integer(1, 100), '5'),
    DAILY_LOSS_LIMIT_SOL: env(solAmount(), '0.2'),
    MIN_LIQUIDITY_USD: env(decimalInRange({ min: '0' }), '20000'),
    MAX_SLIPPAGE_BPS: env(integer(1, 10_000), '300'),
    MAX_PRIORITY_FEE_LAMPORTS: env(lamports(), '200000'),
    COPY_DELAY_MS: env(integer(0, 600_000), '3000'),
    TAKE_PROFIT_PCT: env(decimalInRange({ min: '0', minExclusive: true }), '100'),
    STOP_LOSS_PCT: env(decimalInRange({ min: '0', max: '100', minExclusive: true }), '30'),
    MAX_HOLD_MINUTES: env(integer(1, 43_200), '240'),
    MAX_SIGNAL_AGE_SECONDS: env(integer(1, 3600), '30'),
  })
  .refine(
    (parsed) => parsed.INGEST_SOURCE !== 'webhook' || parsed.HELIUS_WEBHOOK_SECRET !== null,
    requiredForWebhook('HELIUS_WEBHOOK_SECRET'),
  )
  .refine(
    (parsed) => parsed.INGEST_SOURCE !== 'webhook' || parsed.HELIUS_WEBHOOK_ID !== null,
    requiredForWebhook('HELIUS_WEBHOOK_ID'),
  );

function requiredForWebhook(key: string) {
  return {
    path: [key],
    error: 'wajib diisi jika INGEST_SOURCE=webhook',
    // Run even when unrelated keys are invalid, so every problem is reported in one go.
    when: (payload: { issues: readonly { path?: readonly PropertyKey[] }[] }) =>
      payload.issues.every((issue) => !['INGEST_SOURCE', key].includes(String(issue.path?.[0]))),
  };
}

export const webEnvSchema = z.object({
  ...commonEnvShape,
  DASHBOARD_PASSWORD: env(
    z.string({ error: REQUIRED }).min(12, { error: 'minimal 12 karakter' }).transform(toSecret),
  ),
});
