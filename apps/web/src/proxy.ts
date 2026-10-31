import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from './server/auth/session-token';

// An optimistic check only: pages and Server Actions verify the session token themselves.
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/login' || request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
