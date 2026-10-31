import type { AuditLogRow } from '@solaryna/db';
import { describe, expect, it } from 'vitest';
import { describeAuditEntry } from './audit';

const ADDRESS = 'J8M2wM8vtBLZJfajpczrjbs78PWhW1sqVFVJdE5d43jX';

function entry(action: string, details: unknown = null, actor = 'dashboard'): AuditLogRow {
  return { id: 1, actor, action, details, createdAt: new Date(0) };
}

describe('describeAuditEntry', () => {
  it('names the actor', () => {
    expect(describeAuditEntry(entry('trading.pause', null, 'dashboard')).actorLabel).toBe(
      'Dashboard',
    );
    expect(describeAuditEntry(entry('trading.pause', null, 'telegram:111:7')).actorLabel).toBe(
      'Telegram',
    );
    expect(describeAuditEntry(entry('wallet.add', null, 'script:import-wallets')).actorLabel).toBe(
      'Skrip',
    );
    expect(describeAuditEntry(entry('trading.pause', null, 'manual')).actorLabel).toBe('manual');
  });

  it('describes pause and resume', () => {
    expect(describeAuditEntry(entry('trading.pause')).text).toBe('Trading dijeda');
    expect(describeAuditEntry(entry('trading.resume')).text).toBe('Trading dilanjutkan');
  });

  it('lists limit changes, with null as "ikut .env"', () => {
    const details = {
      changes: {
        maxSolPerTradeLamports: { from: null, to: '30000000' },
        stopLossPct: { from: '20', to: null },
      },
    };
    expect(describeAuditEntry(entry('limits.update', details)).text).toBe(
      'Batas risiko diubah: Maks SOL per trade ikut .env → 0,03 SOL; Stop-loss 20% → ikut .env',
    );
  });

  it('describes wallet changes with label and short address', () => {
    expect(
      describeAuditEntry(entry('wallet.add', { address: ADDRESS, label: 'alpha', status: 'added' }))
        .text,
    ).toBe('Wallet ditambahkan: alpha (J8M2…43jX)');
    expect(
      describeAuditEntry(
        entry('wallet.add', { address: ADDRESS, label: null, status: 'reactivated' }),
      ).text,
    ).toBe('Wallet diaktifkan kembali: J8M2…43jX');
    expect(
      describeAuditEntry(entry('wallet.remove', { address: ADDRESS, status: 'deactivated' })).text,
    ).toBe('Wallet berhenti dipantau: J8M2…43jX');
  });

  it('falls back to the action name for unknown actions or malformed details', () => {
    expect(describeAuditEntry(entry('report.sent')).text).toBe('report.sent');
    expect(describeAuditEntry(entry('wallet.add', { label: 'no address' })).text).toBe(
      'wallet.add',
    );
    expect(describeAuditEntry(entry('limits.update', { changes: 'bad' })).text).toBe(
      'limits.update',
    );
  });
});
