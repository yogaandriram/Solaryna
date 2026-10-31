/** Environment variables whose values must never appear in logs, Telegram, or the dashboard. */
export const SECRET_ENV_KEYS = [
  'DATABASE_URL',
  'HELIUS_API_KEY',
  'HELIUS_WEBHOOK_SECRET',
  'SOLANA_RPC_URL',
  'BIRDEYE_API_KEY',
  'JUPITER_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'DASHBOARD_PASSWORD',
  'BOT_WALLET_PRIVATE_KEY',
] as const;

const SECRET_FIELD_NAMES = [
  ...SECRET_ENV_KEYS,
  'apiKey',
  'botToken',
  'token',
  'secret',
  'webhookSecret',
  'password',
  'privateKey',
  'secretKey',
  'botWalletPrivateKey',
  'botWalletSecretKey',
  'authorization',
  'databaseUrl',
  'solanaRpcUrl',
  'rpcUrl',
];

/** pino `redact.paths`: each secret field at the top level and up to two levels deep. */
export const LOG_REDACT_PATHS: readonly string[] = SECRET_FIELD_NAMES.flatMap((name) => [
  name,
  `*.${name}`,
  `*.*.${name}`,
]);
