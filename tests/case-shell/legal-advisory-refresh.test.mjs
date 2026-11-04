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
    /useEffect\(\(\) => \{\s*if \(!open\) return;\s*const frame = window\.requestAnimationFrame\(\(\) => \{\s*void loadAdvisory\(\);\s*\}\);[\s\S]*?\}, \[open, loadAdvisory\]\);/,
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
  assert.match(advisorySource, /function openDialog\(\) \{\s*if \(!open && document\.activeElement instanceof HTMLElement\) \{\s*previousFocusRef\.current = document\.activeElement;\s*\}\s*setOpen\(true\);\s*\}/);
});

test('Legal Advisory traps keyboard focus and restores the opener when closed', () => {
  assert.match(advisorySource, /const dialogRef = useRef<HTMLElement \| null>\(null\)/);
  assert.match(advisorySource, /const previousFocusRef = useRef<HTMLElement \| null>\(null\)/);
  assert.match(advisorySource, /focusableElements\(\)/);
  assert.match(advisorySource, /event\.shiftKey && \(document\.activeElement === first \|\| document\.activeElement === dialog\)/);
  assert.match(advisorySource, /!dialog\?\.contains\(document\.activeElement\)/);
  assert.match(advisorySource, /\(previousFocusRef\.current \?\? trigger\)\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(advisorySource, /ref=\{dialogRef\}[\s\S]*?tabIndex=\{-1\}[\s\S]*?role="dialog"/);
});
