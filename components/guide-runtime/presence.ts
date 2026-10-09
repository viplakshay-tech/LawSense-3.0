import { GUIDE_PRESENTATION_CONTRACT } from '@/components/guide-presence/presentation-contract';
import type { CanonicalGuidePresenceState } from '@/components/guide-presence/types';
import { deriveGuideState } from './state';
import type { GuideRuntimeSnapshot } from './types';
import type { GuidePresentationModel } from './presentation';

interface GuideActivityMessage {
  kind: 'system' | 'action' | 'error';
  text: string;
}

export interface GuideContextualMessage {
  text: string;
  priority: number;
}

export function guidePresenceStateFromState(
  state: GuideRuntimeSnapshot['state'],
): CanonicalGuidePresenceState {
  switch (state.name) {
    case 'listening': return 'LISTENING';
    case 'processing': return 'THINKING';
    case 'speaking': return 'SPEAKING';
    case 'asking': return 'CLARIFYING';
    case 'uncertain': return 'UNCERTAIN';
    case 'action':
    case 'error': return 'ACTION_REQUIRED';
    case 'safety': {
      const safety = state.safetyContext;
      return safety?.urgency === 'urgent' || safety?.context === 'urgent_safety_context'
        ? 'IMMEDIATE_DANGER'
        : 'SAFETY';
    }
    case 'conflict': return 'CONFLICT';
    case 'idle':
    case 'explaining':
    case 'evidence':
    case 'grounded':
    case 'completion': return 'IDLE';
    default: {
      const exhaustiveState: never = state.name;
      return exhaustiveState;
    }
  }
}

/**
 * Maps canonical case/runtime state to the finite human-facing presentation
 * contract. Safety and conflict state from CaseState take priority over an
 * active interaction state such as listening or speaking.
 */
export function guidePresenceStateFromSnapshot(
  snapshot: GuideRuntimeSnapshot,
): CanonicalGuidePresenceState {
  const caseState = deriveGuideState(snapshot.caseState);
  if (caseState.name === 'safety') {
    const safety = caseState.safetyContext;
    return safety?.urgency === 'urgent' || safety?.context === 'urgent_safety_context'
      ? 'IMMEDIATE_DANGER'
      : 'SAFETY';
  }
  if (caseState.name === 'conflict' || snapshot.state.name === 'conflict') return 'CONFLICT';

  return guidePresenceStateFromState(snapshot.state);
}

function messageForState(
  state: CanonicalGuidePresenceState,
  snapshot: GuideRuntimeSnapshot,
  model: GuidePresentationModel,
): string {
  switch (state) {
    case 'IMMEDIATE_DANGER':
      return model.safetySummary ?? 'The case record contains urgent safety context.';
    case 'SAFETY':
      return model.safetySummary ?? 'Safety context is recorded for this case.';
    case 'CONFLICT':
      return model.conflicts[0] ?? model.whyItMatters;
    case 'LISTENING':
      return 'Listening is active. You can stop voice capture when you are ready.';
    case 'THINKING':
      return 'Reviewing the current case record.';
    case 'SPEAKING':
      return snapshot.response?.text ?? 'Guide speech is active. The response remains available to read.';
    case 'CLARIFYING':
      return model.unknowns[0] ?? 'An open detail is recorded for clarification.';
    case 'UNCERTAIN':
      return model.uncertainty.detail;
    case 'ACTION_REQUIRED':
      return snapshot.state.error ?? model.nextAction?.label ?? 'Review the available Guide action.';
    case 'IDLE':
      return model.whyItMatters;
  }
}

/** Picks the highest-priority current context before recent activity copy. */
export function guideContextualMessage(
  snapshot: GuideRuntimeSnapshot,
  model: GuidePresentationModel,
  latestMessage?: GuideActivityMessage,
): GuideContextualMessage {
  const state = guidePresenceStateFromSnapshot(snapshot);
  const stateMessage = messageForState(state, snapshot, model);
  const statePriority = GUIDE_PRESENTATION_CONTRACT[state].contextualMessagePriority;
  const activityPriority = latestMessage?.kind === 'error'
    ? 72
    : latestMessage?.kind === 'action'
      ? 35
      : latestMessage
        ? 15
        : -1;

  return latestMessage && activityPriority > statePriority
    ? { text: latestMessage.text, priority: activityPriority }
    : { text: stateMessage, priority: statePriority };
}
