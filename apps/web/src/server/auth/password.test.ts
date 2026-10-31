import { describe, expect, it } from 'vitest';
import { createPasswordChecker } from './password';

describe('createPasswordChecker', () => {
  const check = createPasswordChecker('Rahasia-Dashboard-1');

  it('accepts an exact match', () => {
    expect(check('Rahasia-Dashboard-1')).toBe(true);
  });

  it('rejects a prefix, an extension, a case change and an empty input', () => {
    expect(check('Rahasia-Dashboard')).toBe(false);
    expect(check('Rahasia-Dashboard-12')).toBe(false);
    expect(check('rahasia-dashboard-1')).toBe(false);
    expect(check('')).toBe(false);
  });
});
