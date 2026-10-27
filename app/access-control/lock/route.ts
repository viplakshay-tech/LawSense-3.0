import { NextResponse, type NextRequest } from 'next/server.js';
import { ACCESS_SESSION_COOKIE } from '../../../lib/server/access-session';

export function POST(request: NextRequest) {
  const response = NextResponse.json(
    { status: 'locked' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
  response.cookies.set({
    name: ACCESS_SESSION_COOKIE,
    value: '',
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  });
  return response;
}
