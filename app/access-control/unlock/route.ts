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

type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; detail: string };

async function readBoundedJson(request: NextRequest): Promise<BoundedJsonResult> {
  const parsed = await readBoundedJson(request);
  if (!parsed.ok) {
    return NextResponse.json(
      { status: 'unavailable', detail: parsed.detail },
      { status: parsed.status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const payload = parsed.value;

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
