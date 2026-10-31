import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getWebConfig } from '../config';
import { createPasswordChecker } from './password';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSessionToken,
  deriveSessionKey,
  verifySessionToken,
} from './session-token';

let sessionKey: Buffer | undefined;
let passwordChecker: ((input: string) => boolean) | undefined;

function getSessionKey(): Buffer {
  sessionKey ??= deriveSessionKey(getWebConfig().dashboardPassword.reveal());
  return sessionKey;
}

export function isDashboardPassword(input: string): boolean {
  passwordChecker ??= createPasswordChecker(getWebConfig().dashboardPassword.reveal());
  return passwordChecker(input);
}

/** Verifies the session cookie for real (the proxy only checks that it exists). */
export const hasValidSession = cache(async (): Promise<boolean> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySessionToken(token, getSessionKey(), Date.now());
});

/** Every page and every Server Action calls this first. */
export async function requireSession(): Promise<void> {
  if (!(await hasValidSession())) {
    redirect('/login');
  }
}

export async function createSession(): Promise<void> {
  const now = Date.now();
  const forwardedProto = (await headers()).get('x-forwarded-proto');
  (await cookies()).set(SESSION_COOKIE, createSessionToken(getSessionKey(), now), {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    // Plain-HTTP LAN access must keep working; behind an HTTPS proxy the cookie is secure.
    secure: forwardedProto?.split(',')[0]?.trim() === 'https',
    expires: new Date(now + SESSION_TTL_MS),
  });
}

export async function deleteSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
