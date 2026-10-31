import { ConfigError, loadBotConfig, loadRootEnvFile, resolveTradingMode } from '@solaryna/config';
import { createDb } from '@solaryna/db';
import { createLogger } from './logger';

// Becomes true in M5, once the Jupiter live executor exists and is tested with mocks.
const LIVE_EXECUTOR_AVAILABLE = false;
const DB_HEALTHCHECK_INTERVAL_MS = 60_000;

async function main(): Promise<void> {
  loadRootEnvFile();
  const config = loadBotConfig(process.env);
  // The key now lives only inside a Secret; keep it out of the environment of child processes.
  delete process.env.BOT_WALLET_PRIVATE_KEY;

  const isDev = config.nodeEnv === 'development';
  const logger = createLogger({ level: isDev ? 'debug' : 'info', pretty: isDev });

  const trading = resolveTradingMode(config.trading, {
    liveExecutorAvailable: LIVE_EXECUTOR_AVAILABLE,
  });
  // TODO(M1): announce the fallback over Telegram as well.
  if (trading.fallbackReasons.length > 0) {
    logger.warn(
      { reasons: trading.fallbackReasons },
      'Live trading requested but not activated; running in paper mode',
    );
  }
  if (trading.mode === 'live') {
    logger.warn('LIVE TRADING ACTIVE: use a dedicated hot wallet holding only small capital');
  }

  const database = createDb(config.databaseUrl.reveal());
  await database.ping();
  logger.info({ mode: trading.mode, ingestSource: config.ingest.source }, 'Solaryna bot started');

  const healthcheck = setInterval(() => {
    database.ping().catch((error: unknown) => {
      logger.error({ err: error }, 'Database healthcheck failed');
    });
  }, DB_HEALTHCHECK_INTERVAL_MS);

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    clearInterval(healthcheck);
    database.close().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error({ err: error }, 'Error while closing the database pool');
        process.exit(1);
      },
    );
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    console.error('Fatal error during startup:', error);
  }
  process.exit(1);
});
