import type { AuditLogRow } from '@solaryna/db';
import type { Logger } from 'pino';
import { formatDashboardAction } from '../telegram/dashboard-format';

export const DASHBOARD_AUDIT_INTERVAL_MS = 15_000;

export interface DashboardAuditSource {
  maxId(): Promise<number>;
  /** Dashboard entries with an id above `afterId`, oldest first. */
  listAfter(afterId: number): Promise<AuditLogRow[]>;
}

/**
 * Announces dashboard actions (pause/resume, limit and wallet changes) in Telegram by polling
 * audit_log. The cursor starts at the newest entry, so a restart never replays old actions; it
 * only advances past entries that were handled.
 */
export function createDashboardAuditJob(options: {
  source: DashboardAuditSource;
  notify(html: string): void;
  /** Called after a limit change, so the bot picks it up without waiting for its own poll. */
  onLimitsChanged(): void;
  logger: Logger;
  intervalMs?: number;
}) {
  const { source, logger } = options;
  let cursor: number | null = null;
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function run(): Promise<void> {
    if (cursor === null) {
      cursor = await source.maxId();
      return;
    }
    for (const entry of await source.listAfter(cursor)) {
      const html = formatDashboardAction(entry);
      if (html !== null) {
        options.notify(html);
      }
      if (entry.action === 'limits.update') {
        options.onLimitsChanged();
      }
      cursor = entry.id;
    }
  }

  function tick(): Promise<void> {
    running ??= run()
      .catch((error: unknown) => {
        logger.warn({ err: error }, 'Reading dashboard actions failed');
      })
      .finally(() => {
        running = null;
      });
    return running;
  }

  return {
    tick,
    start(): void {
      timer ??= setInterval(() => void tick(), options.intervalMs ?? DASHBOARD_AUDIT_INTERVAL_MS);
    },
    async stop(): Promise<void> {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      await running;
    },
  };
}
