import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { guideVoiceSnapshotForEvent } from '../../components/guide-runtime/voice-adapter/visual-state.ts';

const guidePresenceCss = await readFile(new URL('../../components/guide-presence/GuidePresence.css', import.meta.url), 'utf8');
const avatarCss = await readFile(new URL('../../components/guide-presence/avatar/IllustratedAvatarRenderer.css', import.meta.url), 'utf8');
const callCss = await readFile(new URL('../../app/case/[id]/voice/VoiceCaseClient.css', import.meta.url), 'utf8');

test('voice milestones present the state reported by the call flow', () => {
  const started = guideVoiceSnapshotForEvent({ type: 'capture_started', draftId: 'd', captureId: 'c', provider: 'browser', language: 'english' }, 'IDLE', 'idle');
  assert.equal(started.visualState, 'LISTENING');
  assert.equal(started.speechState, 'idle');

  const review = guideVoiceSnapshotForEvent({ type: 'review_started', draftId: 'd', transcript: 'My statement' }, 'CLARIFYING', 'idle');
  assert.equal(review.visualState, 'THINKING');
  assert.match(review.detail, /unconfirmed draft/);

  const speaking = guideVoiceSnapshotForEvent({ type: 'speech_started', responseId: 'response-1' }, 'IDLE', 'speaking');
  assert.deepEqual(speaking, {
    visualState: 'SPEAKING',
    detail: 'Speaking the response. The text remains available to read.',
    speechState: 'speaking',
  });
});

test('case updates and pauses follow the shared Runtime snapshot', () => {
  const updated = guideVoiceSnapshotForEvent({
    type: 'case_state_updated',
    draftId: 'd',
    caseId: 'case-1',
    revision: 4,
    caseState: {},
    inputMethod: 'text',
  }, 'SAFETY', 'idle');
  assert.equal(updated.visualState, 'SAFETY');
  assert.equal(updated.speechState, 'idle');

  const paused = guideVoiceSnapshotForEvent({ type: 'speech_paused', responseId: 'response-1' }, 'CONFLICT', 'paused');
  assert.equal(paused.visualState, 'CONFLICT');
  assert.equal(paused.speechState, 'paused');
});

test('failures remain visible as an action-required state', () => {
  const failed = guideVoiceSnapshotForEvent({ type: 'capture_failed', draftId: 'd', captureId: 'c', detail: 'Microphone permission was denied.' }, 'IDLE', 'idle');
  assert.equal(failed.visualState, 'ACTION_REQUIRED');
  assert.equal(failed.detail, 'Microphone permission was denied.');
});

test('reduced motion keeps the Guide portrait still', () => {
  assert.match(guidePresenceCss, /data-reduced-motion=?['"]?true/);
  assert.match(guidePresenceCss, /prefers-reduced-motion:\s*reduce/);
  assert.match(avatarCss, /data-reduced-motion=?['"]?true/);
  assert.match(avatarCss, /prefers-reduced-motion:\s*reduce/);
});

test('the call layout has a stacked narrow viewport treatment', () => {
  assert.match(callCss, /@media\s*\(max-width:\s*54rem\)/);
  assert.match(callCss, /@media\s*\(max-width:\s*35rem\)/);
  assert.match(callCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});
