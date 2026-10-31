import {
  RUNTIME_LIMIT_KEYS,
  RUNTIME_LIMIT_LABELS,
  escapeHtml,
  formatRuntimeLimit,
  type RuntimeLimitKey,
} from '@solaryna/core';
import type { AuditLogRow } from '@solaryna/db';
import { formatWallet } from './format';

// Telegram announcements of changes made in the dashboard (read back from audit_log). The
// details come from our own database but are still treated as untrusted text and escaped.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRuntimeLimitKey = (key: string): key is RuntimeLimitKey =>
  (RUNTIME_LIMIT_KEYS as readonly string[]).includes(key);

function limitValue(key: string, value: unknown): string {
  if (typeof value !== 'string') {
    return 'ikut .env';
  }
  return escapeHtml(isRuntimeLimitKey(key) ? formatRuntimeLimit(key, value) : value);
}

function formatLimitChanges(details: unknown): string | null {
  if (!isRecord(details) || !isRecord(details.changes)) {
    return null;
  }
  const lines = Object.entries(details.changes).flatMap(([key, change]) => {
    if (!isRecord(change)) {
      return [];
    }
    const label = isRuntimeLimitKey(key) ? RUNTIME_LIMIT_LABELS[key] : key;
    return [
      `• ${escapeHtml(label)}: ${limitValue(key, change.from)} → ${limitValue(key, change.to)}`,
    ];
  });
  return lines.length === 0
    ? null
    : ['⚙️ Batas risiko diubah dari dashboard:', ...lines].join('\n');
}

function walletOf(details: unknown): { address: string; label: string | null } | null {
  if (!isRecord(details) || typeof details.address !== 'string') {
    return null;
  }
  return {
    address: details.address,
    label: typeof details.label === 'string' ? details.label : null,
  };
}

/** The Telegram HTML for a dashboard audit entry, or null when it is not worth announcing. */
export function formatDashboardAction(entry: AuditLogRow): string | null {
  switch (entry.action) {
    case 'trading.pause':
      return '⏸ Trading dijeda dari dashboard. Sinyal baru dan exit otomatis menunggu dilanjutkan.';
    case 'trading.resume':
      return '▶️ Trading dilanjutkan dari dashboard.';
    case 'limits.update':
      return formatLimitChanges(entry.details);
    case 'wallet.add': {
      const wallet = walletOf(entry.details);
      const status = isRecord(entry.details) ? entry.details.status : undefined;
      if (wallet === null || status === 'already_active') {
        return null;
      }
      const verb = status === 'reactivated' ? 'diaktifkan kembali' : 'ditambahkan';
      return `👛 Wallet ${verb} dari dashboard: ${formatWallet(wallet)}`;
    }
    case 'wallet.remove': {
      const wallet = walletOf(entry.details);
      return wallet === null
        ? null
        : `👛 Wallet berhenti dipantau dari dashboard: ${formatWallet(wallet)}`;
    }
    default:
      return null;
  }
}
