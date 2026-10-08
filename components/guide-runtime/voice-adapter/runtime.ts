import type { GuidePresenceState } from '@/components/guide-presence/types';
import type { GuideEvent, GuideResponse, GuideRuntimeResult } from '../types';
import type { GuideVoiceEvent } from './events';

export type GuideVoiceVisualState = Extract<GuidePresenceState, 'IDLE' | 'LISTENING' | 'PROCESSING' | 'EXPLAINING' | 'ASKING' | 'SPEAKING' | 'ERROR'>;

export interface GuideVoiceSnapshot {
  visualState: GuideVoiceVisualState;
  detail: string;
}

export interface GuideVoiceRuntimeAdapter {
  subscribe(listener: () => void): () => void;
  getSnapshot(): GuideVoiceSnapshot;
  emit(event: GuideVoiceEvent): GuideVoiceSnapshot;
  responseReady(response: GuideResponse): GuideVoiceSnapshot;
  startNewInteraction(): GuideVoiceSnapshot;
}

export type GuideRuntimeDispatch = (event: GuideEvent) => GuideRuntimeResult;

function runtimeEventFor(event: GuideVoiceEvent): GuideEvent {
  switch (event.type) {
    case 'capture_started':
      return { type: 'GUIDE_USER_INPUT_STARTED' };
    case 'capture_cancelled':
    case 'transcript_received':
    case 'transcript_edited':
    case 'review_ready':
    case 'confirmation_requested':
      return { type: 'GUIDE_RESET' };
    case 'capture_failed':
    case 'commit_failed':
    case 'speech_failed':
    case 'review_failed':
      return { type: 'GUIDE_ERROR', message: event.detail };
    case 'review_started':
    case 'confirmation_accepted':
      return { type: 'GUIDE_PROCESSING_STARTED' };
    case 'case_state_updated':
      return { type: 'CASE_STATE_UPDATED', caseState: event.caseState };
    case 'speech_started':
      return { type: 'GUIDE_SPEECH_STARTED' };
    case 'speech_paused':
    case 'speech_finished':
    case 'speech_cancelled':
    case 'speech_unavailable':
      return { type: 'GUIDE_SPEECH_ENDED' };
    default: {
      const exhaustiveEvent: never = event;
      return exhaustiveEvent;
    }
  }
}

function visualFor(event: GuideVoiceEvent): GuideVoiceSnapshot {
  switch (event.type) {
    case 'capture_started':
      return { visualState: 'LISTENING', detail: 'Listening to your statement. Stop when you are done.' };
    case 'transcript_received':
      return { visualState: 'ASKING', detail: 'Transcript received. Review and edit it before continuing.' };
    case 'transcript_edited':
      return { visualState: 'ASKING', detail: 'Your transcript is an editable draft. Review it before confirming.' };
    case 'review_started':
      return { visualState: 'PROCESSING', detail: 'Reviewing the transcript. It is still an unconfirmed draft.' };
    case 'review_ready':
      return { visualState: 'ASKING', detail: 'Draft details are ready to review. Nothing has been saved.' };
    case 'review_failed':
      return { visualState: 'ERROR', detail: event.detail };
    case 'confirmation_requested':
      return { visualState: 'ASKING', detail: 'Review the statement and confirm when you are ready to add it.' };
    case 'confirmation_accepted':
      return { visualState: 'PROCESSING', detail: 'Adding the statement you confirmed to the case.' };
    case 'case_state_updated':
      return { visualState: 'PROCESSING', detail: 'The Guide is responding to the updated case record.' };
    case 'speech_started':
      return { visualState: 'SPEAKING', detail: 'Speaking the response. The text remains available to read.' };
    case 'speech_paused':
      return { visualState: 'EXPLAINING', detail: 'Response paused. Resume or read the text below.' };
    case 'speech_finished':
      return { visualState: 'EXPLAINING', detail: 'Response complete. Replay it or continue with another statement.' };
    case 'speech_cancelled':
      return { visualState: 'EXPLAINING', detail: 'Speech stopped. The response remains available to read.' };
    case 'speech_unavailable':
      return { visualState: 'EXPLAINING', detail: 'Speech is unavailable here. The response text remains available.' };
    case 'capture_cancelled':
      return event.transcriptRetained
        ? { visualState: 'ASKING', detail: 'The active take was discarded. Your existing transcript is still here.' }
        : { visualState: 'IDLE', detail: 'The active take was discarded. No case changes were made.' };
    case 'capture_failed':
    case 'commit_failed':
    case 'speech_failed':
      return { visualState: 'ERROR', detail: event.detail };
    default: {
      const exhaustiveEvent: never = event;
      return exhaustiveEvent;
    }
  }
}

/** Forwards voice milestones to the shared Guide Runtime and tracks voice presentation state. */
export function createGuideVoiceRuntimeAdapter(
  dispatch: GuideRuntimeDispatch,
): GuideVoiceRuntimeAdapter {
  const listeners = new Set<() => void>();
  let visual: GuideVoiceSnapshot = {
    visualState: 'ASKING',
    detail: 'Tell the Guide what happened. You can speak or type; nothing is saved until you confirm.',
  };

  const publish = (next: GuideVoiceSnapshot): GuideVoiceSnapshot => {
    visual = next;
    listeners.forEach((listener) => listener());
    return visual;
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => visual,
    emit: (event) => {
      dispatch(runtimeEventFor(event));
      return publish(visualFor(event));
    },
    responseReady: () => {
      return publish({ visualState: 'EXPLAINING', detail: 'Guide response ready. Choose Play to hear it.' });
    },
    startNewInteraction: () => {
      dispatch({ type: 'GUIDE_RESET' });
      return publish({
        visualState: 'ASKING',
        detail: 'Tell the Guide what happened. You can speak or type; nothing is saved until you confirm.',
      });
    },
  };
}
