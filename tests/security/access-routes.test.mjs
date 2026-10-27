import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server.js';
import { GET as readStatus } from '../../app/access-control/status/route.ts';
import { POST as unlock } from '../../app/access-control/unlock/route.ts';
import { POST as lock } from '../../app/access-control/lock/route.ts';
import { ACCESS_SESSION_COOKIE, ACCESS_SESSION_TTL_SECONDS } from '../../lib/server/access-session.ts';

const passphrase = 'test-only-random-passphrase-0123456789';

function restorePassphrase(t) {
  const previous = process.env.LAWSENSE_ACCESS_PIN;
  t.after(() => {
    if (previous === undefined) delete process.env.LAWSENSE_ACCESS_PIN;
    else process.env.LAWSENSE_ACCESS_PIN = previous;
  });
}

function jsonRequest(url, payload, method = 'POST') {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

test('network unlock rejects plain HTTP even when the passphrase is correct', async (t) => {
  restorePassphrase(t);
  process.env.LAWSENSE_ACCESS_PIN = passphrase;

  const response = await unlock(jsonRequest(
    'http://192.0.2.20:3000/access-control/unlock',
    { passphrase },
  ));

  assert.equal(response.status, 400);
  assert.match((await response.json()).detail, /HTTPS/);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('unlock rejects a wrong passphrase without issuing a session cookie', async (t) => {
  restorePassphrase(t);
  process.env.LAWSENSE_ACCESS_PIN = passphrase;

  const response = await unlock(jsonRequest(
    'https://192.0.2.20:3000/access-control/unlock',
    { passphrase: 'not-the-configured-passphrase-0000' },
  ));

  assert.equal(response.status, 401);
  assert.match((await response.json()).detail, /not accepted/i);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('unlock issues a signed HTTP-only strict cookie and sanitizes redirects', async (t) => {
  restorePassphrase(t);
  process.env.LAWSENSE_ACCESS_PIN = passphrase;

  const response = await unlock(jsonRequest(
    'https://192.0.2.20:3000/access-control/unlock',
    { passphrase, next: '//outside.example/path' },
  ));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', redirectTo: '/' });
  const cookie = response.cookies.get(ACCESS_SESSION_COOKIE);
  assert.ok(cookie?.value);
  const header = response.headers.get('set-cookie') ?? '';
  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=Strict/i);
  assert.match(header, /Secure/i);
  assert.match(header, new RegExp('Max-Age=' + ACCESS_SESSION_TTL_SECONDS));

  const statusResponse = readStatus(new NextRequest(
    'https://192.0.2.20:3000/access-control/status',
    { headers: { cookie: ACCESS_SESSION_COOKIE + '=' + cookie.value } },
  ));
  assert.equal(statusResponse.status, 200);
  const statusBody = await statusResponse.json();
  assert.equal(statusBody.mode, 'passphrase');
  assert.equal(statusBody.sessionActive, true);

  const lockResponse = lock(new NextRequest('https://192.0.2.20:3000/access-control/lock', {
    method: 'POST',
  }));
  assert.equal(lockResponse.status, 200);
  assert.equal((await lockResponse.json()).status, 'locked');
  const clearedCookie = lockResponse.headers.get('set-cookie') ?? '';
  assert.match(clearedCookie, /Max-Age=0/i);
  assert.match(clearedCookie, /HttpOnly/i);
});

test('unlock streams a maximum body size and rejects oversized payloads', async (t) => {
  restorePassphrase(t);
  process.env.LAWSENSE_ACCESS_PIN = passphrase;

  const response = await unlock(jsonRequest(
    'http://localhost:3000/access-control/unlock',
    { passphrase, padding: 'x'.repeat(5000) },
  ));

  assert.equal(response.status, 413);
  assert.match((await response.json()).detail, /too large/i);
});

test('unlock fails closed when the passphrase is absent or too short', async (t) => {
  restorePassphrase(t);
  delete process.env.LAWSENSE_ACCESS_PIN;
  const missing = await unlock(jsonRequest(
    'http://localhost:3000/access-control/unlock',
    { passphrase },
  ));
  assert.equal(missing.status, 503);

  process.env.LAWSENSE_ACCESS_PIN = 'too-short';
  const misconfigured = await unlock(jsonRequest(
    'http://localhost:3000/access-control/unlock',
    { passphrase },
  ));
  assert.equal(misconfigured.status, 503);
});
