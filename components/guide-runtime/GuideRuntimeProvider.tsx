'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useCaseState } from '@/app/case/[id]/CaseStateProvider';
import { OPEN_LEGAL_ADVISORY_EVENT } from '@/components/case-shell/legal-advisory-events';
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
    case 'draft': return `${base}/draft`;
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
    case 'SHOW_EVIDENCE': {
      const { evidenceIds, documentIds } = action.payload;
      if (evidenceIds.length === 1) {
        return { type: 'openEvidence', evidenceId: evidenceIds[0] };
      }
      if (evidenceIds.length === 0 && documentIds.length === 1) {
        return { type: 'openDocument', documentId: documentIds[0] };
      }
      return { type: 'openEvidence' };
    }
    case 'SHOW_LEGAL_GROUNDING':
      return action.payload.recordIds.length === 1
        ? { type: 'openLegalGrounding', recordId: action.payload.recordIds[0] }
        : { type: 'openLegalAdvisory' };
    case 'OPEN_LEGAL_ADVISORY':
      return { type: 'openLegalAdvisory' };
    case 'OPEN_JOURNEY':
      return { type: 'openJourney' };
    case 'SHOW_TWIN':
      return { type: 'openTwin' };
    case 'OPEN_SAFETY':
      return { type: 'openSafety' };
    case 'START_VOICE':
      return { type: 'startVoice' };
    case 'OPEN_DRAFTING':
      return { type: 'navigate', route: { kind: 'draft', caseId: action.payload.caseId } };
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
    case 'OPEN_LEGAL_ADVISORY': return 'Legal Advisory';
    case 'OPEN_JOURNEY': return 'Journey';
    case 'SHOW_TWIN': return 'Living Twin';
    case 'OPEN_SAFETY': return 'Safety';
    case 'START_VOICE': return 'Voice capture';
    case 'OPEN_DRAFTING': return 'Document drafting';
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
    const activeCaseUnavailable = () => (
      caseState && caseState.id === caseId
        ? null
        : { status: 'unavailable' as const, reason: 'The active case is still loading or no longer matches this Guide session.' }
    );
    return {
      navigate: (route) => {
        if (route.kind !== 'home') {
          const unavailable = activeCaseUnavailable();
          if (unavailable) return unavailable;
          if (route.caseId !== caseId) {
            return { status: 'unavailable', reason: 'This navigation target belongs to a different case.' };
          }
        }
        push(pathForRoute(route));
      },
      openEvidence: (evidenceId) => {
        const unavailable = activeCaseUnavailable();
        if (unavailable) return unavailable;
        if (evidenceId && !caseState?.evidence.some((item) => item.id === evidenceId)) {
          return { status: 'unavailable', reason: 'The requested evidence item is not present in the current CaseState.' };
        }
        push(`${base}/documents${evidenceId ? `?evidenceId=${encodeURIComponent(evidenceId)}` : ''}`);
      },
      openDocument: (documentId) => {
        if (!caseState || caseState.id !== caseId || !caseState.documents.some((document) => document.id === documentId)) {
          return { status: 'unavailable', reason: 'The selected document is not present in the current CaseState.' };
        }
        push(`${base}/documents?documentId=${encodeURIComponent(documentId)}`);
      },
      highlightEvidence: (findingId, documentId) => {
        if (!caseState || caseState.id !== caseId || !documentId
          || !caseState.documents.some((document) => document.id === documentId)) {
          return { status: 'unavailable', reason: 'Highlighting a finding requires a document ID that belongs to the active case.' };
        }
        if (!findingId.trim() || findingId.length > 512) {
          return { status: 'unavailable', reason: 'The requested document finding identifier is invalid.' };
        }
        push(`${base}/documents?documentId=${encodeURIComponent(documentId)}&findingId=${encodeURIComponent(findingId)}#document-preview`);
      },
      openLegalAdvisory: () => {
        const unavailable = activeCaseUnavailable();
        if (unavailable) return unavailable;
        if (typeof window === 'undefined') {
          return { status: 'unavailable', reason: 'Legal Advisory can only be opened in the active browser session.' };
        }
        window.dispatchEvent(new Event(OPEN_LEGAL_ADVISORY_EVENT));
      },
      openLegalGrounding: (recordId) => {
        if (!caseState || caseState.id !== caseId
          || !caseState.analysis?.legalKnowledge.records.some((record) => record.id === recordId)) {
          return { status: 'unavailable', reason: 'The requested legal source is not present in the active case.' };
        }
        push(`${base}#legal-record-${encodeURIComponent(recordId)}`);
      },
      openJourney: () => {
        const unavailable = activeCaseUnavailable();
        if (unavailable) return unavailable;
        push(`${base}#journey`);
      },
      openTwin: () => {
        const unavailable = activeCaseUnavailable();
        if (unavailable) return unavailable;
        push(`${base}/twin`);
      },
      selectTwinNode: (nodeId) => {
        const unavailable = activeCaseUnavailable();
        if (unavailable) return unavailable;
        if (!nodeId.trim() || nodeId.length > 512) {
          return { status: 'unavailable', reason: 'The requested Twin node identifier is invalid.' };
        }
        push(`${base}/twin?focus=${encodeURIComponent(nodeId)}`);
      },
      selectTimeline: (timestamp) => {
        const unavailable = activeCaseUnavailable();
        if (unavailable) return unavailable;
        const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(timestamp);
        if (!Number.isFinite(date.getTime())) {
          return { status: 'unavailable', reason: 'The requested timeline date is invalid.' };
        }
        push(`${base}/twin?at=${encodeURIComponent(date.toISOString())}`);
      },
      startVoice: () => {
        const unavailable = activeCaseUnavailable();
        if (unavailable) return unavailable;
        push(`${base}/voice`);
      },
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
      openSafety: () => {
        const unavailable = activeCaseUnavailable();
        if (unavailable) return unavailable;
        push(`${base}/safety`);
      },
      openClarification: () => {
        const unavailable = activeCaseUnavailable();
        if (unavailable) return unavailable;
        push(`${base}#clarification`);
      },
    };
  }, [caseId, caseState, dispatch, router]);

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

  const actionExecutionRef = useRef(false);

  const runAction = useCallback(async (action: GuideAction): Promise<GuideActionResult | null> => {
    // UI disabled states are not a concurrency boundary: keyboard activation,
    // rapid taps, or multiple surfaces can otherwise dispatch the same action.
    if (actionExecutionRef.current) return null;
    actionExecutionRef.current = true;
    setActionRunning(true);

    try {
      const selection = dispatch({ type: 'GUIDE_ACTION_SELECTED', action });
      if (!selection.emissions.some((emission) => emission.type === 'action_requested')) {
        appendMessage('error', 'That action is no longer available for the current case state.');
        return null;
      }

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
      actionExecutionRef.current = false;
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
