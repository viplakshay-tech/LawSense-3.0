import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server.js';
import { proxy } from '../../proxy.ts';
import {
  ACCESS_SESSION_COOKIE,
  createAccessSessionToken,
} from '../../lib/server/access-session.ts';

const passphrase = 'test-only-random-passphrase-0123456789';

function restorePassphrase(t) {
  const previous = process.env.LAWSENSE_ACCESS_PIN;
  t.after(() => {
    if (previous === undefined) delete process.env.LAWSENSE_ACCESS_PIN;
    else process.env.LAWSENSE_ACCESS_PIN = previous;
  });
}

function request(url, cookie) {
  return new NextRequest(url, {
    headers: cookie ? { cookie: ACCESS_SESSION_COOKIE + '=' + cookie } : {},
  });
}

test('without a passphrase, loopback pages work but network pages and APIs are blocked', (t) => {
  restorePassphrase(t);
  delete process.env.LAWSENSE_ACCESS_PIN;

  const localPage = proxy(request('http://localhost:3000/case/demo'));
  assert.equal(localPage.headers.get('x-middleware-next'), '1');

  const networkPage = proxy(request('http://192.0.2.20:3000/case/demo?tab=evidence'));
  assert.equal(networkPage.status, 307);
  const location = new URL(networkPage.headers.get('location'));
  assert.equal(location.pathname, '/unlock');
  assert.equal(location.searchParams.get('reason'), 'network-passphrase-required');

  const networkApi = proxy(request('http://192.0.2.20:3000/api/cases/demo'));
  assert.equal(networkApi.status, 503);
});

test('a misconfigured passphrase fails closed for pages and APIs', (t) => {
  restorePassphrase(t);
  process.env.LAWSENSE_ACCESS_PIN = 'too-short';

  const page = proxy(request('https://law.example/case/demo'));
  assert.equal(page.status, 307);
  assert.equal(new URL(page.headers.get('location')).searchParams.get('reason'), 'passphrase-misconfigured');

  const api = proxy(request('https://law.example/api/cases/demo'));
  assert.equal(api.status, 503);
});

test('configured passphrase locks case pages and APIs until a valid session is present', (t) => {
  restorePassphrase(t);
  process.env.LAWSENSE_ACCESS_PIN = passphrase;

  const lockedPage = proxy(request('https://law.example/case/demo?tab=law'));
  assert.equal(lockedPage.status, 307);
  const location = new URL(lockedPage.headers.get('location'));
  assert.equal(location.pathname, '/unlock');
  assert.equal(location.searchParams.get('next'), '/case/demo?tab=law');

  const lockedApi = proxy(request('https://law.example/api/cases/demo'));
  assert.equal(lockedApi.status, 401);

  const token = createAccessSessionToken(passphrase);
  const unlockedPage = proxy(request('https://law.example/case/demo', token));
  assert.equal(unlockedPage.headers.get('x-middleware-next'), '1');

  const unlockedApi = proxy(request('https://law.example/api/cases/demo', token));
  assert.equal(unlockedApi.headers.get('x-middleware-next'), '1');
});

test('unlock, access-status and health endpoints remain reachable while locked', (t) => {
  restorePassphrase(t);
  process.env.LAWSENSE_ACCESS_PIN = passphrase;

  for (const path of ['/unlock', '/access-control/status', '/access-control/unlock', '/api/health']) {
    const response = proxy(request('https://law.example' + path));
    assert.equal(response.headers.get('x-middleware-next'), '1', path);
  }
});
