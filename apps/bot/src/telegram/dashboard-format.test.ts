import type { AuditLogRow } from '@solaryna/db';
import { describe, expect, it } from 'vitest';
import { formatDashboardAction } from './dashboard-format';

const ADDRESS = 'J8M2wM8vtBLZJfajpczrjbs78PWhW1sqVFVJdE5d43jX';

function entry(action: string, details: unknown = null): AuditLogRow {
  return { id: 1, actor: 'dashboard', action, details, createdAt: new Date(0) };
}

describe('formatDashboardAction', () => {
  it('announces pause and resume', () => {
    expect(formatDashboardAction(entry('trading.pause'))).toBe(
      '⏸ Trading dijeda dari dashboard. Sinyal baru dan exit otomatis menunggu dilanjutkan.',
    );
    expect(formatDashboardAction(entry('trading.resume'))).toBe(
      '▶️ Trading dilanjutkan dari dashboard.',
    );
  });

  it('lists changed risk limits with their units', () => {
    expect(
      formatDashboardAction(
        entry('limits.update', {
          changes: {
            maxOpenPositions: { from: null, to: '3' },
            maxSolPerTradeLamports: { from: '30000000', to: null },
            bogus: { from: null, to: '<b>' },
          },
        }),
      ),
    ).toBe(
      [
        '⚙️ Batas risiko diubah dari dashboard:',
        '• Maks posisi terbuka: ikut .env → 3',
        '• Maks SOL per trade: 0,03 SOL → ikut .env',
        '• bogus: ikut .env → &lt;b&gt;',
      ].join('\n'),
    );
  });

  it('announces wallet changes with escaped labels', () => {
    expect(
      formatDashboardAction(
        entry('wallet.add', { address: ADDRESS, label: '<i>alpha</i>', status: 'added' }),
      ),
    ).toBe(
      '👛 Wallet ditambahkan dari dashboard: <b>&lt;i&gt;alpha&lt;/i&gt;</b> <code>J8M2…43jX</code>',
    );
    expect(
      formatDashboardAction(
        entry('wallet.add', { address: ADDRESS, label: null, status: 'reactivated' }),
      ),
    ).toBe('👛 Wallet diaktifkan kembali dari dashboard: <code>J8M2…43jX</code>');
    expect(formatDashboardAction(entry('wallet.remove', { address: ADDRESS }))).toBe(
      '👛 Wallet berhenti dipantau dari dashboard: <code>J8M2…43jX</code>',
    );
  });

  it('ignores other actions and malformed details', () => {
    expect(formatDashboardAction(entry('settings.test'))).toBeNull();
    expect(formatDashboardAction(entry('wallet.add', 'oops'))).toBeNull();
    expect(formatDashboardAction(entry('limits.update', { changes: [] }))).toBeNull();
  });
});
