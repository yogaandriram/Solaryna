import { describe, expect, it } from 'vitest';
import { isValidSolanaAddress, shortAddress } from './address';
import { escapeHtml, sanitizeDisplayText } from './text';

describe('escapeHtml', () => {
  it('neutralizes markup injected through token names', () => {
    expect(escapeHtml('<b>FREE</b> & <a href="x">claim</a>')).toBe(
      '&lt;b&gt;FREE&lt;/b&gt; &amp; &lt;a href=&quot;x&quot;&gt;claim&lt;/a&gt;',
    );
  });

  it('escapes ampersands first so entities are not double-decoded', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('sanitizeDisplayText', () => {
  it('strips control, bidi-override, and zero-width characters', () => {
    expect(sanitizeDisplayText('PE\u202ePE\u200b\nCOIN\u0000', 50)).toBe('PEPE COIN');
  });

  it('truncates by code point without splitting emoji', () => {
    expect(sanitizeDisplayText('🚀🚀🚀🚀', 3)).toBe('🚀🚀…');
    expect(sanitizeDisplayText('  spaced   out  ', 50)).toBe('spaced out');
  });
});

describe('isValidSolanaAddress', () => {
  it('accepts 32-byte base58 keys', () => {
    expect(isValidSolanaAddress('So11111111111111111111111111111111111111112')).toBe(true);
    expect(isValidSolanaAddress('11111111111111111111111111111111')).toBe(true);
  });

  it('rejects malformed input', () => {
    for (const bad of [
      '',
      'not-an-address',
      'So1111111111111111111111111111111111111111O', // O is not base58
      'J8M2wM8vtBLZJfajpczrjbs78PWhW1sqVFVJdE5d43jXJ8M2', // too long
      '<script>alert(1)</script>',
    ]) {
      expect(isValidSolanaAddress(bad), bad).toBe(false);
    }
  });
});

describe('shortAddress', () => {
  it('keeps both ends', () => {
    expect(shortAddress('So11111111111111111111111111111111111111112')).toBe('So11…1112');
  });
});
