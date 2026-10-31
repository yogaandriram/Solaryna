import {
  ConfigError,
  loadBotConfig,
  loadRootEnvFile,
  resolveTradingMode,
  type BotConfig,
  type Secret,
} from '@solaryna/config';
import {
  addManualWallet,
  createDb,
  deactivateWallet,
  findToken,
  insertSwapEvent,
  listActiveWallets,
  upsertTokenMetadata,
} from '@solaryna/db';
import type { Logger } from 'pino';
import { createHeliusClient } from './helius/client';
import { WebhookConfigError, createHeliusWebhookTarget } from './helius/webhook-target';
import { createIngestor } from './ingest/ingestor';
import { LogsSubscriber, toWebSocketUrl } from './ingest/logs-subscriber';
import { createTransactionFetcher } from './ingest/transaction-fetcher';
import { HELIUS_WEBHOOK_PATH, buildWebhookServer } from './ingest/webhook-server';
import { createWalletSync, type SubscriptionTarget } from './jobs/wallet-sync';
import { createLogger } from './logger';
import { BOT_COMMANDS, createTelegramBot } from './telegram/bot';
import { formatStartupMessage, formatSwapAlert } from './telegram/format';
import { createTelegramNotifier } from './telegram/notifier';
import { createTokenInfoResolver } from './tokens/token-info';
import { WalletRegistry } from './wallets/registry';

// Becomes true in M5, once the Jupiter live executor exists and is tested with mocks.
const LIVE_EXECUTOR_AVAILABLE = false;
const DB_HEALTHCHECK_INTERVAL_MS = 60_000;

/** Every secret in the config, so the logger can scrub them from any log line. */
function configSecrets(config: BotConfig): Secret[] {
  const secrets = [
    config.databaseUrl,
    config.ingest.heliusApiKey,
    config.ingest.solanaRpcUrl,
    config.birdeye.apiKey,
    config.jupiter.apiKey,
    config.telegram.botToken,
  ];
  if (config.ingest.source === 'webhook') {
    secrets.push(config.ingest.webhook.secret);
  }
  if (config.trading.botWalletPrivateKey !== null) {
    secrets.push(config.trading.botWalletPrivateKey);
  }
  return secrets;
}

interface IngestSource {
  target: SubscriptionTarget;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Starts everything; returns a function that stops it again. */
async function run(config: BotConfig, logger: Logger): Promise<() => Promise<void>> {
  const trading = resolveTradingMode(config.trading, {
    liveExecutorAvailable: LIVE_EXECUTOR_AVAILABLE,
  });
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
  const { db } = database;
  await database.ping();

  const registry = new WalletRegistry(async () =>
    (await listActiveWallets(db)).map(({ id, address, label }) => ({ id, address, label })),
  );
  await registry.refresh();

  const helius = createHeliusClient({
    apiKey: config.ingest.heliusApiKey,
    rpcUrl: config.ingest.solanaRpcUrl,
  });
  const resolveTokenLabel = createTokenInfoResolver({
    findToken: async (mint) => {
      const row = await findToken(db, mint);
      return row && { symbol: row.symbol, name: row.name };
    },
    saveToken: (input) => upsertTokenMetadata(db, input),
    getAsset: (mint) => helius.getAsset(mint),
    logger,
  });

  const bot = createTelegramBot({
    token: config.telegram.botToken,
    allowedChatIds: config.telegram.allowedChatIds,
    commands: {
      addWallet: (input, actor) => addManualWallet(db, input, { actor }),
      removeWallet: (address, actor) => deactivateWallet(db, address, { actor }),
      listWallets: () => listActiveWallets(db),
      syncWallets: () => walletSync.syncNow(),
      logger,
    },
    logger,
  });
  const notifier = createTelegramNotifier({
    api: bot.api,
    chatIds: config.telegram.allowedChatIds,
    logger,
  });

  // Alerts go out in the order swaps were stored, even when a metadata lookup is slow.
  let alerts: Promise<void> = Promise.resolve();
  const ingest = createIngestor({
    registry,
    saveSwapEvent: (event, raw) => insertSwapEvent(db, event, raw),
    onNewSwap: (event, wallet) => {
      alerts = alerts
        .then(async () => {
          const token = await resolveTokenLabel(event.tokenMint, event.tokenDecimals);
          notifier.notify(
            formatSwapAlert({ event, wallet, token, timeZone: config.displayTimeZone }),
          );
        })
        .catch((error: unknown) => {
          logger.error({ err: error, signature: event.signature }, 'Swap alert failed');
        });
    },
    logger,
  });

  const source = createIngestSource(config, { helius, ingest, logger });
  const walletSync = createWalletSync({ registry, target: source.target, logger });

  await bot.init();
  // Fails startup if the Helius webhook is missing, not raw, or the API key is wrong.
  await walletSync.syncNow();
  await source.start();
  walletSync.start();

  await bot.api.setMyCommands(BOT_COMMANDS).catch((error: unknown) => {
    logger.warn({ err: error }, 'Could not register Telegram commands');
  });
  let stopping = false;
  bot
    .start({
      allowed_updates: ['message'],
      onStart: (info) => logger.info({ username: info.username }, 'Telegram bot polling'),
    })
    .catch((error: unknown) => {
      if (!stopping) {
        logger.error({ err: error }, 'Telegram polling stopped; commands are unavailable');
      }
    });

  const healthcheck = setInterval(() => {
    database.ping().catch((error: unknown) => {
      logger.error({ err: error }, 'Database healthcheck failed');
    });
  }, DB_HEALTHCHECK_INTERVAL_MS);

  logger.info(
    { mode: trading.mode, ingestSource: config.ingest.source, wallets: registry.size },
    'Solaryna bot started',
  );
  notifier.notify(
    formatStartupMessage({
      mode: trading.mode,
      fallbackReasons: trading.fallbackReasons,
      ingestSource: config.ingest.source,
      walletCount: registry.size,
    }),
  );

  return async () => {
    stopping = true;
    clearInterval(healthcheck);
    walletSync.stop();
    await source.stop();
    await alerts;
    notifier.notify('⏹ Solaryna berhenti.');
    await notifier.flush();
    await bot.stop();
    await database.close();
  };
}

function createIngestSource(
  config: BotConfig,
  deps: {
    helius: ReturnType<typeof createHeliusClient>;
    ingest: ReturnType<typeof createIngestor>;
    logger: Logger;
  },
): IngestSource {
  const { helius, ingest, logger } = deps;
  if (config.ingest.source === 'webhook') {
    const { webhook } = config.ingest;
    const server = buildWebhookServer({ secret: webhook.secret, logger, onTransactions: ingest });
    return {
      target: createHeliusWebhookTarget({
        helius,
        webhookId: webhook.id,
        secret: webhook.secret,
        logger,
      }),
      async start() {
        await server.listen({ host: webhook.host, port: webhook.port });
        logger.info(
          { url: `http://${webhook.host}:${webhook.port}${HELIUS_WEBHOOK_PATH}` },
          'Helius webhook receiver listening',
        );
      },
      stop: () => server.close(),
    };
  }

  const fetchTransaction = createTransactionFetcher({
    getTransaction: (signature) => helius.getTransaction(signature),
    onTransactions: ingest,
    logger,
  });
  const subscriber = new LogsSubscriber({
    url: toWebSocketUrl(config.ingest.solanaRpcUrl),
    logger,
    onSignature: (signature) => void fetchTransaction(signature),
  });
  return {
    target: {
      name: 'logs-subscriber',
      apply(addresses) {
        subscriber.setAddresses(addresses);
        return Promise.resolve();
      },
    },
    start() {
      subscriber.start();
      return Promise.resolve();
    },
    stop() {
      subscriber.stop();
      return Promise.resolve();
    },
  };
}

async function main(): Promise<void> {
  loadRootEnvFile();
  const config = loadBotConfig(process.env);
  // The key now lives only inside a Secret; keep it out of the environment of child processes.
  delete process.env.BOT_WALLET_PRIVATE_KEY;

  const isDev = config.nodeEnv === 'development';
  // From here on, errors go through the logger so secrets in them are scrubbed.
  const logger = createLogger({
    level: isDev ? 'debug' : 'info',
    pretty: isDev,
    secrets: configSecrets(config),
  });

  let stop: () => Promise<void>;
  try {
    stop = await run(config, logger);
  } catch (error) {
    if (error instanceof WebhookConfigError) {
      logger.fatal(error.message);
    } else {
      logger.fatal({ err: error }, 'Fatal error during startup');
    }
    process.exit(1);
  }

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    stop().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error({ err: error }, 'Error during shutdown');
        process.exit(1);
      },
    );
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  // Only config loading runs before the logger exists; ConfigError never contains values.
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
});
