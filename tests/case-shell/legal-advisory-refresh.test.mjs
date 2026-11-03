import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const advisorySource = await readFile(
  new URL('../../components/case-shell/PersistentLegalAdvisory.tsx', import.meta.url),
  'utf8',
);

test('Legal Advisory reloads when the open case record changes', () => {
  assert.match(
    advisorySource,
    /useEffect\(\(\) => \{\s*if \(!open\) return;\s*void loadAdvisory\(\);[\s\S]*?\}, \[open, loadAdvisory\]\);/,
  );
});

test('stale advisory and support-resource responses cannot overwrite a newer case review', () => {
  assert.match(advisorySource, /const loadRequestIdRef = useRef\(0\)/);
  assert.match(advisorySource, /const requestId = \+\+loadRequestIdRef\.current/);
  assert.match(advisorySource, /requestId !== loadRequestIdRef\.current/);
  assert.match(advisorySource, /requestId === loadRequestIdRef\.current/);
  assert.match(advisorySource, /loadRequestIdRef\.current \+= 1/);
});

test('opening the advisory delegates loading to the case-aware effect', () => {
  assert.match(advisorySource, /function openDialog\(\) \{\s*setOpen\(true\);\s*\}/);
});
