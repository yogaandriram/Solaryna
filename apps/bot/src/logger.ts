import { LOG_REDACT_PATHS, Secret } from '@solaryna/config';
import { pino, type DestinationStream, type Level, type Logger, type LoggerOptions } from 'pino';

export interface CreateLoggerOptions {
  level?: Level;
  /** Human-readable output for local development (pino-pretty, local time). */
  pretty?: boolean;
  /** Override the output stream (tests). */
  destination?: DestinationStream;
  /**
   * Secret values to scrub from every log line wherever they appear — including inside error
   * messages from HTTP clients that embed request URLs (Telegram bot token, RPC API key).
   */
  secrets?: readonly Secret[];
}

const REDACTED = '[redacted]';
// Shorter values (e.g. an empty DB password) would scrub unrelated text.
const MIN_SCRUB_LENGTH = 8;

/** Replaces secret values in text; for text that leaves the process without the logger. */
export function createSecretScrubber(secrets: readonly Secret[]): (text: string) => string {
  const values = [...new Set(secrets.map((secret) => secret.reveal()))]
    .filter((value) => value.length >= MIN_SCRUB_LENGTH)
    .sort((a, b) => b.length - a.length);
  return (text) => values.reduce((result, value) => result.replaceAll(value, REDACTED), text);
}

function scrubDeep(
  value: unknown,
  scrub: (text: string) => string,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === 'string') {
    return scrub(value);
  }
  if (typeof value !== 'object' || value === null || value instanceof Secret || seen.has(value)) {
    return value;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => scrubDeep(item, scrub, seen));
  }
  if (value instanceof Error) {
    // Message, stack, and cause are not enumerable; copy them explicitly.
    return {
      type: value.name,
      message: scrub(value.message),
      stack: value.stack === undefined ? undefined : scrub(value.stack),
      ...(scrubDeep({ ...value }, scrub, seen) as object),
      cause: scrubDeep(value.cause, scrub, seen),
    };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, scrubDeep(item, scrub, seen)]),
  );
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const scrub = createSecretScrubber(options.secrets ?? []);
  const base: LoggerOptions = {
    level: options.level ?? 'info',
    redact: { paths: [...LOG_REDACT_PATHS], censor: REDACTED },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      log: (object) => scrubDeep(object, scrub, new WeakSet()) as Record<string, unknown>,
    },
    // scrubDeep has already turned errors into plain objects (with cause); pino's default err
    // serializer would run afterwards and report every error's type as "Object".
    serializers: { err: (value: unknown) => value },
    hooks: {
      logMethod(args, method) {
        const scrubbed = args.map((arg: unknown) => (typeof arg === 'string' ? scrub(arg) : arg));
        method.apply(this, scrubbed as Parameters<typeof method>);
      },
    },
  };
  if (options.destination) {
    return pino(base, options.destination);
  }
  if (options.pretty) {
    return pino({
      ...base,
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l', ignore: 'pid,hostname' },
      },
    });
  }
  return pino(base);
}
