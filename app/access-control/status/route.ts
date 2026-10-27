import { NextResponse, type NextRequest } from 'next/server';
import {
  ACCESS_SESSION_COOKIE,
  getAccessMode,
  MIN_ACCESS_PASSPHRASE_LENGTH,
  getConfiguredAccessPassphrase,
  verifyAccessSessionToken,
} from '@/lib/server/access-session';

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
  const mode = getAccessMode();
  const passphrase = getConfiguredAccessPassphrase();
  const token = request.cookies.get(ACCESS_SESSION_COOKIE)?.value;
  const sessionActive = Boolean(passphrase && verifyAccessSessionToken(token, passphrase));
  return NextResponse.json(
    {
      mode,
      minimumPassphraseLength: MIN_ACCESS_PASSPHRASE_LENGTH,
      networkAccessAllowed: mode === 'passphrase',
      sessionActive,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
