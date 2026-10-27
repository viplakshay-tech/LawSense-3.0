'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Mic, MicOff, RotateCcw, Send } from 'lucide-react';
import type { GuideVoiceEvent, VoiceLanguage } from '@/components/guide-runtime/voice-adapter/events';
import type { RecognitionLanguage } from './VoiceCapture';
import { sendGuideMessage, type GuideCaseContext, type GuideConversationTurn } from '@/lib/api';
import {
  requestNativeGuideAudio,
  subscribeNativeGuideAudio,
  type NativeGuideAudioCapabilities,
} from './native-guide-audio';
import {
  createGuideConversationResponse,
  guideConversationPresentation,
  selectGuideSpeechVoice,
  type GuideConversationPresentation,
  type GuideConversationStatus,
} from './conversation';

interface SpeechAlternative {
  transcript: string;
}

interface SpeechResult {
  isFinal: boolean;
  length: number;
  0: SpeechAlternative;
}

interface SpeechRecognitionResultEvent extends Event {
  results: ArrayLike<SpeechResult>;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface RecognitionWindow extends Window {
  SpeechRecognition?: new () => BrowserSpeechRecognition;
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
}

type ConversationTurn = {
  id: string;
  speaker: 'you' | 'guide';
  text: string;
  source?: 'voice' | 'text';
  audio?: 'queued' | 'speaking' | 'spoken' | 'unavailable' | 'failed';
};

interface GuideConversationProps {
  draftId: string;
  language: RecognitionLanguage;
  openQuestions: readonly string[];
  hasDraft: boolean;
  caseContext?: GuideCaseContext;
  disabled?: boolean;
  onUserTurn: (text: string, inputMethod: 'voice' | 'text') => void;
  onStateChange?: (presentation: GuideConversationPresentation) => void;
  onRuntimeEvent?: (event: GuideVoiceEvent) => void;
  onActiveChange?: (active: boolean) => void;
}

function createId(prefix: string): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function asVoiceLanguage(language: RecognitionLanguage): VoiceLanguage {
  return language.toLocaleLowerCase() as VoiceLanguage;
}

function recognitionConstructor(): (new () => BrowserSpeechRecognition) | null {
  if (typeof window === 'undefined') return null;
  const browserWindow = window as RecognitionWindow;
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null;
}

function recognitionErrorMessage(code: string): { status: GuideConversationStatus; detail: string } {
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return { status: 'permission_denied', detail: 'Microphone access was denied. Allow it in your browser settings, then try again or type your statement.' };
  }
  if (code === 'audio-capture') {
    return { status: 'error', detail: 'The browser could not find a microphone. Connect one, try again, or type your statement.' };
  }
  if (code === 'network') {
    return { status: 'error', detail: 'The browser speech provider is unavailable. You can try again or type your statement.' };
  }
  if (code === 'no-speech') {
    return { status: 'error', detail: 'No speech was recognized. Nothing was added to the transcript; try again or type instead.' };
  }
  return { status: 'error', detail: 'Speech recognition stopped unexpectedly. Your draft is still available; try again or type instead.' };
}

export default function GuideConversation({
  draftId,
  language,
  openQuestions,
  hasDraft,
  caseContext,
  disabled = false,
  onUserTurn,
  onStateChange,
  onRuntimeEvent,
  onActiveChange,
}: GuideConversationProps) {
  const [presentation, setPresentation] = useState(() => guideConversationPresentation('idle'));
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [callActive, setCallActive] = useState(false);
  const [lastResponse, setLastResponse] = useState<{ id: string; text: string } | null>(null);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [typedMessage, setTypedMessage] = useState('');
  const [transcriptDraft, setTranscriptDraft] = useState('');
  const [nativeCapabilities, setNativeCapabilities] = useState<NativeGuideAudioCapabilities | null>(null);
  const [speechUnavailable, setSpeechUnavailable] = useState(false);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechOperationRef = useRef(0);
  const callActiveRef = useRef(false);
  const shouldListenRef = useRef(false);
  const mountedRef = useRef(false);
  const disabledRef = useRef(disabled);
  const stopReasonRef = useRef<'pause' | 'end' | null>(null);
  const recognitionErrorRef = useRef<{ status: GuideConversationStatus; detail: string } | null>(null);
  const finalTranscriptRef = useRef('');
  const currentCaptureIdRef = useRef('');
  const questionIndexRef = useRef(0);
  const questionsRef = useRef(openQuestions);
  const caseContextRef = useRef(caseContext);
  const conversationHistoryRef = useRef<GuideConversationTurn[]>([]);
  const hasDraftRef = useRef(hasDraft);
  const draftIdRef = useRef(draftId);
  const languageRef = useRef(language);
  const lastResponseRef = useRef<{ id: string; text: string } | null>(null);
  const onUserTurnRef = useRef(onUserTurn);
  const onStateChangeRef = useRef(onStateChange);
  const onRuntimeEventRef = useRef(onRuntimeEvent);
  const onActiveChangeRef = useRef(onActiveChange);
  const nativeCapabilitiesRef = useRef<NativeGuideAudioCapabilities | null>(null);
  const transcriptDraftRef = useRef('');
  const nativeTtsRef = useRef<{ responseId: string; operation: number; afterSpeech: () => void } | null>(null);
  const nativeCheckRef = useRef<Promise<NativeGuideAudioCapabilities | null> | null>(null);

  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  useEffect(() => { questionsRef.current = openQuestions; }, [openQuestions]);
  useEffect(() => { caseContextRef.current = caseContext; }, [caseContext]);
  useEffect(() => { hasDraftRef.current = hasDraft; }, [hasDraft]);
  useEffect(() => { draftIdRef.current = draftId; }, [draftId]);
  useEffect(() => { languageRef.current = language; }, [language]);
  useEffect(() => { onUserTurnRef.current = onUserTurn; }, [onUserTurn]);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);
  useEffect(() => { onRuntimeEventRef.current = onRuntimeEvent; }, [onRuntimeEvent]);
  useEffect(() => { onActiveChangeRef.current = onActiveChange; }, [onActiveChange]);

  const transition = useCallback((status: GuideConversationStatus, detail?: string) => {
    const next = guideConversationPresentation(status, detail);
    setPresentation(next);
    onStateChangeRef.current?.(next);
  }, []);

  const updateGuideAudio = useCallback((turnId: string, audio: NonNullable<ConversationTurn['audio']>) => {
    setTurns((current) => current.map((turn) => turn.id === turnId ? { ...turn, audio } : turn));
  }, []);

  const updateTranscriptDraft = useCallback((transcript: string) => {
    transcriptDraftRef.current = transcript;
    setTranscriptDraft(transcript);
  }, []);

  const detectNativeAudio = useCallback(() => {
    if (!nativeCheckRef.current) {
      nativeCheckRef.current = requestNativeGuideAudio<NativeGuideAudioCapabilities>('getCapabilities', {
        language: languageRef.current === 'English' ? 'en-IN' : 'hi-IN',
      }).then((capabilities) => {
        nativeCapabilitiesRef.current = capabilities;
        setNativeCapabilities(capabilities);
        return capabilities;
      }).catch(() => {
        nativeCheckRef.current = null;
        return null;
      });
    }
    return nativeCheckRef.current;
  }, []);

  useEffect(() => {
    const unsubscribers = [
      subscribeNativeGuideAudio('recognitionStarted', () => {
        if (!callActiveRef.current || !mountedRef.current) return;
        transition('listening');
        onRuntimeEventRef.current?.({
          type: 'capture_started',
          draftId: draftIdRef.current,
          captureId: currentCaptureIdRef.current,
          provider: 'native',
          language: asVoiceLanguage(languageRef.current),
        });
      }),
      subscribeNativeGuideAudio('partialTranscript', (event) => {
        if (callActiveRef.current && typeof event.transcript === 'string') setInterimTranscript(event.transcript);
      }),
      subscribeNativeGuideAudio('transcript', (event) => {
        const recognized = typeof event.transcript === 'string' ? event.transcript.trim() : '';
        if (!recognized || !callActiveRef.current) return;
        setInterimTranscript('');
        updateTranscriptDraft(recognized);
        transition('paused', 'Speech is a draft. Review or edit it, then explicitly confirm before sending it to the Guide.');
        onRuntimeEventRef.current?.({
          type: 'transcript_received',
          draftId: draftIdRef.current,
          captureId: currentCaptureIdRef.current,
          transcript: recognized,
          provider: 'native',
          language: asVoiceLanguage(languageRef.current),
        });
      }),
      subscribeNativeGuideAudio('recognitionError', (event) => {
        if (!callActiveRef.current) return;
        const detail = typeof event.detail === 'string' ? event.detail : 'On-device speech recognition failed. You can retry or type instead.';
        const denied = event.code === 'permission' || /permission|denied/i.test(detail);
        transition(denied ? 'permission_denied' : 'error', detail);
        onRuntimeEventRef.current?.({ type: 'capture_failed', draftId: draftIdRef.current, captureId: currentCaptureIdRef.current, detail });
      }),
      subscribeNativeGuideAudio('speechStarted', (event) => {
        const activeSpeech = nativeTtsRef.current;
        if (!activeSpeech || event.responseId !== activeSpeech.responseId || activeSpeech.operation !== speechOperationRef.current) return;
        updateGuideAudio(activeSpeech.responseId, 'speaking');
        setSpeechUnavailable(false);
        transition('speaking');
        onRuntimeEventRef.current?.({ type: 'speech_started', responseId: activeSpeech.responseId });
      }),
      subscribeNativeGuideAudio('speechFinished', (event) => {
        const activeSpeech = nativeTtsRef.current;
        if (!activeSpeech || event.responseId !== activeSpeech.responseId || activeSpeech.operation !== speechOperationRef.current) return;
        nativeTtsRef.current = null;
        if (speechStartTimerRef.current) clearTimeout(speechStartTimerRef.current);
        speechStartTimerRef.current = null;
        updateGuideAudio(activeSpeech.responseId, 'spoken');
        onRuntimeEventRef.current?.({ type: 'speech_finished', responseId: activeSpeech.responseId });
        activeSpeech.afterSpeech();
      }),
      subscribeNativeGuideAudio('speechError', (event) => {
        const activeSpeech = nativeTtsRef.current;
        if (!activeSpeech || event.responseId !== activeSpeech.responseId) return;
        nativeTtsRef.current = null;
        const detail = typeof event.detail === 'string' ? event.detail : 'Android could not play this response. The text remains available.';
        setSpeechUnavailable(true);
        updateGuideAudio(activeSpeech.responseId, 'failed');
        transition('error', detail);
        onRuntimeEventRef.current?.({ type: 'speech_failed', responseId: activeSpeech.responseId, detail });
        activeSpeech.afterSpeech();
      }),
    ];
    void detectNativeAudio();
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [detectNativeAudio, transition, updateGuideAudio, updateTranscriptDraft]);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const addTurn = useCallback((turn: ConversationTurn) => {
    setTurns((current) => [...current, turn]);
  }, []);

  const appendUserTurn = useCallback((statement: string, inputMethod: 'voice' | 'text') => {
    if (!statement.trim()) return;
    addTurn({ id: createId('turn'), speaker: 'you', text: statement.trim(), source: inputMethod });
    onUserTurnRef.current(statement.trim(), inputMethod);
  }, [addTurn]);

  const speakResponse = useCallback((
    text: string,
    responseId: string,
    afterSpeech: () => void,
  ) => {
    if (nativeCapabilitiesRef.current) {
      const capabilities = nativeCapabilitiesRef.current;
      if (!capabilities.ttsAvailable) {
        setSpeechUnavailable(true);
        updateGuideAudio(responseId, 'unavailable');
        transition('error', 'No installed offline Android voice is available. The reply remains readable, and text input is ready.');
        onRuntimeEventRef.current?.({ type: 'speech_unavailable', responseId });
        afterSpeech();
        return;
      }
      if (speechStartTimerRef.current) clearTimeout(speechStartTimerRef.current);
      const operation = ++speechOperationRef.current;
      const activeSpeech = { responseId, operation, afterSpeech };
      nativeTtsRef.current = activeSpeech;
      updateGuideAudio(responseId, 'queued');
      speechStartTimerRef.current = setTimeout(() => {
        if (nativeTtsRef.current !== activeSpeech) return;
        nativeTtsRef.current = null;
        speechStartTimerRef.current = null;
        const detail = 'Android did not start spoken playback. The reply remains readable below.';
        setSpeechUnavailable(true);
        updateGuideAudio(responseId, 'failed');
        transition('error', detail);
        onRuntimeEventRef.current?.({ type: 'speech_failed', responseId, detail });
        afterSpeech();
      }, 7000);
      void requestNativeGuideAudio('speak', {
        text,
        responseId,
        language: languageRef.current === 'English' ? 'en-IN' : 'hi-IN',
      }).catch((error: unknown) => {
        if (nativeTtsRef.current !== activeSpeech) return;
        nativeTtsRef.current = null;
        if (speechStartTimerRef.current) clearTimeout(speechStartTimerRef.current);
        speechStartTimerRef.current = null;
        const detail = error instanceof Error ? error.message : 'Android could not play this response. The text remains available.';
        setSpeechUnavailable(true);
        updateGuideAudio(responseId, 'failed');
        transition('error', detail);
        onRuntimeEventRef.current?.({ type: 'speech_failed', responseId, detail });
        afterSpeech();
      });
      return;
    }

    if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      setSpeechUnavailable(true);
      updateGuideAudio(responseId, 'unavailable');
      transition('error', 'Browser speech output is unavailable. The reply remains readable below; you can continue by typing.');
      onRuntimeEventRef.current?.({ type: 'speech_unavailable', responseId });
      afterSpeech();
      return;
    }

    const synthesis = window.speechSynthesis;
    synthesis.cancel();
    if (speechStartTimerRef.current) clearTimeout(speechStartTimerRef.current);
    speechStartTimerRef.current = null;
    const operation = ++speechOperationRef.current;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = languageRef.current === 'English' ? 'en-IN' : 'hi-IN';
    utterance.rate = 0.97;
    utterance.pitch = 1.02;
    const voice = selectGuideSpeechVoice(synthesis.getVoices(), languageRef.current);
    if (voice) utterance.voice = voice;

    utterance.onstart = () => {
      if (speechOperationRef.current !== operation || utteranceRef.current !== utterance) return;
      if (speechStartTimerRef.current) clearTimeout(speechStartTimerRef.current);
      speechStartTimerRef.current = null;
      updateGuideAudio(responseId, 'speaking');
      setSpeechUnavailable(false);
      transition('speaking');
      onRuntimeEventRef.current?.({ type: 'speech_started', responseId });
    };
    utterance.onend = () => {
      if (speechOperationRef.current !== operation || utteranceRef.current !== utterance) return;
      if (speechStartTimerRef.current) clearTimeout(speechStartTimerRef.current);
      speechStartTimerRef.current = null;
      utteranceRef.current = null;
      updateGuideAudio(responseId, 'spoken');
      onRuntimeEventRef.current?.({ type: 'speech_finished', responseId });
      afterSpeech();
    };
    utterance.onerror = (event) => {
      if (speechOperationRef.current !== operation || utteranceRef.current !== utterance) return;
      if (speechStartTimerRef.current) clearTimeout(speechStartTimerRef.current);
      speechStartTimerRef.current = null;
      utteranceRef.current = null;
      const detail = event.error === 'not-allowed'
        ? 'Your browser blocked spoken replies. The text remains available below.'
        : 'The browser could not play this reply. The text remains available below.';
      setSpeechUnavailable(true);
      updateGuideAudio(responseId, 'failed');
      transition('error', detail);
      onRuntimeEventRef.current?.({ type: 'speech_failed', responseId, detail });
      afterSpeech();
    };

    utteranceRef.current = utterance;
    updateGuideAudio(responseId, 'queued');
    speechStartTimerRef.current = setTimeout(() => {
      if (speechOperationRef.current !== operation || utteranceRef.current !== utterance) return;
      synthesis.cancel();
      utteranceRef.current = null;
      speechStartTimerRef.current = null;
      const detail = 'The browser did not start spoken playback. The reply remains readable below.';
      setSpeechUnavailable(true);
      updateGuideAudio(responseId, 'failed');
      transition('error', detail);
      onRuntimeEventRef.current?.({ type: 'speech_failed', responseId, detail });
      afterSpeech();
    }, 7000);
    synthesis.speak(utterance);
  }, [transition, updateGuideAudio]);

  const receiveTurn = useCallback(async (text: string, inputMethod: 'voice' | 'text') => {
    const statement = text.trim();
    if (!statement) return;

    const previousHistory: GuideConversationTurn[] = conversationHistoryRef.current.slice(-8);
    const userTurn: GuideConversationTurn = { role: 'user', content: statement };
    const userHistory: GuideConversationTurn[] = [...previousHistory, userTurn];
    conversationHistoryRef.current = userHistory.slice(-8);
    appendUserTurn(statement, inputMethod);

    const questions = questionsRef.current;
    const question = questions.length > 0
      ? questions[questionIndexRef.current % questions.length]
      : undefined;
    questionIndexRef.current += 1;
    transition('processing', 'Preparing a response from the local LawSense Guide.');
    let responseText: string;
    try {
      const result = await sendGuideMessage(
        statement,
        languageRef.current.toLowerCase() as 'english' | 'hindi' | 'hinglish',
        caseContextRef.current,
        previousHistory,
      );
      responseText = result.reply;
    } catch {
      const localUnavailable = languageRef.current === 'Hindi'
        ? 'स्थानीय Guide सेवा अभी उपलब्ध नहीं है। '
        : languageRef.current === 'Hinglish'
          ? 'Local Guide service abhi available nahi hai. '
          : 'The local Guide service is unavailable right now. ';
      responseText = `${localUnavailable}${createGuideConversationResponse(statement, question, languageRef.current)}`;
    }
    if (!mountedRef.current) return;
    const assistantTurn: GuideConversationTurn = { role: 'assistant', content: responseText };
    const assistantHistory: GuideConversationTurn[] = [
      ...conversationHistoryRef.current,
      assistantTurn,
    ];
    conversationHistoryRef.current = assistantHistory.slice(-8);
    const responseId = createId('response');
    const response = { id: responseId, text: responseText };
    lastResponseRef.current = response;
    setLastResponse(response);
    addTurn({ id: responseId, speaker: 'guide', text: responseText, audio: 'queued' });

    const finishTurn = () => {
      utteranceRef.current = null;
      transition(
        callActiveRef.current ? 'paused' : 'idle',
        callActiveRef.current
          ? 'Reply ready. Tap “Speak to Guide” when you want to record another turn, or type below.'
          : undefined,
      );
    };
    speakResponse(responseText, responseId, finishTurn);
  }, [addTurn, appendUserTurn, speakResponse, transition]);

  const startListening = useCallback(async () => {
    if (!callActiveRef.current || !shouldListenRef.current || disabledRef.current) return;
    if (transcriptDraftRef.current) {
      transition('paused', 'Review or edit the recognized transcript before listening again.');
      return;
    }
    if (nativeCapabilitiesRef.current) {
      if (!nativeCapabilitiesRef.current.recognitionAvailable) {
        transition('unsupported', 'On-device Android speech recognition is unavailable on this device. Text input remains available.');
        onRuntimeEventRef.current?.({ type: 'speech_unavailable', responseId: createId('response') });
        return;
      }
      const captureId = createId('capture');
      currentCaptureIdRef.current = captureId;
      setInterimTranscript('');
      transition('requesting_permission', 'Requesting Android microphone permission for this turn.');
      try {
        await requestNativeGuideAudio('startListening', {
          language: languageRef.current === 'English' ? 'en-IN' : 'hi-IN',
        });
      } catch (error) {
        if (!mountedRef.current || !callActiveRef.current || !shouldListenRef.current) return;
        const detail = error instanceof Error ? error.message : 'Android could not start on-device speech recognition.';
        const denied = /permission|denied/i.test(detail);
        transition(denied ? 'permission_denied' : 'error', detail);
        onRuntimeEventRef.current?.({ type: 'capture_failed', draftId: draftIdRef.current, captureId, detail });
      }
      return;
    }

    const Recognition = recognitionConstructor();
    if (!Recognition) {
      transition('unsupported', 'This browser does not provide speech recognition. You can continue with the text box below.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      transition('unsupported', 'This browser cannot provide microphone access for live speech. You can continue by typing.');
      onRuntimeEventRef.current?.({ type: 'speech_unavailable', responseId: createId('response') });
      return;
    }

    transition('requesting_permission', 'Requesting microphone access for this turn.');
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current || !callActiveRef.current || !shouldListenRef.current || disabledRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      releaseStream();
      streamRef.current = stream;
      const recognition = new Recognition();
      const captureId = createId('capture');
      currentCaptureIdRef.current = captureId;
      finalTranscriptRef.current = '';
      recognitionErrorRef.current = null;
      stopReasonRef.current = null;
      recognition.lang = languageRef.current === 'English' ? 'en-IN' : 'hi-IN';
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.onstart = () => {
        if (recognitionRef.current !== recognition) return;
        transition('listening');
        onRuntimeEventRef.current?.({
          type: 'capture_started',
          draftId: draftIdRef.current,
          captureId,
          provider: 'browser',
          language: asVoiceLanguage(languageRef.current),
        });
      };
      recognition.onresult = (event) => {
        if (recognitionRef.current !== recognition) return;
        const finalParts: string[] = [];
        const interimParts: string[] = [];
        for (let index = 0; index < event.results.length; index += 1) {
          const phrase = event.results[index][0]?.transcript?.trim();
          if (!phrase) continue;
          if (event.results[index].isFinal) finalParts.push(phrase);
          else interimParts.push(phrase);
        }
        finalTranscriptRef.current = finalParts.join(' ').replace(/\s+/g, ' ').trim();
        setInterimTranscript(interimParts.join(' ').replace(/\s+/g, ' ').trim());
      };
      recognition.onerror = (event) => {
        if (recognitionRef.current !== recognition) return;
        const issue = recognitionErrorMessage(event.error);
        recognitionErrorRef.current = issue;
        if (issue.status === 'permission_denied') {
          onRuntimeEventRef.current?.({ type: 'capture_failed', draftId: draftIdRef.current, captureId, detail: issue.detail });
        }
      };
      recognition.onend = () => {
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        releaseStream();
        setInterimTranscript('');
        const stopReason = stopReasonRef.current;
        stopReasonRef.current = null;
        const recognizedText = finalTranscriptRef.current.trim();
        finalTranscriptRef.current = '';
        const recognitionIssue = recognitionErrorRef.current;
        recognitionErrorRef.current = null;

        if (stopReason === 'end') return;
        if (recognitionIssue) {
          transition(recognitionIssue.status, recognitionIssue.detail);
          if (recognitionIssue.status !== 'permission_denied') {
            onRuntimeEventRef.current?.({ type: 'capture_failed', draftId: draftIdRef.current, captureId, detail: recognitionIssue.detail });
          }
          return;
        }
        if (recognizedText) {
          updateTranscriptDraft(recognizedText);
          onRuntimeEventRef.current?.({
            type: 'transcript_received',
            draftId: draftIdRef.current,
            captureId,
            transcript: recognizedText,
            provider: 'browser',
            language: asVoiceLanguage(languageRef.current),
          });
          transition('paused', 'Speech is a draft. Review or edit it, then explicitly confirm before sending it to the Guide.');
          return;
        }
        if (stopReason === 'pause') {
          onRuntimeEventRef.current?.({
            type: 'capture_cancelled',
            draftId: draftIdRef.current,
            captureId,
            transcriptRetained: hasDraftRef.current,
          });
          transition('paused');
          return;
        }
        const detail = 'No speech was recognized. Nothing was added to the transcript; try again or type instead.';
        onRuntimeEventRef.current?.({ type: 'capture_failed', draftId: draftIdRef.current, captureId, detail });
        transition('error', detail);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (cause) {
      stream?.getTracks().forEach((track) => track.stop());
      if (streamRef.current === stream) streamRef.current = null;
      if (recognitionRef.current) {
        const failedRecognition = recognitionRef.current;
        recognitionRef.current = null;
        failedRecognition.onresult = null;
        failedRecognition.onerror = null;
        failedRecognition.onend = null;
        try { failedRecognition.abort(); } catch { /* The browser may already have rejected this start. */ }
      }
      if (!mountedRef.current || !callActiveRef.current || !shouldListenRef.current) return;
      const denied = cause instanceof DOMException && ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(cause.name);
      const detail = denied
        ? 'Microphone access was denied. Allow it in your browser settings, then resume or type your statement.'
        : cause instanceof Error
          ? `Microphone access failed: ${cause.message}`
          : 'Microphone access failed. Check the device or type your statement.';
      const captureId = currentCaptureIdRef.current || createId('capture');
      onRuntimeEventRef.current?.({ type: 'capture_failed', draftId: draftIdRef.current, captureId, detail });
      transition(denied ? 'permission_denied' : 'error', detail);
    }
  }, [releaseStream, transition, updateTranscriptDraft]);

  const startCall = useCallback(async () => {
    if (disabled || disabledRef.current) return;
    const native = nativeCapabilitiesRef.current ?? await detectNativeAudio();
    if (native) {
      if (!native.recognitionAvailable) {
        transition('unsupported', 'On-device Android speech recognition is unavailable on this device. You can continue by typing.');
        onRuntimeEventRef.current?.({ type: 'speech_unavailable', responseId: createId('response') });
        return;
      }
      if (callActiveRef.current) {
        shouldListenRef.current = true;
        await startListening();
        return;
      }
      callActiveRef.current = true;
      setCallActive(true);
      shouldListenRef.current = true;
      onActiveChangeRef.current?.(true);
      await startListening();
      return;
    }
    if (typeof window !== 'undefined' && window.parent !== window) {
      transition('unsupported', 'The Android audio bridge is unavailable. You can continue by typing.');
      onRuntimeEventRef.current?.({ type: 'speech_unavailable', responseId: createId('response') });
      return;
    }
    if (!recognitionConstructor()) {
      transition('unsupported', 'This browser does not provide live speech recognition. You can still have a text conversation below.');
      onRuntimeEventRef.current?.({ type: 'capture_failed', draftId: draftIdRef.current, captureId: createId('capture'), detail: 'This browser does not provide live speech recognition.' });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      transition('unsupported', 'This browser cannot provide microphone access for live speech. You can still type below.');
      onRuntimeEventRef.current?.({ type: 'capture_failed', draftId: draftIdRef.current, captureId: createId('capture'), detail: 'This browser cannot provide microphone access for live speech.' });
      return;
    }
    if (callActiveRef.current) {
      shouldListenRef.current = true;
      void startListening();
      return;
    }

    callActiveRef.current = true;
    setCallActive(true);
    shouldListenRef.current = true;
    onActiveChangeRef.current?.(true);
    await startListening();
  }, [detectNativeAudio, disabled, startListening, transition]);

  const pauseListening = useCallback(() => {
    if (!callActiveRef.current) return;
    shouldListenRef.current = false;
    if (nativeCapabilitiesRef.current) {
      void requestNativeGuideAudio('stopListening').catch(() => undefined);
      setInterimTranscript('');
      transition('paused', 'Recording stopped. Your transcript and conversation remain here.');
      return;
    }
    stopReasonRef.current = 'pause';
    if (recognitionRef.current) recognitionRef.current.stop();
    else transition('paused', 'Recording stopped. Your conversation remains here.');
  }, [transition]);

  const confirmTranscript = useCallback(() => {
    const confirmed = transcriptDraft.trim();
    if (!confirmed || disabled || ['processing', 'speaking'].includes(presentation.status)) return;
    updateTranscriptDraft('');
    onRuntimeEventRef.current?.({ type: 'transcript_edited', draftId: draftIdRef.current, transcript: confirmed, inputMethod: 'voice' });
    onRuntimeEventRef.current?.({ type: 'review_started', draftId: draftIdRef.current, transcript: confirmed });
    void receiveTurn(confirmed, 'voice');
  }, [disabled, presentation.status, receiveTurn, transcriptDraft, updateTranscriptDraft]);

  const endCall = useCallback(() => {
    if (!callActiveRef.current && presentation.status !== 'requesting_permission') {
      transition('ended');
      return;
    }
    callActiveRef.current = false;
    setCallActive(false);
    shouldListenRef.current = false;
    onActiveChangeRef.current?.(false);
    const recognition = recognitionRef.current;
    if (recognition) {
      const captureId = currentCaptureIdRef.current;
      const finalText = finalTranscriptRef.current.trim();
      if (finalText) {
        updateTranscriptDraft(finalText);
        onRuntimeEventRef.current?.({
          type: 'transcript_received',
          draftId: draftIdRef.current,
          captureId,
          transcript: finalText,
          provider: 'browser',
          language: asVoiceLanguage(languageRef.current),
        });
      }
      finalTranscriptRef.current = '';
      setInterimTranscript('');
      recognitionRef.current = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try { recognition.abort(); } catch { /* The browser may already have ended this capture. */ }
      onRuntimeEventRef.current?.({
        type: 'capture_cancelled',
        draftId: draftIdRef.current,
        captureId,
        transcriptRetained: hasDraftRef.current,
      });
    }
    releaseStream();
    if (speechStartTimerRef.current) clearTimeout(speechStartTimerRef.current);
    speechStartTimerRef.current = null;
    const wasSpeaking = Boolean(utteranceRef.current || nativeTtsRef.current);
    speechOperationRef.current += 1;
    utteranceRef.current = null;
    nativeTtsRef.current = null;
    if (nativeCapabilitiesRef.current) {
      void requestNativeGuideAudio('stopListening').catch(() => undefined);
      void requestNativeGuideAudio('stopSpeaking').catch(() => undefined);
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    const responseId = lastResponseRef.current?.id;
    if (wasSpeaking && responseId) onRuntimeEventRef.current?.({ type: 'speech_cancelled', responseId });
    transition('ended');
  }, [presentation.status, releaseStream, transition, updateTranscriptDraft]);

  const repeatResponse = useCallback(() => {
    const response = lastResponseRef.current;
    if (!response || transcriptDraftRef.current || presentation.status === 'listening' || presentation.status === 'processing' || presentation.status === 'speaking') return;
    speakResponse(response.text, response.id, () => transition(callActiveRef.current ? 'paused' : 'idle', 'Reply ready. Tap “Speak to Guide” when you want to record another turn, or type below.'));
  }, [presentation.status, speakResponse, transition]);

  const sendTypedMessage = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = typedMessage.trim();
    if (!message || disabled || ['requesting_permission', 'processing', 'speaking'].includes(presentation.status)) return;
    if (presentation.status === 'listening') pauseListening();
    setTypedMessage('');
    void receiveTurn(message, 'text');
  }, [disabled, pauseListening, presentation.status, receiveTurn, typedMessage]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      callActiveRef.current = false;
      shouldListenRef.current = false;
      speechOperationRef.current += 1;
      if (speechStartTimerRef.current) clearTimeout(speechStartTimerRef.current);
      speechStartTimerRef.current = null;
      const recognition = recognitionRef.current;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try { recognition.abort(); } catch { /* The browser may already have ended this capture. */ }
      }
      recognitionRef.current = null;
      releaseStream();
      if (nativeCapabilitiesRef.current) {
        void requestNativeGuideAudio('stopListening').catch(() => undefined);
        void requestNativeGuideAudio('stopSpeaking').catch(() => undefined);
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, [releaseStream]);

  const canSubmitText = !disabled;
  const textSubmissionBusy = ['requesting_permission', 'processing', 'speaking'].includes(presentation.status);
  const active = callActive || presentation.status === 'requesting_permission';
  const statusLabel = presentation.status === 'requesting_permission'
    ? 'Requesting microphone permission'
    : presentation.status === 'listening'
      ? 'Listening'
      : presentation.status === 'processing'
        ? 'Processing your words'
        : presentation.status === 'speaking'
          ? 'Guide speaking'
          : presentation.status === 'paused'
            ? transcriptDraft ? 'Transcript ready for review' : 'Ready for another turn'
            : presentation.status === 'permission_denied'
              ? 'Microphone permission denied'
              : presentation.status === 'unsupported'
                ? 'Live voice unavailable'
                : presentation.status === 'error'
                  ? 'Voice input needs attention'
                  : presentation.status === 'ended'
                    ? 'Voice mode ended'
                    : 'Ready';

  return (
    <section
      className="ls-guide-call__conversationCard"
      aria-label="Guide voice and text conversation"
      data-conversation-state={presentation.status}
    >
      <div className="ls-guide-call__conversationHeading">
        <div>
          <p className="ls-guide-call__eyebrow">TURN-BASED VOICE</p>
          <h2>Speak with your Guide</h2>
          <p>Tap to speak for one turn. Review or edit the transcript, then confirm before the Guide receives it. You can type at any time.</p>
        </div>
        <span className="ls-guide-call__conversationState" role="status" aria-live="polite">
          <span aria-hidden="true" />{statusLabel}
        </span>
      </div>

      <p className="ls-guide-call__conversationDetail" aria-live="polite">{presentation.detail}</p>

      <div className="ls-guide-call__conversationLog" role="log" aria-label="Voice conversation transcript" aria-live="polite" aria-relevant="additions text">
        {turns.length === 0 ? (
          <p className="ls-guide-call__conversationEmpty">Your messages and Guide replies will appear here.</p>
        ) : turns.map((turn) => (
          <article className="ls-guide-call__conversationTurn" key={turn.id} data-speaker={turn.speaker}>
            <p className="ls-guide-call__turnSpeaker">{turn.speaker === 'you' ? (turn.source === 'voice' ? 'You · recognized speech' : 'You · typed') : 'LawSense Guide'}</p>
            <p className="ls-guide-call__turnText">{turn.text}</p>
            {turn.speaker === 'guide' && (
              <p className="ls-guide-call__turnAudio" role="status">
                {turn.audio === 'spoken' ? 'Spoken aloud' : turn.audio === 'speaking' ? 'Speaking now' : turn.audio === 'queued' ? 'Preparing spoken reply' : turn.audio === 'failed' ? 'Could not play aloud · text remains available' : turn.audio === 'unavailable' ? 'Speech output unavailable · text remains available' : ''}
              </p>
            )}
          </article>
        ))}
        {interimTranscript && (
          <p className="ls-guide-call__interimTranscript" aria-live="polite">Hearing: {interimTranscript}</p>
        )}
      </div>

      {transcriptDraft && (
        <div className="ls-guide-call__transcriptReview">
          <label htmlFor="guide-call-transcript">Recognized words · review before sending</label>
          <textarea
            id="guide-call-transcript"
            value={transcriptDraft}
            onChange={(event) => updateTranscriptDraft(event.target.value)}
            maxLength={2000}
            rows={3}
            aria-describedby="guide-call-transcript-note"
          />
          <p id="guide-call-transcript-note">This transcript has not been sent to the Guide or added as a case statement.</p>
          <button type="button" className="ls-guide-call__confirmTranscriptButton" onClick={confirmTranscript} disabled={disabled || !transcriptDraft.trim() || textSubmissionBusy}>
            Confirm transcript and send to Guide
          </button>
        </div>
      )}

      <form className="ls-guide-call__conversationForm" onSubmit={sendTypedMessage}>
        <label htmlFor="guide-call-message">Type a message instead</label>
        <div className="ls-guide-call__messageRow">
          <input
            id="guide-call-message"
            value={typedMessage}
            onChange={(event) => setTypedMessage(event.target.value)}
            placeholder="Write a message to the Guide"
            maxLength={2000}
            disabled={!canSubmitText}
          />
          <button type="submit" disabled={!canSubmitText || textSubmissionBusy || !typedMessage.trim()} aria-label="Send typed message">
            <Send aria-hidden="true" />Send
          </button>
        </div>
      </form>

      {presentation.status === 'permission_denied' && <p className="ls-guide-call__conversationError" role="alert">{presentation.detail}</p>}
      {(presentation.status === 'error' || presentation.status === 'unsupported') && <p className="ls-guide-call__conversationError" role="alert">{presentation.detail}</p>}
      {speechUnavailable && <p className="ls-guide-call__speechFallback" role="status">Guide replies remain readable in the transcript when device speech output is unavailable.</p>}
      {nativeCapabilities?.selectedVoice && (
        <p className="ls-guide-call__nativeVoice" role="status">Android offline voice: {nativeCapabilities.selectedVoice.name} · {nativeCapabilities.selectedVoice.locale}</p>
      )}

      <div className="ls-guide-call__conversationControls" aria-label="Voice turn controls">
        {!active && presentation.status !== 'unsupported' && (
          <button type="button" className="ls-guide-call__startCallButton" onClick={() => void startCall()} disabled={disabled}>
            <Mic aria-hidden="true" />{presentation.status === 'ended' || presentation.status === 'permission_denied' || presentation.status === 'error' ? 'Tap to speak again' : 'Tap to speak'}
          </button>
        )}
        {active && presentation.status === 'listening' && (
          <button type="button" className="ls-guide-call__callControlButton" onClick={pauseListening} aria-label="Stop listening">
            <MicOff aria-hidden="true" />Stop listening
          </button>
        )}
        {active && ['paused', 'permission_denied', 'error'].includes(presentation.status) && !transcriptDraft && (
          <button type="button" className="ls-guide-call__callControlButton" onClick={() => { shouldListenRef.current = true; void startListening(); }} disabled={disabled}>
            <Mic aria-hidden="true" />Speak to Guide
          </button>
        )}
        {lastResponse && !transcriptDraft && !['listening', 'processing', 'speaking', 'requesting_permission'].includes(presentation.status) && (
          <button type="button" className="ls-guide-call__callControlButton" onClick={repeatResponse} disabled={disabled}>
            <RotateCcw aria-hidden="true" />Repeat response
          </button>
        )}
        {active && (
          <button type="button" className="ls-guide-call__endCallButton" onClick={endCall}>
            End voice mode
          </button>
        )}
      </div>

      <p className="ls-guide-call__conversationPrivacy">
        On Android, speech recognition and spoken replies use installed on-device Android services only; the app will report if an offline service is unavailable. Desktop browser speech may use that browser’s configured provider. Guide replies use the configured LawSense server’s local Ollama model. Audio is not added to the case, and recognized words stay editable until you confirm them.
      </p>
    </section>
  );
}
