import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { validateGuideActionCommand } from '../../components/guide-actions/validation.ts';
import { createGuideActionBridge } from '../../components/guide-actions/bridge.ts';
import { beginGuideTurn, clearGuideSession, isGuideTurnCurrent } from '../../lib/guide-session.ts';
import { guideVoiceSnapshotForEvent } from '../../components/guide-runtime/voice-adapter/visual-state.ts';
import {
  createGuideConversationResponse,
  guideConversationPresentation,
  selectGuideSpeechVoice,
  resolveGuideActionProposal,
} from '../../components/voice/conversation.ts';

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
const voiceConversationSource = await readFile(new URL('../../components/voice/GuideConversation.tsx', import.meta.url), 'utf8');
const guideControlSurfaceSource = await readFile(new URL('../../components/guide-presence/GuideControlSurface.tsx', import.meta.url), 'utf8');
const persistentLegalAdvisory = await readFile(new URL('../../components/case-shell/PersistentLegalAdvisory.tsx', import.meta.url), 'utf8');

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
  assert.match(persistentLegalAdvisory, /const openFromGuide = \(\) => \{\s*setOpen\(true\);\s*\};/);
  assert.match(persistentLegalAdvisory, /if \(!open\) return;\s*const frame = window\.requestAnimationFrame\(\(\) => \{\s*void loadAdvisory\(\);/);
});


test('a newer Guide turn supersedes older in-flight replies across text and voice modes', () => {
  const caseId = 'guide-turn-ordering-test';
  const otherCaseId = 'guide-turn-ordering-other-case';
  const first = beginGuideTurn(caseId);
  const independent = beginGuideTurn(otherCaseId);
  const second = beginGuideTurn(caseId);

  assert.equal(isGuideTurnCurrent(caseId, first), false);
  assert.equal(isGuideTurnCurrent(caseId, second), true);
  assert.equal(isGuideTurnCurrent(otherCaseId, independent), true);
  clearGuideSession(caseId);
  assert.equal(isGuideTurnCurrent(caseId, second), false);

  assert.match(guideSessionSource, /export function beginGuideTurn/);
  assert.match(guideSessionSource, /export function isGuideTurnCurrent/);
  assert.match(guideSessionSource, /turnSequences\.set\(caseId, 0\)/);
  assert.match(voiceConversationSource, /const turnToken = beginGuideTurn\(caseId\)/);
  assert.match(voiceConversationSource, /!isGuideTurnCurrent\(caseId, turnToken\)/);
  assert.match(guideControlSurfaceSource, /const turnToken = beginGuideTurn\(caseId\)/);
  assert.match(guideControlSurfaceSource, /!isGuideTurnCurrent\(caseId, turnToken\)/);
});

test('voice conversation preserves an unavailable local assistant response status', () => {
  assert.match(voiceConversationSource, /responseStatus = result\.status/);
});


test('Legal Advisory distinguishes catalog record status from source verification and freshness', () => {
  assert.match(persistentLegalAdvisorySource, /sourceVerificationStatus/);
  assert.match(persistentLegalAdvisorySource, /sourceFreshnessStatus/);
  assert.match(persistentLegalAdvisorySource, /sourceFreshnessCheckedAt/);
  assert.match(persistentLegalAdvisorySource, /sourceFreshnessEvidence/);
  assert.match(persistentLegalAdvisorySource, /Freshness review recorded/);
  assert.match(persistentLegalAdvisorySource, /Review evidence:/);
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

test('clearing the shared case session invalidates pending text Guide replies across routes', () => {
  assert.match(guideControlSurfaceSource, /generation: sessionGeneration/);
  assert.match(guideControlSurfaceSource, /beginGuideTurn\(caseId\)/);
  assert.match(guideControlSurfaceSource, /isGuideTurnCurrent\(caseId, turnToken\)/);
  assert.match(guideControlSurfaceSource, /observedSessionGenerationRef\.current === sessionGeneration/);
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
