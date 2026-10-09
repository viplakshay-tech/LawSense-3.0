import { defaultGuideActionRegistry } from './actions';
import type { GuideActionRegistry } from './actions';
import { deriveGuideState, transitionGuideState } from './state';
import type {
  GuideActionContext,
  GuideEvent,
  GuideRuntimeEmission,
  GuideRuntimeResult,
  GuideRuntimeSnapshot,
} from './types';

function createActionContext(snapshot: GuideRuntimeSnapshot): GuideActionContext {
  return {
    caseState: snapshot.caseState,
    state: snapshot.state,
    response: snapshot.response,
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function nextSpeechState(
  current: GuideRuntimeSnapshot['speechState'],
  event: GuideEvent,
): GuideRuntimeSnapshot['speechState'] {
  switch (event.type) {
    case 'GUIDE_SPEECH_STARTED': return 'speaking';
    case 'GUIDE_SPEECH_PAUSED': return 'paused';
    case 'GUIDE_SPEECH_INTERRUPTED': return 'interrupted';
    case 'GUIDE_SPEECH_ENDED': return 'idle';
    case 'CASE_STATE_UPDATED':
    case 'CASE_STATE_CLEARED':
    case 'GUIDE_USER_INPUT_STARTED':
    case 'GUIDE_PROCESSING_STARTED':
    case 'GUIDE_RESPONSE_READY':
    case 'GUIDE_ERROR':
    case 'GUIDE_RESET':
      return current === 'speaking' || current === 'paused' ? 'interrupted' : 'idle';
    default:
      return current;
  }
}

export function createInitialGuideRuntime(
  caseState: GuideRuntimeSnapshot['caseState'] = null,
  registry: GuideActionRegistry = defaultGuideActionRegistry,
): GuideRuntimeSnapshot {
  const state = deriveGuideState(caseState);
  const snapshot: GuideRuntimeSnapshot = {
    caseState,
    state,
    availableActions: [],
    response: null,
    speechState: 'idle',
  };
  return {
    ...snapshot,
    availableActions: registry.getAvailableActions(createActionContext(snapshot)),
  };
}

/**
 * Pure orchestration step. It interprets a typed event, derives state and
 * available actions from the existing CaseState, and returns UI/action emissions.
 */
export function orchestrateGuideEvent(
  current: GuideRuntimeSnapshot,
  event: GuideEvent,
  registry: GuideActionRegistry = defaultGuideActionRegistry,
): GuideRuntimeResult {
  const responseIsEmpty =
    event.type === 'GUIDE_RESPONSE_READY' && event.response.text.trim().length === 0;
  const caseState = event.type === 'CASE_STATE_UPDATED'
    ? event.caseState
    : event.type === 'CASE_STATE_CLEARED'
      ? null
      : current.caseState;

  let response = current.response;
  if (
    event.type === 'CASE_STATE_UPDATED' ||
    event.type === 'CASE_STATE_CLEARED' ||
    event.type === 'GUIDE_USER_INPUT_STARTED' ||
    event.type === 'GUIDE_PROCESSING_STARTED' ||
    event.type === 'GUIDE_RESET'
  ) {
    response = null;
  } else if (event.type === 'GUIDE_RESPONSE_READY' && !responseIsEmpty) {
    response = event.response;
  }

  const nextState = responseIsEmpty
    ? current.state
    : transitionGuideState(current.state, event, caseState);
  const candidate: GuideRuntimeSnapshot = {
    caseState,
    state: nextState,
    availableActions: [],
    response,
    speechState: responseIsEmpty ? current.speechState : nextSpeechState(current.speechState, event),
  };
  const nextSnapshot: GuideRuntimeSnapshot = {
    ...candidate,
    availableActions: registry.getAvailableActions(createActionContext(candidate)),
  };
  const emissions: GuideRuntimeEmission[] = [];

  if (!sameValue(current.state, nextSnapshot.state)) {
    emissions.push({
      type: 'guide_state_changed',
      previous: current.state,
      current: nextSnapshot.state,
    });
  }

  if (!sameValue(current.availableActions, nextSnapshot.availableActions)) {
    emissions.push({
      type: 'available_actions_changed',
      actions: nextSnapshot.availableActions,
    });
  }

  if (current.speechState !== nextSnapshot.speechState) {
    emissions.push({
      type: 'speech_state_changed',
      previous: current.speechState,
      current: nextSnapshot.speechState,
    });
  }

  if (responseIsEmpty) {
    emissions.push({ type: 'response_rejected', reason: 'empty_text' });
  } else if (event.type === 'GUIDE_RESPONSE_READY') {
    emissions.push({ type: 'response_available', response: event.response });
  }

  if (event.type === 'GUIDE_ACTION_SELECTED') {
    const actionWasAvailable = registry.isAvailable(event.action, createActionContext(current));
    emissions.push(actionWasAvailable
      ? { type: 'action_requested', action: event.action }
      : { type: 'action_rejected', action: event.action, reason: 'not_available' });
  }

  return { snapshot: nextSnapshot, emissions };
}

export interface GuideRuntimeController {
  getSnapshot(): GuideRuntimeSnapshot;
  dispatch(event: GuideEvent): GuideRuntimeResult;
}

/** Mutable convenience wrapper around the pure orchestration function. */
export function createGuideRuntime(
  caseState: GuideRuntimeSnapshot['caseState'] = null,
  registry: GuideActionRegistry = defaultGuideActionRegistry,
): GuideRuntimeController {
  let snapshot = createInitialGuideRuntime(caseState, registry);

  return {
    getSnapshot: () => snapshot,
    dispatch: (event) => {
      const result = orchestrateGuideEvent(snapshot, event, registry);
      snapshot = result.snapshot;
      return result;
    },
  };
}
