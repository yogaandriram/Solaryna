import { LOG_REDACT_PATHS } from '@solaryna/config';
import { pino, type DestinationStream, type Level, type Logger, type LoggerOptions } from 'pino';

export interface CreateLoggerOptions {
  level?: Level;
  /** Human-readable output for local development (pino-pretty, local time). */
  pretty?: boolean;
  /** Override the output stream (tests). */
  destination?: DestinationStream;
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const base: LoggerOptions = {
    level: options.level ?? 'info',
    redact: { paths: [...LOG_REDACT_PATHS], censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
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
