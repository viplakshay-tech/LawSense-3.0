import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACCESS_SESSION_TTL_SECONDS,
  createAccessSessionToken,
  getAccessMode,
  safeReturnPath,
  verifyAccessSessionToken,
} from '../../lib/server/access-session.ts';

const passphrase = 'test-only-random-passphrase-0123456789';
const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);

test('access mode fails closed for missing and too-short network passphrases', () => {
  const previous = process.env.LAWSENSE_ACCESS_PIN;
  try {
    delete process.env.LAWSENSE_ACCESS_PIN;
    assert.equal(getAccessMode(), 'local-only');
    process.env.LAWSENSE_ACCESS_PIN = 'too-short';
    assert.equal(getAccessMode(), 'misconfigured');
    process.env.LAWSENSE_ACCESS_PIN = passphrase;
    assert.equal(getAccessMode(), 'passphrase');
  } finally {
    if (previous === undefined) delete process.env.LAWSENSE_ACCESS_PIN;
    else process.env.LAWSENSE_ACCESS_PIN = previous;
  }
});

test('signed access session expires and rejects tampering or a different passphrase', () => {
  const token = createAccessSessionToken(passphrase, fixedNow);
  assert.equal(verifyAccessSessionToken(token, passphrase, fixedNow), true);
  assert.equal(verifyAccessSessionToken(token, 'different-passphrase-0123456789', fixedNow), false);
  assert.equal(verifyAccessSessionToken(token + 'x', passphrase, fixedNow), false);
  assert.equal(
    verifyAccessSessionToken(token, passphrase, fixedNow + ACCESS_SESSION_TTL_SECONDS * 1000),
    false,
  );
  assert.equal(verifyAccessSessionToken(undefined, passphrase, fixedNow), false);
});

test('return path validation prevents external, protocol-relative and access-page redirects', () => {
  assert.equal(safeReturnPath('/case/case-123/documents?tab=review'), '/case/case-123/documents?tab=review');
  assert.equal(safeReturnPath('https://evil.example'), '/');
  assert.equal(safeReturnPath('//evil.example/path'), '/');
  assert.equal(safeReturnPath('/unlock?next=/'), '/');
  assert.equal(safeReturnPath('/api/access/lock'), '/');
  assert.equal(safeReturnPath('/\\\\evil.example'), '/');
});
