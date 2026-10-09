import type { GuidePresenceState } from '@/components/guide-presence/types';
import { guidePresenceStateFromSnapshot } from '../presence';
import type { GuideEvent, GuideResponse, GuideRuntimeResult } from '../types';
import type { GuideVoiceEvent } from './events';
import { guideVoiceSnapshotForEvent } from './visual-state';
import type { GuideVoiceSnapshot } from './visual-state';

export type { GuideVoiceSnapshot } from './visual-state';

export type GuideVoiceVisualState = GuidePresenceState;

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
      return { type: 'GUIDE_SPEECH_PAUSED' };
    case 'speech_cancelled':
      return { type: 'GUIDE_SPEECH_INTERRUPTED' };
    case 'speech_finished':
    case 'speech_unavailable':
      return { type: 'GUIDE_SPEECH_ENDED' };
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
    visualState: 'CLARIFYING',
    detail: 'Tell the Guide what happened. You can speak or type; nothing is saved until you confirm.',
    speechState: 'idle',
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
      const result = dispatch(runtimeEventFor(event));
      return publish(guideVoiceSnapshotForEvent(
        event,
        guidePresenceStateFromSnapshot(result.snapshot),
        result.snapshot.speechState,
      ));
    },
    responseReady: () => {
      return publish({ visualState: 'IDLE', detail: 'Guide response ready. Choose Play to hear it.', speechState: 'idle' });
    },
    startNewInteraction: () => {
      dispatch({ type: 'GUIDE_RESET' });
      return publish({
        visualState: 'CLARIFYING',
        detail: 'Tell the Guide what happened. You can speak or type; nothing is saved until you confirm.',
        speechState: 'idle',
      });
    },
  };
}
