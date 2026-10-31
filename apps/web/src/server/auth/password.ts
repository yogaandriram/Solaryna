import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Compares in constant time: both sides are HMACed under a random per-process key first, so
 * their lengths always match and nothing about the password can be precomputed.
 */
export function createPasswordChecker(password: string): (input: string) => boolean {
  const key = randomBytes(32);
  const mac = (value: string): Buffer => createHmac('sha256', key).update(value, 'utf8').digest();
  const expected = mac(password);
  return (input) => timingSafeEqual(mac(input), expected);
}
