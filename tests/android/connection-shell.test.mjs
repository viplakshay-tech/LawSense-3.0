import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const shell = await readFile(
  new URL('../../capacitor-shell/index.html', import.meta.url),
  'utf8',
);

test('Android shell accepts only an HTTPS origin and rejects phone-local localhost', () => {
  assert.match(shell, /address\.protocol !== 'https:'/);
  assert.match(shell, /host === 'localhost'/);
  assert.match(shell, /host === '127\.0\.0\.1'/);
  assert.match(shell, /host === '::1'/);
  assert.match(shell, /Use the computer’s private network address/);
});

test('Android shell opens the app only after confirming the LawSense API health response', () => {
  assert.match(shell, /\$\{address\}\/api\/health/);
  assert.match(shell, /body\?\.status !== 'ok'/);
  assert.match(shell, /body\?\.service !== 'lawsense-api'/);
  assert.match(shell, /credentials: 'omit'/);
  assert.match(shell, /frame\.src = address/);
});

test('native audio bridge checks the exact iframe source and origin and allowlists methods', () => {
  assert.match(shell, /event\.source !== target\.frame\.contentWindow/);
  assert.match(shell, /event\.origin !== target\.origin/);
  assert.match(shell, /new Set\(\['getCapabilities', 'startListening', 'stopListening', 'speak', 'stopSpeaking'\]\)/);
});
