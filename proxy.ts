import { NextResponse, type NextRequest } from 'next/server';
import {
  ACCESS_SESSION_COOKIE,
  getAccessMode,
  getConfiguredAccessPassphrase,
  verifyAccessSessionToken,
} from '@/lib/server/access-session';

const PUBLIC_PATHS = new Set([
  '/unlock',
  '/api/access/status',
  '/api/access/unlock',
  '/api/health',
]);

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1';
}

function unavailable(reason: string, status: number): NextResponse {
  return NextResponse.json(
    { status: 'unavailable', detail: reason },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const mode = getAccessMode();
  const isApiRequest = pathname.startsWith('/api/');
  const localHost = isLoopbackHost(request.nextUrl.hostname);

  if (mode === 'local-only') {
    if (localHost) return NextResponse.next();
    if (isApiRequest) {
      return unavailable(
        'Network access is disabled. Configure LAWSENSE_ACCESS_PIN with a random passphrase of at least 16 characters before using LawSense over a network.',
        503,
      );
    }
    const unlock = new URL('/unlock', request.url);
    unlock.searchParams.set('reason', 'network-passphrase-required');
    return NextResponse.redirect(unlock);
  }

  if (mode === 'misconfigured') {
    const message = 'LAWSENSE_ACCESS_PIN is set but is too short. Set a random passphrase of at least 16 characters.';
    if (isApiRequest) return unavailable(message, 503);
    const unlock = new URL('/unlock', request.url);
    unlock.searchParams.set('reason', 'passphrase-misconfigured');
    return NextResponse.redirect(unlock);
  }

  const passphrase = getConfiguredAccessPassphrase();
  const token = request.cookies.get(ACCESS_SESSION_COOKIE)?.value;
  if (passphrase && verifyAccessSessionToken(token, passphrase)) return NextResponse.next();

  if (isApiRequest) {
    return unavailable('This LawSense session is locked. Unlock the workspace and retry.', 401);
  }

  const unlock = new URL('/unlock', request.url);
  unlock.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(unlock);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
