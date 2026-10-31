import {
  RUNTIME_LIMIT_KEYS,
  RUNTIME_LIMIT_LABELS,
  formatRuntimeLimit,
  shortAddress,
  type RuntimeLimitKey,
} from '@solaryna/core';
import type { AuditLogRow } from '@solaryna/db';

// One line per audit_log entry on Pengaturan. Details are read defensively: anything malformed
// falls back to the raw action name. React escapes the text, so nothing here builds HTML.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRuntimeLimitKey = (key: string): key is RuntimeLimitKey =>
  (RUNTIME_LIMIT_KEYS as readonly string[]).includes(key);

function actorLabel(actor: string): string {
  if (actor === 'dashboard') {
    return 'Dashboard';
  }
  if (actor.startsWith('telegram:')) {
    return 'Telegram';
  }
  if (actor.startsWith('script:')) {
    return 'Skrip';
  }
  return actor;
}

function limitValue(key: string, value: unknown): string {
  if (typeof value !== 'string') {
    return 'ikut .env';
  }
  return isRuntimeLimitKey(key) ? formatRuntimeLimit(key, value) : value;
}

function limitChanges(details: unknown): string | null {
  if (!isRecord(details) || !isRecord(details.changes)) {
    return null;
  }
  const parts = Object.entries(details.changes).flatMap(([key, change]) => {
    if (!isRecord(change)) {
      return [];
    }
    const label = isRuntimeLimitKey(key) ? RUNTIME_LIMIT_LABELS[key] : key;
    return [`${label} ${limitValue(key, change.from)} → ${limitValue(key, change.to)}`];
  });
  return parts.length === 0 ? null : `Batas risiko diubah: ${parts.join('; ')}`;
}

function walletText(details: unknown): string | null {
  if (!isRecord(details) || typeof details.address !== 'string') {
    return null;
  }
  const short = shortAddress(details.address);
  return typeof details.label === 'string' ? `${details.label} (${short})` : short;
}

const WALLET_ADD_VERBS: Record<string, string> = {
  added: 'Wallet ditambahkan',
  reactivated: 'Wallet diaktifkan kembali',
  already_active: 'Wallet sudah dipantau',
};

function describeAction(entry: AuditLogRow): string | null {
  switch (entry.action) {
    case 'trading.pause':
      return 'Trading dijeda';
    case 'trading.resume':
      return 'Trading dilanjutkan';
    case 'limits.update':
      return limitChanges(entry.details);
    case 'wallet.add': {
      const wallet = walletText(entry.details);
      const status = isRecord(entry.details) ? entry.details.status : undefined;
      const verb = (typeof status === 'string' && WALLET_ADD_VERBS[status]) || 'Wallet ditambahkan';
      return wallet === null ? null : `${verb}: ${wallet}`;
    }
    case 'wallet.remove': {
      const wallet = walletText(entry.details);
      return wallet === null ? null : `Wallet berhenti dipantau: ${wallet}`;
    }
    default:
      return null;
  }
}

export function describeAuditEntry(entry: AuditLogRow): { actorLabel: string; text: string } {
  return { actorLabel: actorLabel(entry.actor), text: describeAction(entry) ?? entry.action };
}
