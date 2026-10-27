import { NextResponse } from 'next/server';
import { getAccessMode, MIN_ACCESS_PASSPHRASE_LENGTH } from '@/lib/server/access-session';

export const dynamic = 'force-dynamic';

export function GET() {
  const mode = getAccessMode();
  return NextResponse.json(
    {
      mode,
      minimumPassphraseLength: MIN_ACCESS_PASSPHRASE_LENGTH,
      networkAccessAllowed: mode === 'passphrase',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
