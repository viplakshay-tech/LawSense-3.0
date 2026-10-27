import { NextResponse, type NextRequest } from 'next/server.js';
import {
  ACCESS_SESSION_COOKIE,
  ACCESS_SESSION_TTL_SECONDS,
  constantTimeTextEqual,
  createAccessSessionToken,
  getAccessMode,
  getConfiguredAccessPassphrase,
  safeReturnPath,
} from '../../../lib/server/access-session.ts';

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1';
}

type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; detail: string };

async function readBoundedJson(request: NextRequest): Promise<BoundedJsonResult> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > 4096) {
    return { ok: false, status: 413, detail: 'Unlock request is too large.' };
  }
  if (!request.body) {
    return { ok: false, status: 400, detail: 'Enter the access passphrase and try again.' };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > 4096) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413, detail: 'Unlock request is too large.' };
      }
      chunks.push(result.value);
    }
  } catch {
    return { ok: false, status: 400, detail: 'Enter the access passphrase and try again.' };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { ok: false, status: 400, detail: 'Enter the access passphrase and try again.' };
  }
}

export async function POST(request: NextRequest) {
  const mode = getAccessMode();
  if (mode === 'local-only') {
    return NextResponse.json(
      { status: 'unavailable', detail: 'Network use requires a configured LAWSENSE_ACCESS_PIN with a random passphrase of at least 16 characters on the server.' },
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
