import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  beginGuideSessionRequest,
  clearGuideSession,
  getGuideSessionSnapshot,
  isGuideSessionRequestCurrent,
} from '../../lib/guide-session.ts';

test('a newer Guide request supersedes an older pending request across input modes', () => {
  const caseId = 'guide-shared-request-sequence-regression';
  clearGuideSession(caseId);

  const firstRequest = beginGuideSessionRequest(caseId);
  assert.equal(isGuideSessionRequestCurrent(caseId, firstRequest), true);

  // A later text or voice request uses the same case-scoped sequence.
  const secondRequest = beginGuideSessionRequest(caseId);
  assert.equal(isGuideSessionRequestCurrent(caseId, firstRequest), false);
  assert.equal(isGuideSessionRequestCurrent(caseId, secondRequest), true);
  assert.ok(getGuideSessionSnapshot(caseId).requestSequence >= secondRequest.sequence);
});

test('clearing the Guide session invalidates its current pending request', () => {
  const caseId = 'guide-shared-request-clear-regression';
  clearGuideSession(caseId);
  const request = beginGuideSessionRequest(caseId);

  clearGuideSession(caseId);

  assert.equal(isGuideSessionRequestCurrent(caseId, request), false);
  assert.deepEqual(getGuideSessionSnapshot(caseId).turns, []);
});
