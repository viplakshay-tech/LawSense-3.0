import { NextResponse, type NextRequest } from 'next/server';
import {
  ACCESS_SESSION_COOKIE,
  ACCESS_SESSION_TTL_SECONDS,
  constantTimeTextEqual,
  createAccessSessionToken,
  getAccessMode,
  getConfiguredAccessPassphrase,
  safeReturnPath,
} from '@/lib/server/access-session';

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1';
}

export async function POST(request: NextRequest) {
  const mode = getAccessMode();
  if (mode === 'local-only') {
    return NextResponse.json(
      { status: 'unavailable', detail: 'Network access is disabled. Configure LAWSENSE_ACCESS_PIN with a random passphrase of at least 16 characters on the server.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (mode === 'misconfigured') {
    return NextResponse.json(
      { status: 'unavailable', detail: 'LAWSENSE_ACCESS_PIN must contain at least 16 characters. Use a generated random passphrase.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const passphrase = getConfiguredAccessPassphrase();
  if (!passphrase) {
    return NextResponse.json(
      { status: 'unavailable', detail: 'Access passphrase is not configured.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!isLoopbackHost(request.nextUrl.hostname) && request.nextUrl.protocol !== 'https:') {
    return NextResponse.json(
      { status: 'unavailable', detail: 'Use HTTPS for network access so the passphrase is not sent over plain HTTP.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > 4096) {
    return NextResponse.json(
      { status: 'unavailable', detail: 'Unlock request is too large.' },
      { status: 413, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { status: 'unavailable', detail: 'Enter the access passphrase and try again.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (
    typeof payload !== 'object'
    || payload === null
    || !('passphrase' in payload)
    || typeof payload.passphrase !== 'string'
    || payload.passphrase.length > 512
    || !constantTimeTextEqual(payload.passphrase, passphrase)
  ) {
    return NextResponse.json(
      { status: 'unavailable', detail: 'The passphrase was not accepted.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const response = NextResponse.json(
    { status: 'ok', redirectTo: safeReturnPath('next' in payload ? payload.next : '/') },
    { headers: { 'Cache-Control': 'no-store' } },
  );
  response.cookies.set({
    name: ACCESS_SESSION_COOKIE,
    value: createAccessSessionToken(passphrase),
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'strict',
    path: '/',
    maxAge: ACCESS_SESSION_TTL_SECONDS,
  });
  return response;
}
