import type { Decimal } from '@solaryna/core';
import { z } from 'zod';
import { botEnvSchema, databaseEnvShape, webEnvSchema } from './env';
import type { Secret } from './secret';
import type { TradingModeRequest } from './trading-mode';

export type EnvSource = Readonly<Record<string, string | undefined>>;
export type NodeEnv = 'development' | 'test' | 'production';

/** Thrown when the environment is invalid. The message lists keys and problems, never values. */
export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      [
        'Konfigurasi environment tidak valid:',
        ...issues.map((issue) => `  - ${issue}`),
        'Periksa file .env (lihat .env.example).',
      ].join('\n'),
    );
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

function parseEnv<T extends z.ZodType>(schema: T, env: EnvSource): z.output<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => {
        const key = issue.path.map(String).join('.') || '(env)';
        return `${key}: ${issue.message}`;
      }),
    );
  }
  return result.data;
}

export interface RiskLimits {
  maxSolPerTradeLamports: bigint;
  maxOpenPositions: number;
  dailyLossLimitLamports: bigint;
  minLiquidityUsd: Decimal;
  maxSlippageBps: number;
  maxPriorityFeeLamports: bigint;
  copyDelayMs: number;
  takeProfitPct: Decimal;
  stopLossPct: Decimal;
  maxHoldMinutes: number;
  /** Buy signals older than this (from the swap block time) are rejected. */
  maxSignalAgeSeconds: number;
}

export interface BotConfig {
  nodeEnv: NodeEnv;
  displayTimeZone: string;
  databaseUrl: Secret;
  ingest: {
    heliusApiKey: Secret;
    /** Helius RPC URL; the API key is in its query string. */
    solanaRpcUrl: Secret;
  } & (
    | {
        source: 'webhook';
        webhook: { id: string; secret: Secret; host: string; port: number };
      }
    | { source: 'websocket' }
  );
  birdeye: { apiKey: Secret };
  jupiter: { apiKey: Secret };
  telegram: { botToken: Secret; allowedChatIds: readonly number[] };
  trading: TradingModeRequest;
  risk: RiskLimits;
}

export interface WebConfig {
  nodeEnv: NodeEnv;
  displayTimeZone: string;
  databaseUrl: Secret;
  dashboardPassword: Secret;
  host: string;
  port: number;
  /** The .env risk limits: shown in the dashboard and used as ceilings for runtime overrides. */
  risk: RiskLimits;
}

type RiskEnv = Pick<
  z.output<typeof botEnvSchema>,
  | 'MAX_SOL_PER_TRADE'
  | 'MAX_OPEN_POSITIONS'
  | 'DAILY_LOSS_LIMIT_SOL'
  | 'MIN_LIQUIDITY_USD'
  | 'MAX_SLIPPAGE_BPS'
  | 'MAX_PRIORITY_FEE_LAMPORTS'
  | 'COPY_DELAY_MS'
  | 'TAKE_PROFIT_PCT'
  | 'STOP_LOSS_PCT'
  | 'MAX_HOLD_MINUTES'
  | 'MAX_SIGNAL_AGE_SECONDS'
>;

function riskLimits(e: RiskEnv): RiskLimits {
  return {
    maxSolPerTradeLamports: e.MAX_SOL_PER_TRADE,
    maxOpenPositions: e.MAX_OPEN_POSITIONS,
    dailyLossLimitLamports: e.DAILY_LOSS_LIMIT_SOL,
    minLiquidityUsd: e.MIN_LIQUIDITY_USD,
    maxSlippageBps: e.MAX_SLIPPAGE_BPS,
    maxPriorityFeeLamports: e.MAX_PRIORITY_FEE_LAMPORTS,
    copyDelayMs: e.COPY_DELAY_MS,
    takeProfitPct: e.TAKE_PROFIT_PCT,
    stopLossPct: e.STOP_LOSS_PCT,
    maxHoldMinutes: e.MAX_HOLD_MINUTES,
    maxSignalAgeSeconds: e.MAX_SIGNAL_AGE_SECONDS,
  };
}

export function loadBotConfig(env: EnvSource): BotConfig {
  const e = parseEnv(botEnvSchema, env);
  return {
    nodeEnv: e.NODE_ENV,
    displayTimeZone: e.TZ_DISPLAY,
    databaseUrl: e.DATABASE_URL,
    ingest: ingestConfig(e),
    birdeye: { apiKey: e.BIRDEYE_API_KEY },
    jupiter: { apiKey: e.JUPITER_API_KEY },
    telegram: { botToken: e.TELEGRAM_BOT_TOKEN, allowedChatIds: e.TELEGRAM_ALLOWED_CHAT_IDS },
    trading: {
      requestedMode: e.TRADING_MODE,
      liveAcknowledged: e.LIVE_TRADING_ACKNOWLEDGED,
      botWalletPrivateKey: e.BOT_WALLET_PRIVATE_KEY,
    },
    risk: riskLimits(e),
  };
}

function ingestConfig(e: z.output<typeof botEnvSchema>): BotConfig['ingest'] {
  const common = { heliusApiKey: e.HELIUS_API_KEY, solanaRpcUrl: e.SOLANA_RPC_URL };
  if (e.INGEST_SOURCE === 'websocket') {
    return { ...common, source: 'websocket' };
  }
  // Guaranteed by the schema refinements; checked again so the types follow.
  if (e.HELIUS_WEBHOOK_ID === null || e.HELIUS_WEBHOOK_SECRET === null) {
    throw new ConfigError(['HELIUS_WEBHOOK_ID/HELIUS_WEBHOOK_SECRET: wajib diisi']);
  }
  return {
    ...common,
    source: 'webhook',
    webhook: {
      id: e.HELIUS_WEBHOOK_ID,
      secret: e.HELIUS_WEBHOOK_SECRET,
      host: e.WEBHOOK_HOST,
      port: e.WEBHOOK_PORT,
    },
  };
}

export function loadWebConfig(env: EnvSource): WebConfig {
  const e = parseEnv(webEnvSchema, env);
  return {
    nodeEnv: e.NODE_ENV,
    displayTimeZone: e.TZ_DISPLAY,
    databaseUrl: e.DATABASE_URL,
    dashboardPassword: e.DASHBOARD_PASSWORD,
    host: e.DASHBOARD_HOST,
    port: e.DASHBOARD_PORT,
    risk: riskLimits(e),
  };
}

/** Only DATABASE_URL — for migrations and DB scripts that don't need the rest of the config. */
export function loadDatabaseConfig(env: EnvSource): { databaseUrl: Secret } {
  const e = parseEnv(z.object(databaseEnvShape), env);
  return { databaseUrl: e.DATABASE_URL };
}
