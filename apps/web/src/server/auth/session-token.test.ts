import { describe, expect, it } from 'vitest';
import {
  SESSION_TTL_MS,
  createSessionToken,
  deriveSessionKey,
  verifySessionToken,
} from './session-token';

const key = deriveSessionKey('correct horse battery staple');
const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);

describe('session tokens', () => {
  it('accepts a token it created until it expires', () => {
    const token = createSessionToken(key, NOW);
    expect(token).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]+$/);
    expect(verifySessionToken(token, key, NOW)).toBe(true);
    expect(verifySessionToken(token, key, NOW + SESSION_TTL_MS - 1)).toBe(true);
  });

  it('rejects an expired token', () => {
    const token = createSessionToken(key, NOW, 1000);
    expect(verifySessionToken(token, key, NOW + 1000)).toBe(false);
    expect(verifySessionToken(createSessionToken(key, NOW), key, NOW + SESSION_TTL_MS)).toBe(false);
  });

  it('rejects a tampered expiry or signature', () => {
    const [version, exp, sig] = createSessionToken(key, NOW, 1000).split('.') as [
      string,
      string,
      string,
    ];
    const later = String(Number(exp) + SESSION_TTL_MS);
    expect(verifySessionToken(`${version}.${later}.${sig}`, key, NOW)).toBe(false);
    const flipped = (sig.startsWith('A') ? 'B' : 'A') + sig.slice(1);
    expect(verifySessionToken(`${version}.${exp}.${flipped}`, key, NOW)).toBe(false);
    expect(verifySessionToken(`${version}.${exp}.${sig.slice(0, -2)}`, key, NOW)).toBe(false);
    expect(verifySessionToken(`v2.${exp}.${sig}`, key, NOW)).toBe(false);
  });

  it('rejects a token signed with a different password', () => {
    const other = deriveSessionKey('a different password');
    expect(verifySessionToken(createSessionToken(other, NOW), key, NOW)).toBe(false);
  });

  it('rejects garbage', () => {
    for (const token of [undefined, '', 'v1', 'v1.x.y', 'v1..', 'v1.123', 'v1.-5.abc', 'a.b.c.d']) {
      expect(verifySessionToken(token, key, NOW)).toBe(false);
    }
  });
});
