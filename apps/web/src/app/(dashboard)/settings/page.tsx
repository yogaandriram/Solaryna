import { formatAmount, SOL_DECIMALS } from '@solaryna/core';
import { getRiskLimitOverrides, isTradingPaused, listRecentAuditLog } from '@solaryna/db';
import type { Metadata } from 'next';
import { Card } from '../../../components/card';
import { EmptyState } from '../../../components/empty-state';
import { LimitsForm } from '../../../components/limits-form';
import { PageHeading } from '../../../components/page-heading';
import { PauseToggle } from '../../../components/pause-toggle';
import { TD, TH } from '../../../components/position-tables';
import { describeAuditEntry } from '../../../lib/audit';
import { formatDateTime } from '../../../lib/format';
import { limitRows } from '../../../lib/limits-form';
import { requireSession } from '../../../server/auth/session';
import { getWebConfig } from '../../../server/config';
import { getDb } from '../../../server/db';

export const metadata: Metadata = { title: 'Pengaturan · Solaryna' };

const AUDIT_LIMIT = 30;

export default async function SettingsPage() {
  await requireSession();
  const db = getDb();
  const config = getWebConfig();
  const timeZone = config.displayTimeZone;
  const [paused, storedLimits, audit] = await Promise.all([
    isTradingPaused(db),
    getRiskLimitOverrides(db),
    listRecentAuditLog(db, AUDIT_LIMIT),
  ]);
  const rows = limitRows(config.risk, storedLimits);
  const copyDelaySeconds = formatAmount(BigInt(config.risk.copyDelayMs), 3, 3);

  return (
    <div className="space-y-6">
      <PageHeading title="Pengaturan" />

      <Card title="Kill switch" aside="Berlaku untuk paper dan live">
        <PauseToggle paused={paused} />
      </Card>

      <Card
        title="Batas risiko"
        aside="Hanya bisa dibuat lebih ketat dari .env; untuk melonggarkan, ubah .env lalu restart bot"
      >
        <LimitsForm rows={rows} />
      </Card>

      <Card title="Hanya lewat .env">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Jeda copy yang disimulasikan (COPY_DELAY_MS)</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{copyDelaySeconds} detik</dd>
          </div>
          <div>
            <dt className="text-muted">Maks priority fee (MAX_PRIORITY_FEE_LAMPORTS)</dt>
            <dd className="mt-0.5 font-medium tabular-nums">
              {formatAmount(config.risk.maxPriorityFeeLamports, SOL_DECIMALS, SOL_DECIMALS)} SOL
            </dd>
          </div>
        </dl>
        <p className="mt-4 rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm">
          Mode live hanya bisa diaktifkan lewat .env lalu restart bot. Dashboard tidak bisa
          mengaktifkannya.
        </p>
      </Card>

      <Card title="Riwayat perubahan" aside={`${AUDIT_LIMIT} perubahan terakhir`}>
        {audit.length === 0 ? (
          <EmptyState>Belum ada perubahan tercatat.</EmptyState>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className={TH}>Waktu</th>
                  <th className={TH}>Oleh</th>
                  <th className={TH}>Perubahan</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((entry) => {
                  const { actorLabel, text } = describeAuditEntry(entry);
                  return (
                    <tr key={entry.id} className="border-t border-line align-top">
                      <td className={`${TD} whitespace-nowrap text-muted tabular-nums`}>
                        {formatDateTime(entry.createdAt, timeZone)}
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>{actorLabel}</td>
                      <td className={`${TD} min-w-64`}>{text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
