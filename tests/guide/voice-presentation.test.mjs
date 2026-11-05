import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { validateGuideActionCommand } from '../../components/guide-actions/validation.ts';
import { createGuideActionBridge } from '../../components/guide-actions/bridge.ts';
import { appendGuideSessionTurn, beginGuideTurn, clearGuideSession, finishGuideTurn, getGuideConversationHistory, getGuideSessionSnapshot, invalidateGuideTurn, isGuideTurnCurrent } from '../../lib/guide-session.ts';
import { createGuideChatContext } from '../../lib/guide-chat-context.ts';
import { guideVoiceSnapshotForEvent } from '../../components/guide-runtime/voice-adapter/visual-state.ts';
import {
  createGuideConversationResponse,
  guideConversationPresentation,
  selectGuideSpeechVoice,
  resolveGuideActionProposal,
} from '../../components/voice/conversation.ts';

const guidePresenceSource = await readFile(new URL('../../components/guide-presence/GuidePresence.tsx', import.meta.url), 'utf8');
const guidePresenceCss = await readFile(new URL('../../components/guide-presence/GuidePresence.css', import.meta.url), 'utf8');
const avatarCss = await readFile(new URL('../../components/guide-presence/avatar/IllustratedAvatarRenderer.css', import.meta.url), 'utf8');
const callCss = await readFile(new URL('../../app/case/[id]/voice/VoiceCaseClient.css', import.meta.url), 'utf8');
const voicePage = await readFile(new URL('../../app/case/[id]/voice/page.tsx', import.meta.url), 'utf8');
const guideRuntimeProvider = await readFile(new URL('../../components/guide-runtime/GuideRuntimeProvider.tsx', import.meta.url), 'utf8');
const guideActionRegistrySource = await readFile(new URL('../../components/guide-runtime/actions.ts', import.meta.url), 'utf8');
const guideClientSource = await readFile(new URL('../../app/case/[id]/guide/GuideClient.tsx', import.meta.url), 'utf8');
const localAssistantSource = await readFile(new URL('../../api/app/services/local_assistant.py', import.meta.url), 'utf8');
const guideRouteSource = await readFile(new URL('../../api/app/routes/guide.py', import.meta.url), 'utf8');
const apiClientSource = await readFile(new URL('../../lib/api.ts', import.meta.url), 'utf8');
const guideWorkspaceSource = await readFile(new URL('../../app/case/[id]/guide/GuideClient.tsx', import.meta.url), 'utf8');
const legalSourceCandidates = await readFile(new URL('../../components/LegalSourceCandidates.tsx', import.meta.url), 'utf8');
const draftingStudio = await readFile(new URL('../../components/drafting/DraftingStudio.tsx', import.meta.url), 'utf8');
const persistentLegalAdvisorySource = await readFile(new URL('../../components/case-shell/PersistentLegalAdvisory.tsx', import.meta.url), 'utf8');
const guideSessionSource = await readFile(new URL('../../lib/guide-session.ts', import.meta.url), 'utf8');
const guideApiSource = await readFile(new URL('../../lib/api.ts', import.meta.url), 'utf8');
const voiceConversationSource = await readFile(new URL('../../components/voice/GuideConversation.tsx', import.meta.url), 'utf8');
const voiceCaseClientSource = await readFile(new URL('../../app/case/[id]/voice/VoiceCaseClient.tsx', import.meta.url), 'utf8');
const guideControlSurfaceSource = await readFile(new URL('../../components/guide-presence/GuideControlSurface.tsx', import.meta.url), 'utf8');
const persistentLegalAdvisory = await readFile(new URL('../../components/case-shell/PersistentLegalAdvisory.tsx', import.meta.url), 'utf8');
const guideModelStatusBanner = await readFile(new URL('../../components/guide-presence/GuideModelStatusBanner.tsx', import.meta.url), 'utf8');

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

test('live-call presentation follows browser recognition and speech lifecycle states', () => {
  assert.equal(guideConversationPresentation('listening').visualState, 'LISTENING');
  assert.equal(guideConversationPresentation('processing').visualState, 'THINKING');
  assert.equal(guideConversationPresentation('speaking').visualState, 'SPEAKING');
  assert.equal(guideConversationPresentation('speaking').speechState, 'speaking');
  assert.equal(guideConversationPresentation('paused').visualState, 'IDLE');
  assert.equal(guideConversationPresentation('permission_denied').visualState, 'ACTION_REQUIRED');
  assert.equal(guideConversationPresentation('error').visualState, 'ACTION_REQUIRED');
});

test('speech output prefers an available feminine language voice and falls back to an installed default', () => {
  const availableVoices = [
    { name: 'Hindi default', lang: 'hi-IN', default: true },
    { name: 'Hindi feminine', lang: 'hi-IN', default: false },
    { name: 'English feminine', lang: 'en-IN', default: false },
  ];

  assert.equal(selectGuideSpeechVoice(availableVoices, 'Hindi'), availableVoices[1]);
  assert.equal(selectGuideSpeechVoice(availableVoices, 'English'), availableVoices[2]);
  assert.equal(selectGuideSpeechVoice([{ name: 'System default', lang: 'hi-IN', default: true }], 'Hindi')?.name, 'System default');
  assert.equal(selectGuideSpeechVoice([{ name: 'English voice', lang: 'en-IN', default: true }], 'Hindi'), undefined);
});

test('spoken follow-ups repeat the received words and existing open question without legal claims', () => {
  const reply = createGuideConversationResponse(
    'The landlord changed the lock yesterday.',
    'When did you last have access to the home?',
    'English',
  );
  assert.match(reply, /The landlord changed the lock yesterday/);
  assert.match(reply, /When did you last have access/);
  assert.match(reply, /draft until you review and confirm/);
  assert.doesNotMatch(reply, /you have a claim|this violates the law/i);

  const hindiReply = createGuideConversationResponse('मुझे घर से बाहर कर दिया', undefined, 'Hindi');
  assert.match(hindiReply, /मुझे घर से बाहर कर दिया/);
  assert.match(hindiReply, /ड्राफ़्ट/);
});

test('voice Guide action proposals resolve only to actions currently available in the runtime', () => {
  const availableActions = [
    { type: 'NAVIGATE', payload: { caseId: 'case-1', target: 'documents' } },
    { type: 'SHOW_TWIN', payload: { caseId: 'case-1' } },
  ];

  assert.equal(resolveGuideActionProposal('SHOW_TWIN', availableActions), availableActions[1]);
  assert.equal(resolveGuideActionProposal('OPEN_JOURNEY', availableActions), undefined);
  assert.equal(resolveGuideActionProposal(null, availableActions), undefined);
  assert.equal(resolveGuideActionProposal(undefined, []), undefined);
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


test('the entire voice workspace remounts per case so transcript and conversation state cannot bleed', () => {
  assert.match(voicePage, /<VoiceCaseClient\s+key=\{id\}\s+id=\{id\}\s*\/>/);
});


test('Guide finding focus validates the target document before navigation', () => {
  assert.deepEqual(
    validateGuideActionCommand({ type: 'highlightEvidence', findingId: 'finding-1', documentId: 'document-1' }),
    { ok: true, command: { type: 'highlightEvidence', findingId: 'finding-1', documentId: 'document-1' } },
  );
  assert.deepEqual(
    validateGuideActionCommand({ type: 'highlightEvidence', findingId: 'finding-1' }),
    { ok: true, command: { type: 'highlightEvidence', findingId: 'finding-1' } },
  );
  assert.equal(validateGuideActionCommand({ type: 'highlightEvidence', findingId: 'finding-1', documentId: ' ' }).ok, false);
  assert.equal(validateGuideActionCommand({ type: 'highlightEvidence', findingId: ' '.repeat(2) }).ok, false);
});

test('Guide Twin commands accept bounded identifiers and valid timestamps only', () => {
  assert.deepEqual(
    validateGuideActionCommand({ type: 'selectTwinNode', nodeId: 'fact:deposit-1', ignored: true }),
    { ok: true, command: { type: 'selectTwinNode', nodeId: 'fact:deposit-1' } },
  );
  assert.deepEqual(
    validateGuideActionCommand({ type: 'selectTimeline', timestamp: '2026-10-08T10:00:00+05:30' }),
    { ok: true, command: { type: 'selectTimeline', timestamp: '2026-10-08T10:00:00+05:30' } },
  );
  assert.deepEqual(
    validateGuideActionCommand({ type: 'selectTimeline', timestamp: 1791433800000 }),
    { ok: true, command: { type: 'selectTimeline', timestamp: 1791433800000 } },
  );
  assert.equal(validateGuideActionCommand({ type: 'selectTwinNode', nodeId: '   ' }).ok, false);
  assert.equal(validateGuideActionCommand({ type: 'selectTwinNode', nodeId: 'x'.repeat(513) }).ok, false);
  assert.equal(validateGuideActionCommand({ type: 'selectTimeline', timestamp: 'not-a-date' }).ok, false);
  assert.equal(validateGuideActionCommand({ type: 'selectTimeline', timestamp: Number.NaN }).ok, false);
});


test('Guide bridge forwards the finding and case document IDs to its validated adapter', async () => {
  const calls = [];
  const bridge = createGuideActionBridge({
    highlightEvidence: (findingId, documentId) => calls.push({ findingId, documentId }),
  });
  const result = await bridge.dispatchUntrusted({
    type: 'highlightEvidence',
    findingId: 'finding-1',
    documentId: 'document-1',
    ignored: true,
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(calls, [{ findingId: 'finding-1', documentId: 'document-1' }]);
});


test('case-bound Guide actions reject stale or mismatched active case state', () => {
  assert.match(guideRuntimeProvider, /caseState && caseState\.id === caseId/);
  assert.match(guideRuntimeProvider, /route\.caseId !== caseId/);
  assert.ok((guideRuntimeProvider.match(/activeCaseUnavailable\(\)/g) ?? []).length >= 8);
});

test('Guide legal-grounding actions open only a source record returned for the active case', () => {
  assert.match(guideRuntimeProvider, /recordIds\.length === 1/);
  assert.match(guideRuntimeProvider, /caseState\.analysis\?\.legalKnowledge\.records\.some/);
  assert.match(guideRuntimeProvider, /#legal-record-\$\{encodeURIComponent\(recordId\)\}/);
  assert.match(legalSourceCandidates, /id=\{\x60legal-record-\$\{encodeURIComponent\(record\.id\)\}\x60\}/);
});


test('Guide opens Legal Advisory when there is no single source record to focus', async () => {
  assert.deepEqual(
    validateGuideActionCommand({ type: 'openLegalAdvisory', ignored: true }),
    { ok: true, command: { type: 'openLegalAdvisory' } },
  );
  let opened = 0;
  const bridge = createGuideActionBridge({
    openLegalAdvisory: () => { opened += 1; },
  });
  const result = await bridge.dispatchUntrusted({ type: 'openLegalAdvisory' });
  assert.equal(result.status, 'success');
  assert.equal(opened, 1);
  assert.match(guideRuntimeProvider, /recordIds\.length === 1[\s\S]*?openLegalGrounding[\s\S]*?: \{ type: 'openLegalAdvisory' \}/);
  assert.match(persistentLegalAdvisory, /addEventListener\(OPEN_LEGAL_ADVISORY_EVENT, openFromGuide\)/);
  assert.match(persistentLegalAdvisory, /const openFromGuide = \(\) => \{\s*if \(document\.activeElement instanceof HTMLElement\) \{\s*previousFocusRef\.current = document\.activeElement;\s*\}\s*setOpen\(true\);\s*\};/);
  assert.match(persistentLegalAdvisory, /if \(!open\) return;\s*const frame = window\.requestAnimationFrame\(\(\) => \{\s*void loadAdvisory\(\);/);
});


test('a newer Guide turn aborts older text and voice requests without crossing case boundaries', () => {
  const caseId = 'guide-turn-ordering-test';
  const otherCaseId = 'guide-turn-ordering-other-case';
  clearGuideSession(caseId);
  clearGuideSession(otherCaseId);
  const first = beginGuideTurn(caseId);
  const independent = beginGuideTurn(otherCaseId);
  const second = beginGuideTurn(caseId);

  assert.equal(first.signal.aborted, true);
  assert.equal(isGuideTurnCurrent(caseId, first), false);
  assert.equal(isGuideTurnCurrent(caseId, second), true);
  assert.equal(isGuideTurnCurrent(otherCaseId, independent), true);
  assert.equal(independent.signal.aborted, false);
  assert.equal(getGuideSessionSnapshot(caseId).requestSequence, second.sequence);
  finishGuideTurn(caseId, second);
  assert.equal(second.signal.aborted, false);
  const pendingAtClear = beginGuideTurn(caseId);
  clearGuideSession(caseId);
  assert.equal(pendingAtClear.signal.aborted, true);
  assert.equal(isGuideTurnCurrent(caseId, pendingAtClear), false);

  const switchedCaseRequest = beginGuideTurn(otherCaseId);
  invalidateGuideTurn(otherCaseId);
  assert.equal(switchedCaseRequest.signal.aborted, true);
  assert.equal(isGuideTurnCurrent(otherCaseId, switchedCaseRequest), false);

  assert.match(guideSessionSource, /export function beginGuideTurn/);
  assert.match(guideSessionSource, /export function finishGuideTurn/);
  assert.match(guideSessionSource, /export function invalidateGuideTurn/);
  assert.match(guideSessionSource, /pendingTurnRequests\.get\(caseId\)\?\.abort\(\)/);
  assert.match(voiceConversationSource, /const turnToken = beginGuideTurn\(caseId\)/);
  assert.match(voiceConversationSource, /turnToken\.signal/);
  assert.match(voiceConversationSource, /finishGuideTurn\(caseId, turnToken\)/);
  assert.match(guideControlSurfaceSource, /const turnToken = beginGuideTurn\(caseId\)/);
  assert.match(guideControlSurfaceSource, /turnToken\.signal/);
  assert.match(guideControlSurfaceSource, /finishGuideTurn\(caseId, turnToken\)/);
  assert.match(guideControlSurfaceSource, /observedSessionRequestSequenceRef\.current === sessionRequestSequence/);
  assert.match(guideApiSource, /sessionSignal\?: AbortSignal/);
  assert.match(guideApiSource, /sessionSignal\?\.addEventListener\('abort', abortFromSession/);
});

test('voice conversation preserves an unavailable local assistant response status', () => {
  assert.match(voiceConversationSource, /responseStatus = result\.status/);
});

test('desktop Guide microphone prefers configured local transcription and keeps browser fallback', () => {
  assert.match(voiceConversationSource, /getVoiceProviderAvailability/);
  assert.match(voiceConversationSource, /availability\.processingLocation === 'local'/);
  assert.match(voiceConversationSource, /new MediaRecorder\(acquiredStream\)/);
  assert.match(voiceConversationSource, /transcribeVoiceAudio\(audio, controller\.signal\)/);
  assert.match(voiceConversationSource, /provider: 'server'/);
  assert.match(voiceConversationSource, /const Recognition = recognitionConstructor\(\)/);
  assert.match(voiceConversationSource, /Confirm transcript and send to Guide/);
  assert.match(voiceConversationSource, /transcriptionAbortRef\.current\?\.abort\(\)/);
});


test('Legal Advisory distinguishes catalog record status from source verification and freshness', () => {
  assert.match(persistentLegalAdvisorySource, /sourceVerificationStatus/);
  assert.match(persistentLegalAdvisorySource, /sourceVerificationEvidence/);
  assert.match(persistentLegalAdvisorySource, /Identity verification evidence:/);
  assert.match(persistentLegalAdvisorySource, /Freshness review evidence:/);
  assert.match(persistentLegalAdvisorySource, /sourceFreshnessStatus/);
  assert.match(persistentLegalAdvisorySource, /sourceFreshnessCheckedAt/);
  assert.match(persistentLegalAdvisorySource, /sourceFreshnessEvidence/);
  assert.match(persistentLegalAdvisorySource, /Freshness review recorded/);
  assert.match(persistentLegalAdvisorySource, /timeZoneName: 'short'/);
  assert.match(persistentLegalAdvisorySource, /year: 'numeric'/);
  assert.doesNotMatch(persistentLegalAdvisorySource, /dateStyle:/);
  assert.match(persistentLegalAdvisorySource, /sourceApplicabilityStatus/);
  assert.match(persistentLegalAdvisorySource, /jurisdictionMatchStatus/);
  assert.match(persistentLegalAdvisorySource, /Source verification and freshness/);
  assert.match(persistentLegalAdvisorySource, /Knowledge-record status:/);
  assert.match(persistentLegalAdvisorySource, /sourceGovernanceNeedsAttention/);
  assert.match(persistentLegalAdvisorySource, /Candidate records present · source review incomplete/);
  assert.match(persistentLegalAdvisorySource, /legal_document/);
  assert.match(persistentLegalAdvisorySource, /sourceApplicabilityStatus, 'applicability_not_established'\) !== 'potentially_relevant'/);
});

test('clearing the shared case session resets pending text Guide UI across routes', () => {
  assert.match(guideControlSurfaceSource, /requestSequence: sessionRequestSequence/);
  assert.match(guideControlSurfaceSource, /beginGuideTurn\(caseId\)/);
  assert.match(guideControlSurfaceSource, /isGuideTurnCurrent\(caseId, turnToken\)/);
  assert.match(guideControlSurfaceSource, /observedSessionRequestSequenceRef\.current === sessionRequestSequence/);
  assert.match(guideControlSurfaceSource, /activeSessionRequestRef\.current === sessionRequestSequence/);
  assert.match(guideControlSurfaceSource, /clearSession\(\)/);
});

test('Guide workspace always exposes Legal Advisory based on information so far', () => {
  assert.match(guideWorkspaceSource, /Legal Advisory/);
  assert.match(guideWorkspaceSource, /Decision based on information so far/);
  assert.match(guideWorkspaceSource, /window\.dispatchEvent\(new Event\(OPEN_LEGAL_ADVISORY_EVENT\)\)/);
});


test('drafting source suggestions require explicit verification metadata', () => {
  assert.match(draftingStudio, /record\.sourceFreshnessStatus !== 'current'/);
  assert.match(draftingStudio, /!record\.sourceFreshnessCheckedAt\?\.trim\(\)/);
  assert.match(draftingStudio, /!record\.sourceFreshnessEvidence\?\.trim\(\)/);
  assert.match(draftingStudio, /record\.jurisdictionMatchStatus !== 'matched'/);
  assert.match(draftingStudio, /item\.record\.sourceFreshnessStatus === 'current'/);
  assert.match(draftingStudio, /item\.record\.jurisdictionMatchStatus === 'matched'/);
  assert.doesNotMatch(draftingStudio, /!item\.record\.sourceVerificationStatus/);
});


test('Legal Advisory is a distinct always-available Guide action', () => {
  assert.match(guideActionRegistrySource, /type: 'OPEN_LEGAL_ADVISORY'[\s\S]*?caseState\s*\?\s*\[\{ type: 'OPEN_LEGAL_ADVISORY'/);
  assert.match(guideRuntimeProvider, /case 'OPEN_LEGAL_ADVISORY':\s*return \{ type: 'openLegalAdvisory' \}/);
  assert.match(guideClientSource, /case 'OPEN_LEGAL_ADVISORY'/);
  assert.match(guideControlSurfaceSource, /case 'OPEN_LEGAL_ADVISORY'/);
  assert.match(voiceConversationSource, /proposedAction\.type === 'OPEN_LEGAL_ADVISORY' \? 'Legal Advisory'/);
  assert.match(localAssistantSource, /OPEN_LEGAL_ADVISORY/);
  assert.match(guideRouteSource, /OPEN_LEGAL_ADVISORY/);
  assert.match(apiClientSource, /'OPEN_LEGAL_ADVISORY'/);
});


test('Guide surfaces local model readiness without a cloud fallback', () => {
  assert.match(apiClientSource, /getGuideModelStatus/);
  assert.match(guideRouteSource, /@router\.get\("\/status"/);
  assert.match(localAssistantSource, /def check_local_model_status/);
  assert.match(guideModelStatusBanner, /role="status"/);
  assert.match(guideModelStatusBanner, /Guide chat does not fall back to a cloud model/);
  assert.match(guideControlSurfaceSource, /<GuideModelStatusBanner \/>/);
  assert.match(voiceConversationSource, /<GuideModelStatusBanner \/>/);
});


test('shared Guide session deduplicates turn IDs and excludes unavailable assistant replies from model history', () => {
  const caseId = 'guide-session-turn-retention-test';
  clearGuideSession(caseId);
  const initialGeneration = getGuideSessionSnapshot(caseId).generation;

  appendGuideSessionTurn(caseId, {
    id: 'confirmed-voice-turn',
    role: 'user',
    content: 'The employer confirmed the salary due date.',
    inputMode: 'voice',
  });
  appendGuideSessionTurn(caseId, {
    id: 'confirmed-voice-turn',
    role: 'user',
    content: 'This duplicate must not replace the original.',
    inputMode: 'text',
  });
  appendGuideSessionTurn(caseId, {
    id: 'unavailable-reply',
    role: 'assistant',
    content: 'The local Guide is unavailable.',
    inputMode: 'voice',
    status: 'unavailable',
  });
  appendGuideSessionTurn(caseId, {
    id: 'confirmation-reply',
    role: 'assistant',
    content: 'I have added this statement to the case after your confirmation.',
    inputMode: 'voice',
    status: 'ok',
  });

  const snapshot = getGuideSessionSnapshot(caseId);
  assert.equal(snapshot.turns.length, 3);
  assert.equal(snapshot.turns[0].content, 'The employer confirmed the salary due date.');
  assert.equal(snapshot.turns[0].inputMode, 'voice');
  assert.deepEqual(
    getGuideConversationHistory(caseId),
    [
      { role: 'user', content: 'The employer confirmed the salary due date.' },
      { role: 'assistant', content: 'I have added this statement to the case after your confirmation.' },
    ],
  );

  clearGuideSession(caseId);
  const cleared = getGuideSessionSnapshot(caseId);
  assert.equal(cleared.turns.length, 0);
  assert.ok(cleared.generation > initialGeneration);
});


test('dedicated voice statement drafts enter shared Guide history only after successful explicit confirmation', () => {
  const commitStart = voiceCaseClientSource.indexOf('const commitTranscript = async () =>');
  const acceptedIndex = voiceCaseClientSource.indexOf('const accepted = replaceCaseState(response.caseState);', commitStart);
  const rejectionIndex = voiceCaseClientSource.indexOf('if (!accepted)', acceptedIndex);
  const appendIndex = voiceCaseClientSource.indexOf("appendTurn({", rejectionIndex);
  const pendingCommitIndex = voiceCaseClientSource.indexOf('setPendingCommit({', appendIndex);

  assert.ok(commitStart >= 0);
  assert.ok(acceptedIndex > commitStart);
  assert.ok(rejectionIndex > acceptedIndex);
  assert.ok(appendIndex > rejectionIndex);
  assert.ok(pendingCommitIndex > appendIndex);
  assert.match(voiceCaseClientSource, /role: 'user',[\s\S]*?content: committedTranscript\.trim\(\),[\s\S]*?inputMode: 'voice'/);
  assert.match(voiceCaseClientSource, /role: 'assistant',[\s\S]*?I have added this statement to the case after your confirmation/);
  assert.match(voiceCaseClientSource, /const \{ language: sessionLanguage, setLanguage: setSessionLanguage, appendTurn \} = useGuideSession\(id\)/);
});


test('shared Guide session rejects malformed or oversized persisted turn data at its boundary', () => {
  const caseId = 'guide-session-validation-test';
  clearGuideSession(caseId);
  const appendUntrusted = (turn) => appendGuideSessionTurn(caseId, turn);

  appendUntrusted({ id: 'valid-user', role: 'user', content: 'A reviewed statement.', inputMode: 'text' });
  appendUntrusted({ id: 'bad-role', role: 'system', content: 'Must not enter history.', inputMode: 'text' });
  appendUntrusted({ id: 'bad-status', role: 'assistant', content: 'Invalid status.', inputMode: 'text', status: 'trusted' });
  appendUntrusted({ id: 'bad-action', role: 'assistant', content: 'Invalid action.', inputMode: 'text', proposedAction: 'RUN_ARBITRARY_CODE' });
  appendUntrusted({ id: 'bad-audio', role: 'assistant', content: 'Invalid audio state.', inputMode: 'text', audio: 'auto_send' });
  appendUntrusted({ id: 'oversized-id-' + 'x'.repeat(220), role: 'user', content: 'Oversized identifier.', inputMode: 'text' });
  appendUntrusted({ id: 'oversized-content', role: 'user', content: 'x'.repeat(10_001), inputMode: 'text' });
  appendUntrusted({ id: 'empty-content', role: 'user', content: '   ', inputMode: 'text' });

  const turns = getGuideSessionSnapshot(caseId).turns;
  assert.deepEqual(turns.map((turn) => turn.id), ['valid-user']);
  assert.deepEqual(getGuideConversationHistory(caseId), [
    { role: 'user', content: 'A reviewed statement.' },
  ]);
});


test('text Guide offers non-destructive cancellation that invalidates the shared request', () => {
  assert.match(guideControlSurfaceSource, /function stopChat\(\)/);
  assert.match(guideControlSurfaceSource, /invalidateGuideTurn\(caseId\)/);
  assert.match(guideControlSurfaceSource, /Stop the current Guide response/);
  assert.match(guideControlSurfaceSource, /Your message remains in this session/);
  assert.match(guideControlSurfaceSource, /status: 'unavailable'/);
});

test('invalidating a pending Guide turn aborts work but preserves the confirmed session transcript', () => {
  const caseId = 'guide-stop-preserves-session';
  clearGuideSession(caseId);
  appendGuideSessionTurn(caseId, {
    id: 'confirmed-before-stop',
    role: 'user',
    content: 'I want to understand my notice.',
    inputMode: 'text',
  });
  const pending = beginGuideTurn(caseId);
  invalidateGuideTurn(caseId);
  assert.equal(pending.signal.aborted, true);
  assert.equal(isGuideTurnCurrent(caseId, pending), false);
  assert.deepEqual(getGuideSessionSnapshot(caseId).turns.map((turn) => turn.id), ['confirmed-before-stop']);
  clearGuideSession(caseId);
});

test('Guide action execution is serialized even if multiple surfaces activate the same control', () => {
  assert.match(guideRuntimeProvider, /const actionExecutionRef = useRef\(false\)/);
  assert.match(guideRuntimeProvider, /if \(actionExecutionRef\.current\) return null/);
  assert.match(guideRuntimeProvider, /actionExecutionRef\.current = true/);
  assert.match(guideRuntimeProvider, /actionExecutionRef\.current = false/);
  assert.match(guideRuntimeProvider, /dispatch\(\{ type: 'GUIDE_ACTION_SELECTED', action \}\)/);
});

test('Guide always exposes a direct current-case Legal Advisory action', () => {
  assert.match(guideControlSurfaceSource, /snapshot\.availableActions\.find\(\(action\) => action\.type === 'OPEN_LEGAL_ADVISORY'\)/);
  assert.match(guideControlSurfaceSource, /Get Legal Advisory using current case information/);
  assert.match(guideControlSurfaceSource, /runAction\(legalAdvisoryAction\)/);
});

test('text Guide transport failures are recorded as unavailable shared-session turns', () => {
  const catchBlock = guideControlSurfaceSource.slice(
    guideControlSurfaceSource.indexOf('} catch {'),
    guideControlSurfaceSource.indexOf('} finally {'),
  );
  assert.match(catchBlock, /status: 'unavailable'/);
  assert.match(catchBlock, /appendTurn\(/);
  assert.match(catchBlock, /No cloud fallback was used/);
});

test('text and voice Guide surfaces use the same case-scoped message transport', () => {
  assert.match(voiceConversationSource, /sendCaseScopedGuideMessage/);
  assert.match(guideControlSurfaceSource, /sendCaseScopedGuideMessage/);
  assert.doesNotMatch(voiceConversationSource, /sendGuideMessage\(/);
  assert.doesNotMatch(guideControlSurfaceSource, /sendGuideMessage\(/);
  assert.match(guideControlSurfaceSource, /status: 'unavailable'/);
});

test('text and voice Guide requests share one case-scoped history and model-action context', () => {
  const caseId = 'guide-chat-context-test';
  clearGuideSession(caseId);
  appendGuideSessionTurn(caseId, {
    id: 'context-user', role: 'user', content: 'My landlord kept the deposit.', inputMode: 'text',
  });
  appendGuideSessionTurn(caseId, {
    id: 'context-unavailable', role: 'assistant', content: 'Local model unavailable.', inputMode: 'voice', status: 'unavailable',
  });
  appendGuideSessionTurn(caseId, {
    id: 'context-assistant', role: 'assistant', content: 'When did the tenancy end?', inputMode: 'voice', status: 'ok',
  });

  const advisory = { type: 'OPEN_LEGAL_ADVISORY', payload: { caseId } };
  const speech = { type: 'SPEAK_RESPONSE', payload: { response: { id: 'response-1', text: 'Read this aloud.' } } };
  const context = createGuideChatContext(caseId, [advisory, speech, advisory]);

  assert.deepEqual(context.conversationHistory, [
    { role: 'user', content: 'My landlord kept the deposit.' },
    { role: 'assistant', content: 'When did the tenancy end?' },
  ]);
  assert.deepEqual(context.availableActions, ['OPEN_LEGAL_ADVISORY']);
  assert.equal(context.availableActions.includes('SPEAK_RESPONSE'), false);
});


test('every Guide surface uses the professional feminine AI portrait and not the old illustrated avatar', () => {
  assert.match(guidePresenceSource, /lawsense-guide-feminine\.webp/);
  assert.doesNotMatch(guidePresenceSource, /AvatarSurface|IllustratedAvatarRenderer|ILLUSTRATED GUIDE/);
  assert.match(guidePresenceSource, /<Image/);
  assert.doesNotMatch(guidePresenceSource, /portraitStatus/);
});


test('Guide model status recovers automatically when Ollama starts after the page is open', () => {
  assert.match(guideModelStatusBanner, /window\.setInterval/);
  assert.match(guideModelStatusBanner, /15_000/);
  assert.match(guideModelStatusBanner, /window\.clearInterval/);
});
