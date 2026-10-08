'use client';

import { useCallback, useState } from 'react';
import type { GuideStateChangeEvent, GuideStateName } from '@/components/legal-guide/types';

export interface UseLegalGuideOptions {
  /** Provide `state` to let an application, backend adapter, or local model own state. */
  state?: GuideStateName;
  /** Starting state for the hook's local mode. */
  initialState?: GuideStateName;
  onStateChange?: (event: GuideStateChangeEvent) => void;
}

/**
 * State controller for the visual guide. It contains no conversation, legal logic,
 * network calls, or AI dependency. Pass `state` for controlled integration or use
 * `transitionTo` to drive a local interface.
 */
export function useLegalGuide({
  state: controlledState,
  initialState = 'idle',
  onStateChange,
}: UseLegalGuideOptions = {}) {
  const [localState, setLocalState] = useState<GuideStateName>(initialState);
  const state = controlledState ?? localState;

  const transitionTo = useCallback(
    (nextState: GuideStateName) => {
      if (nextState === state) return;

      const event: GuideStateChangeEvent = {
        type: 'state_change',
        previousState: state,
        state: nextState,
      };

      if (controlledState === undefined) setLocalState(nextState);
      onStateChange?.(event);
    },
    [controlledState, onStateChange, state],
  );

  return {
    state,
    transitionTo,
    isControlled: controlledState !== undefined,
  };
}
