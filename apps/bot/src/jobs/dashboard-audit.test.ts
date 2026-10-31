import type { AuditLogRow } from '@solaryna/db';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createDashboardAuditJob } from './dashboard-audit';

function row(id: number, action: string, details: unknown = null): AuditLogRow {
  return { id, actor: 'dashboard', action, details, createdAt: new Date(0) };
}

function setup(log: AuditLogRow[]) {
  const listAfter = vi.fn((afterId: number) =>
    Promise.resolve(log.filter((entry) => entry.id > afterId)),
  );
  const maxId = vi.fn(() =>
    Promise.resolve(log.reduce((max, entry) => Math.max(max, entry.id), 0)),
  );
  const notify = vi.fn<(html: string) => void>();
  const onLimitsChanged = vi.fn();
  const job = createDashboardAuditJob({
    source: { maxId, listAfter },
    notify,
    onLimitsChanged,
    logger: pino({ level: 'silent' }),
  });
  return { job, listAfter, notify, onLimitsChanged, log };
}

describe('createDashboardAuditJob', () => {
  it('starts after the existing entries and announces new ones once, in order', async () => {
    const { job, notify, onLimitsChanged, log } = setup([row(1, 'trading.pause')]);
    await job.tick();
    expect(notify).not.toHaveBeenCalled();

    log.push(row(2, 'trading.resume'), row(3, 'limits.update', { changes: {} }), row(4, 'x.y'));
    log.push(row(5, 'limits.update', { changes: { maxOpenPositions: { from: null, to: '2' } } }));
    await job.tick();
    expect(notify.mock.calls.map((call) => call[0].split('\n')[0])).toEqual([
      '▶️ Trading dilanjutkan dari dashboard.',
      '⚙️ Batas risiko diubah dari dashboard:',
    ]);
    expect(onLimitsChanged).toHaveBeenCalled();

    await job.tick();
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('keeps its cursor when reading fails and retries on the next tick', async () => {
    const { job, listAfter, notify, log } = setup([]);
    await job.tick();
    log.push(row(1, 'trading.pause'));
    listAfter.mockRejectedValueOnce(new Error('db down'));
    await job.tick();
    expect(notify).not.toHaveBeenCalled();
    await job.tick();
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
