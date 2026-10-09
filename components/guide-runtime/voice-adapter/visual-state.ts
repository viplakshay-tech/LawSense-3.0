import type { GuidePresenceState } from '@/components/guide-presence/types';
import type { AvatarSpeechState } from '@/components/guide-presence/avatar/types';
import type { GuideVoiceEvent } from './events';

export interface GuideVoiceSnapshot {
  visualState: GuidePresenceState;
  detail: string;
  speechState: AvatarSpeechState;
}

/** Keeps call presentation tied to the latest voice milestone and Runtime state. */
export function guideVoiceSnapshotForEvent(
  event: GuideVoiceEvent,
  runtimeState: GuidePresenceState,
  runtimeSpeechState: AvatarSpeechState,
): GuideVoiceSnapshot {
  switch (event.type) {
    case 'capture_started':
      return { visualState: 'LISTENING', detail: 'Listening to your statement. Stop when you are done.', speechState: 'idle' };
    case 'transcript_received':
      return { visualState: 'CLARIFYING', detail: 'Transcript received. Review and edit it before continuing.', speechState: 'idle' };
    case 'transcript_edited':
      return { visualState: 'CLARIFYING', detail: 'Your transcript is an editable draft. Review it before confirming.', speechState: 'idle' };
    case 'review_started':
      return { visualState: 'THINKING', detail: 'Reviewing the transcript. It is still an unconfirmed draft.', speechState: 'idle' };
    case 'review_ready':
      return { visualState: 'CLARIFYING', detail: 'Draft details are ready to review. Nothing has been saved.', speechState: 'idle' };
    case 'review_failed':
      return { visualState: 'ACTION_REQUIRED', detail: event.detail, speechState: 'idle' };
    case 'confirmation_requested':
      return { visualState: 'CLARIFYING', detail: 'Review the statement and confirm when you are ready to add it.', speechState: 'idle' };
    case 'confirmation_accepted':
      return { visualState: 'THINKING', detail: 'Adding the statement you confirmed to the case.', speechState: 'idle' };
    case 'case_state_updated':
      return { visualState: runtimeState, detail: 'The Guide is responding to the updated case record.', speechState: runtimeSpeechState };
    case 'speech_started':
      return { visualState: 'SPEAKING', detail: 'Speaking the response. The text remains available to read.', speechState: 'speaking' };
    case 'speech_paused':
      return { visualState: runtimeState, detail: 'Response paused. Resume or read the text below.', speechState: 'paused' };
    case 'speech_finished':
      return { visualState: runtimeState, detail: 'Response complete. Replay it or continue with another statement.', speechState: 'idle' };
    case 'speech_cancelled':
      return { visualState: runtimeState, detail: 'Speech stopped. The response remains available to read.', speechState: 'interrupted' };
    case 'speech_unavailable':
      return { visualState: runtimeState, detail: 'Speech is unavailable here. The response text remains available.', speechState: 'idle' };
    case 'capture_cancelled':
      return event.transcriptRetained
        ? { visualState: 'CLARIFYING', detail: 'The active take was discarded. Your existing transcript is still here.', speechState: 'idle' }
        : { visualState: runtimeState, detail: 'The active take was discarded. No case changes were made.', speechState: 'idle' };
    case 'capture_failed':
    case 'commit_failed':
    case 'speech_failed':
      return { visualState: 'ACTION_REQUIRED', detail: event.detail, speechState: 'idle' };
    default: {
      const exhaustiveEvent: never = event;
      return exhaustiveEvent;
    }
  }
}
