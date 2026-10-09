'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useCaseState } from '@/app/case/[id]/CaseStateProvider';
import { createGuideActionBridge } from '@/components/guide-actions';
import type {
  GuideActionAdapter,
  GuideActionCommand,
  GuideActionResult,
  GuideRoute,
} from '@/components/guide-actions';
import { createGuidePresentation, guideStateChangeMessage } from './presentation';
import { createGuideRuntime } from './runtime';
import type { GuideRuntimeController } from './runtime';
import type {
  GuideAction,
  GuideActionPayloadMap,
  GuideEvent,
  GuideRuntimeResult,
  GuideRuntimeSnapshot,
} from './types';
import { guideContextualMessage } from './presence';
import type { GuideContextualMessage } from './presence';

export interface GuideTranscriptEntry {
  id: string;
  kind: 'system' | 'action' | 'error';
  text: string;
}

export interface GuideRuntimeContextValue {
  snapshot: GuideRuntimeSnapshot;
  presentation: ReturnType<typeof createGuidePresentation>;
  contextualMessage: GuideContextualMessage;
  messages: readonly GuideTranscriptEntry[];
  actionRunning: boolean;
  dispatch: (event: GuideEvent) => GuideRuntimeResult;
  interruptSpeech: () => void;
  runAction: (action: GuideAction) => Promise<GuideActionResult | null>;
  dismissError: () => void;
}

const GuideRuntimeContext = createContext<GuideRuntimeContextValue | null>(null);

function pathForRoute(route: GuideRoute): string {
  if (route.kind === 'home') return '/';
  const base = `/case/${encodeURIComponent(route.caseId)}`;
  switch (route.kind) {
    case 'case': return base;
    case 'documents': return `${base}/documents`;
    case 'guide': return `${base}/guide`;
    case 'journey': return `${base}#journey`;
    case 'twin': return `${base}/twin`;
    case 'voice': return `${base}/voice`;
    case 'safety': return `${base}/safety`;
    default: {
      const exhaustiveRoute: never = route;
      return exhaustiveRoute;
    }
  }
}

function routeForTarget(target: GuideActionPayloadMap['NAVIGATE']['target'], caseId: string): GuideRoute {
  return target === 'case'
    ? { kind: 'case', caseId }
    : target === 'journey'
      ? { kind: 'journey', caseId }
      : { kind: target, caseId };
}

function commandForAction(action: GuideAction): GuideActionCommand {
  switch (action.type) {
    case 'ASK_CLARIFICATION':
      return { type: 'openClarification' };
    case 'SHOW_EVIDENCE':
      return { type: 'openEvidence' };
    case 'SHOW_LEGAL_GROUNDING':
      return { type: 'navigate', route: { kind: 'guide', caseId: action.payload.caseId } };
    case 'OPEN_JOURNEY':
      return { type: 'openJourney' };
    case 'SHOW_TWIN':
      return { type: 'openTwin' };
    case 'OPEN_SAFETY':
      return { type: 'openSafety' };
    case 'START_VOICE':
      return { type: 'startVoice' };
    case 'SPEAK_RESPONSE':
      return { type: 'speak', text: action.payload.response.text };
    case 'NAVIGATE':
      return { type: 'navigate', route: routeForTarget(action.payload.target, action.payload.caseId) };
    default: {
      const exhaustiveAction: never = action;
      return exhaustiveAction;
    }
  }
}

function actionLabel(action: GuideAction): string {
  switch (action.type) {
    case 'ASK_CLARIFICATION': return 'Clarification';
    case 'SHOW_EVIDENCE': return 'Evidence Map';
    case 'SHOW_LEGAL_GROUNDING': return 'Legal grounding';
    case 'OPEN_JOURNEY': return 'Journey';
    case 'SHOW_TWIN': return 'Living Twin';
    case 'OPEN_SAFETY': return 'Safety';
    case 'START_VOICE': return 'Voice capture';
    case 'SPEAK_RESPONSE': return 'Guide speech';
    case 'NAVIGATE': return action.payload.target === 'case' ? 'Case overview' : action.payload.target;
    default: {
      const exhaustiveAction: never = action;
      return exhaustiveAction;
    }
  }
}

export function GuideRuntimeProvider({ caseId, children }: { caseId: string; children: ReactNode }) {
  const router = useRouter();
  const { caseState, revision } = useCaseState();
  const [controller] = useState<GuideRuntimeController>(() => createGuideRuntime());
  const [snapshot, setSnapshot] = useState(() => controller.getSnapshot());
  const [messages, setMessages] = useState<GuideTranscriptEntry[]>([]);
  const [actionRunning, setActionRunning] = useState(false);
  const activeUtterance = useRef<SpeechSynthesisUtterance | null>(null);
  const settleSpeech = useRef<(() => void) | null>(null);
  const speechWasInterrupted = useRef(false);
  const messageSequence = useRef(0);
  const lastCaseRevision = useRef(0);
  const presentation = useMemo(
    () => createGuidePresentation(snapshot.caseState, snapshot.state.name),
    [snapshot.caseState, snapshot.state.name],
  );
  const contextualMessage = useMemo(
    () => guideContextualMessage(snapshot, presentation, messages.at(-1)),
    [messages, presentation, snapshot],
  );

  const appendMessage = useCallback((kind: GuideTranscriptEntry['kind'], text: string) => {
    const id = `guide-message-${++messageSequence.current}`;
    setMessages((current) => [...current.slice(-5), { id, kind, text }]);
  }, []);

  const stopSpeechPlayback = useCallback((): boolean => {
    if (!activeUtterance.current) return false;
    activeUtterance.current = null;
    speechWasInterrupted.current = true;
    const settle = settleSpeech.current;
    settleSpeech.current = null;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    settle?.();
    return true;
  }, []);

  const dispatch = useCallback((event: GuideEvent): GuideRuntimeResult => {
    const current = controller.getSnapshot();
    const interruptsPlayback = current.speechState === 'speaking' && [
      'CASE_STATE_UPDATED',
      'CASE_STATE_CLEARED',
      'GUIDE_USER_INPUT_STARTED',
      'GUIDE_PROCESSING_STARTED',
      'GUIDE_RESPONSE_READY',
      'GUIDE_ERROR',
      'GUIDE_RESET',
    ].includes(event.type);
    if (interruptsPlayback) stopSpeechPlayback();
    const result = controller.dispatch(event);
    setSnapshot(result.snapshot);
    return result;
  }, [controller, stopSpeechPlayback]);

  const interruptSpeech = useCallback(() => {
    if (!stopSpeechPlayback()) return;
    const result = controller.dispatch({ type: 'GUIDE_SPEECH_INTERRUPTED' });
    setSnapshot(result.snapshot);
  }, [controller, stopSpeechPlayback]);

  useEffect(() => () => {
    stopSpeechPlayback();
  }, [stopSpeechPlayback]);

  const adapter = useMemo<GuideActionAdapter>(() => {
    const base = `/case/${encodeURIComponent(caseId)}`;
    const push = (path: string) => router.push(path);
    return {
      navigate: (route) => push(pathForRoute(route)),
      openEvidence: (evidenceId) => push(`${base}/documents${evidenceId ? `?evidenceId=${encodeURIComponent(evidenceId)}` : ''}`),
      openDocument: () => ({ status: 'unavailable', reason: 'The document workspace does not expose selection by document ID.' }),
      highlightEvidence: () => ({ status: 'unavailable', reason: 'The case view does not expose a Guide finding-highlight callback.' }),
      openLegalGrounding: () => push(`${base}#analysis`),
      openJourney: () => push(`${base}#journey`),
      openTwin: () => push(`${base}/twin`),
      selectTwinNode: () => ({ status: 'unavailable', reason: 'The Twin does not expose a Guide node-selection callback.' }),
      selectTimeline: () => ({ status: 'unavailable', reason: 'The Twin does not expose a Guide timeline-selection callback.' }),
      startVoice: () => push(`${base}/voice`),
      speak: (text) => {
        if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
          return { status: 'unavailable', reason: 'Speech playback is not supported in this browser.' };
        }

        return new Promise<void>((resolve, reject) => {
          const utterance = new SpeechSynthesisUtterance(text);
          let settled = false;
          const finish = (error?: Error) => {
            if (activeUtterance.current !== utterance || settled) return;
            settled = true;
            activeUtterance.current = null;
            settleSpeech.current = null;
            dispatch({ type: 'GUIDE_SPEECH_ENDED' });
            if (error) reject(error);
            else resolve();
          };
          activeUtterance.current = utterance;
          speechWasInterrupted.current = false;
          settleSpeech.current = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          utterance.onstart = () => dispatch({ type: 'GUIDE_SPEECH_STARTED' });
          utterance.onend = () => finish();
          utterance.onerror = (event) => {
            if (event.error === 'canceled' || event.error === 'interrupted') {
              if (activeUtterance.current !== utterance) return;
              speechWasInterrupted.current = true;
              activeUtterance.current = null;
              settleSpeech.current = null;
              dispatch({ type: 'GUIDE_SPEECH_INTERRUPTED' });
              if (!settled) {
                settled = true;
                resolve();
              }
              return;
            }
            finish(new Error(`Speech playback failed: ${event.error}.`));
          };
          window.speechSynthesis.speak(utterance);
        });
      },
      openSafety: () => push(`${base}/safety`),
      openClarification: () => push(`${base}#clarification`),
    };
  }, [caseId, dispatch, router]);

  useEffect(() => {
    if (!caseState || revision === 0 || lastCaseRevision.current === revision) return;
    lastCaseRevision.current = revision;

    const previousState = controller.getSnapshot().state.name;
    const updateResult = dispatch({ type: 'CASE_STATE_UPDATED', caseState });
    const updatedSnapshot = updateResult.snapshot;
    const presentation = createGuidePresentation(caseState, updatedSnapshot.state.name);
    dispatch({
      type: 'GUIDE_RESPONSE_READY',
      response: { id: `case-${caseState.id}-${revision}`, text: presentation.speechText },
    });

    const currentSnapshot = controller.getSnapshot();
    const stateMessage = previousState === currentSnapshot.state.name
      ? guideStateChangeMessage(currentSnapshot.state.name)
      : `Guide state changed · ${guideStateChangeMessage(currentSnapshot.state.name)}`;
    appendMessage(
      'system',
      `Case record updated · ${caseState.facts.length} facts · ${presentation.unknowns.length} open questions · ${caseState.evidence.length} evidence items. ${stateMessage}`,
    );
  }, [appendMessage, caseState, controller, dispatch, revision]);

  const runAction = useCallback(async (action: GuideAction): Promise<GuideActionResult | null> => {
    const selection = dispatch({ type: 'GUIDE_ACTION_SELECTED', action });
    if (!selection.emissions.some((emission) => emission.type === 'action_requested')) {
      appendMessage('error', 'That action is no longer available for the current case state.');
      return null;
    }

    setActionRunning(true);
    try {
      const result = await createGuideActionBridge(adapter).dispatch(commandForAction(action));
      if (result.status === 'success') {
        const completion = action.type === 'START_VOICE'
          ? 'Voice capture opened. Start the microphone on that page when you are ready.'
          : action.type === 'SPEAK_RESPONSE'
            ? speechWasInterrupted.current
              ? 'Guide speech stopped. The response remains available to read.'
              : 'Guide speech completed.'
            : `${actionLabel(action)} workspace opened.`;
        if (action.type === 'SPEAK_RESPONSE') speechWasInterrupted.current = false;
        appendMessage('action', completion);
      } else if (result.status === 'unavailable') {
        appendMessage('error', `Action unavailable · ${result.reason}`);
      } else {
        dispatch({ type: 'GUIDE_ERROR', message: result.message });
        appendMessage('error', `Action failed · ${result.message}`);
      }
      return result;
    } finally {
      setActionRunning(false);
    }
  }, [adapter, appendMessage, dispatch]);

  const dismissError = useCallback(() => {
    if (snapshot.state.name === 'error') dispatch({ type: 'GUIDE_RESET' });
  }, [dispatch, snapshot.state.name]);

  const value = useMemo<GuideRuntimeContextValue>(() => ({
    snapshot,
    presentation,
    contextualMessage,
    messages,
    actionRunning,
    dispatch,
    interruptSpeech,
    runAction,
    dismissError,
  }), [actionRunning, contextualMessage, dismissError, dispatch, interruptSpeech, messages, presentation, runAction, snapshot]);

  return <GuideRuntimeContext.Provider value={value}>{children}</GuideRuntimeContext.Provider>;
}

export function useGuideRuntime(): GuideRuntimeContextValue {
  const value = useContext(GuideRuntimeContext);
  if (!value) throw new Error('useGuideRuntime must be used inside GuideRuntimeProvider.');
  return value;
}
