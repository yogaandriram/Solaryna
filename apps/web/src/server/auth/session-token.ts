import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';

// Stateless session tokens: `v1.<expiry ms>.<HMAC-SHA256 signature>`. The signing key is
// derived from DASHBOARD_PASSWORD, so changing the password logs every session out.

export const SESSION_COOKIE = 'solaryna_session';
export const SESSION_TTL_MS = 7 * 24 * 3600_000;

const VERSION = 'v1';
const KEY_SALT = 'solaryna-dashboard-session-v1';

export function deriveSessionKey(password: string): Buffer {
  return scryptSync(password, KEY_SALT, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

function sign(key: Buffer, payload: string): Buffer {
  return createHmac('sha256', key).update(payload).digest();
}

export function createSessionToken(key: Buffer, nowMs: number, ttlMs = SESSION_TTL_MS): string {
  const payload = `${VERSION}.${nowMs + ttlMs}`;
  return `${payload}.${sign(key, payload).toString('base64url')}`;
}

export function verifySessionToken(token: string | undefined, key: Buffer, nowMs: number): boolean {
  const parts = token?.split('.');
  if (parts?.length !== 3) {
    return false;
  }
  const [version, expiry, signature] = parts as [string, string, string];
  if (version !== VERSION || !/^\d{1,16}$/.test(expiry) || Number(expiry) <= nowMs) {
    return false;
  }
  const expected = sign(key, `${version}.${expiry}`);
  const actual = Buffer.from(signature, 'base64url');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
