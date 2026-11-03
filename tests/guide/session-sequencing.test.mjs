import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  appendGuideSessionTurn,
  beginGuideSessionRequest,
  clearGuideSession,
  finishGuideSessionRequest,
  getGuideSessionSnapshot,
  invalidateGuideSessionRequest,
  isGuideSessionRequestCurrent,
} from '../../lib/guide-session.ts';

test('a newer Guide request supersedes an older pending request across input modes', () => {
  const caseId = 'guide-shared-request-sequence-regression';
  clearGuideSession(caseId);

  const firstRequest = beginGuideSessionRequest(caseId);
  assert.equal(isGuideSessionRequestCurrent(caseId, firstRequest), true);

  // A later text or voice request uses the same case-scoped sequence.
  const secondRequest = beginGuideSessionRequest(caseId);
  assert.equal(firstRequest.signal.aborted, true);
  assert.equal(isGuideSessionRequestCurrent(caseId, firstRequest), false);
  assert.equal(isGuideSessionRequestCurrent(caseId, secondRequest), true);
  assert.ok(getGuideSessionSnapshot(caseId).requestSequence >= secondRequest.sequence);
  finishGuideSessionRequest(caseId, secondRequest);
  assert.equal(secondRequest.signal.aborted, false);
});

test('clearing the Guide session invalidates its current pending request', () => {
  const caseId = 'guide-shared-request-clear-regression';
  clearGuideSession(caseId);
  const request = beginGuideSessionRequest(caseId);

  clearGuideSession(caseId);

  assert.equal(request.signal.aborted, true);
  assert.equal(isGuideSessionRequestCurrent(caseId, request), false);
  assert.deepEqual(getGuideSessionSnapshot(caseId).turns, []);
});

test('Guide API forwards shared session cancellation to its fetch request', async () => {
  const apiSource = await readFile(new URL('../../lib/api.ts', import.meta.url), 'utf8');
  const sessionSource = await readFile(new URL('../../lib/guide-session.ts', import.meta.url), 'utf8');
  assert.match(apiSource, /sessionSignal\?: AbortSignal/);
  assert.match(apiSource, /sessionSignal\?\.addEventListener\('abort', abortFromSession/);
  assert.match(apiSource, /signal: controller\.signal/);
  assert.match(apiSource, /sessionSignal\?\.removeEventListener\('abort', abortFromSession\)/);
  assert.match(sessionSource, /invalidateGuideSessionRequest\(previousActiveCaseId\)/);
});

test('switching cases cancels the old request without deleting its conversation', () => {
  const oldCaseId = 'guide-case-switch-old-case';
  clearGuideSession(oldCaseId);
  appendGuideSessionTurn(oldCaseId, { role: 'user', content: 'Keep this turn.', inputMode: 'text' });
  const request = beginGuideSessionRequest(oldCaseId);

  invalidateGuideSessionRequest(oldCaseId);

  assert.equal(request.signal.aborted, true);
  assert.equal(isGuideSessionRequestCurrent(oldCaseId, request), false);
  assert.equal(getGuideSessionSnapshot(oldCaseId).turns[0]?.content, 'Keep this turn.');
});
