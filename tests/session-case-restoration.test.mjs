import assert from 'node:assert/strict';
import test from 'node:test';
import { forgetSessionCase, getSessionCaseIds, rememberSessionCase } from '../lib/case-continuity.ts';
import { restoreSessionCases } from '../lib/session-case-restoration.ts';

const sessionCasesKey = 'lawsense:case-continuity:v1';
const caseId = 'e5248afc-61e2-4244-8746-f9e4703b3e05';
const malformedCaseId = `${caseId} http://127.0.0.1:3000/api/cases/${caseId}`;

function setSessionStorage(initialEntries = {}) {
  const values = new Map(Object.entries(initialEntries));
  globalThis.window = {
    sessionStorage: {
      getItem(key) { return values.get(key) ?? null; },
      setItem(key, value) { values.set(key, value); },
      removeItem(key) { values.delete(key); },
    },
  };
  return values;
}

test('malformed session IDs are ignored by the reader and writer', () => {
  const values = setSessionStorage({
    [sessionCasesKey]: JSON.stringify([caseId, malformedCaseId]),
  });

  assert.deepEqual(getSessionCaseIds(), [caseId]);
  rememberSessionCase(malformedCaseId);
  assert.deepEqual(getSessionCaseIds(), [caseId]);
  assert.deepEqual(JSON.parse(values.get(sessionCasesKey)), [caseId]);
});

test('forgetting a deleted case preserves other valid session cases', () => {
  const secondCaseId = 'f6359b0d-72f2-4f95-98d5-e5b9872ad1e1';
  const values = setSessionStorage({
    [sessionCasesKey]: JSON.stringify([caseId, secondCaseId]),
  });

  forgetSessionCase(caseId);

  assert.deepEqual(getSessionCaseIds(), [secondCaseId]);
  assert.deepEqual(JSON.parse(values.get(sessionCasesKey)), [secondCaseId]);
});

test('forgetting the last session case clears only the continuity index', () => {
  const values = setSessionStorage({
    [sessionCasesKey]: JSON.stringify([caseId]),
    unrelated: 'keep',
  });

  forgetSessionCase(caseId);

  assert.deepEqual(getSessionCaseIds(), []);
  assert.equal(values.has(sessionCasesKey), false);
  assert.equal(values.get('unrelated'), 'keep');
});

test('malformed stored IDs never reach the case API', async () => {
  setSessionStorage({ [sessionCasesKey]: JSON.stringify([malformedCaseId]) });
  const requestedIds = [];
  const restoredCases = await restoreSessionCases(getSessionCaseIds(), null, async (id) => {
    requestedIds.push(id);
    throw new Error('should not be called');
  });

  assert.deepEqual(requestedIds, []);
  assert.deepEqual(restoredCases, []);
});

test('a failed case read becomes unavailable and completes the loading path', async () => {
  setSessionStorage();
  let isLoading = true;
  let restoredCases = [];

  await restoreSessionCases([caseId], null, async () => {
    throw new Error('404 Not Found');
  }).then((results) => {
    restoredCases = results;
  }).finally(() => {
    isLoading = false;
  });

  assert.equal(isLoading, false);
  assert.deepEqual(restoredCases, [{ id: caseId, state: 'unavailable' }]);
});

test('a stalled case request becomes unavailable after the timeout', async () => {
  const timeoutResult = await restoreSessionCases(
    [caseId],
    null,
    () => new Promise(() => {}),
    5,
  );
  assert.deepEqual(timeoutResult, [{ id: caseId, state: 'unavailable' }]);
});
