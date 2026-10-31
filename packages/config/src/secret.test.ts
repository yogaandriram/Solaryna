import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { Secret } from './secret';

describe('Secret', () => {
  const secret = new Secret('super-secret-value');

  it('reveals the raw value only on request', () => {
    expect(secret.reveal()).toBe('super-secret-value');
  });

  it('does not leak through string conversion, JSON, or inspect', () => {
    expect(String(secret)).not.toContain('super-secret-value');
    expect(`${secret.toString()}`).not.toContain('super-secret-value');
    expect(JSON.stringify({ nested: { secret } })).not.toContain('super-secret-value');
    expect(inspect({ secret }, { depth: 5, showHidden: true })).not.toContain('super-secret-value');
  });
});
