'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play, RotateCcw, Volume2, X } from 'lucide-react';
import type { GuideVoiceEvent } from '@/components/guide-runtime/voice-adapter/events';
import { getVoiceProviderAvailability, synthesizeVoiceSpeech } from '@/lib/api';

type OutputState = 'checking' | 'ready' | 'starting' | 'speaking' | 'paused' | 'unavailable' | 'error';
type OutputMode = 'local' | 'browser' | 'unavailable';
type PlaybackEventInput =
  | { type: 'speech_started' }
  | { type: 'speech_paused' }
  | { type: 'speech_finished' }
  | { type: 'speech_cancelled' }
  | { type: 'speech_failed'; detail: string }
  | { type: 'speech_unavailable' };

interface VoiceOutputProps {
  text: string;
  language?: string | null;
  responseId?: string;
  onEvent?: (event: GuideVoiceEvent) => void;
}

function speechLanguage(language: string | null | undefined): string {
  if (language === 'english') return 'en-IN';
  return 'hi-IN';
}

function apiLanguage(language: string | null | undefined): 'english' | 'hindi' | 'hinglish' {
  if (language === 'english' || language === 'hindi' || language === 'hinglish') return language;
  return 'hindi';
}

export default function VoiceOutput({ text, language, responseId = 'guide-response', onEvent }: VoiceOutputProps) {
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const operation = useRef(0);
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEventRef = useRef(onEvent);
  const [state, setState] = useState<OutputState>('checking');
  const [mode, setMode] = useState<OutputMode>('unavailable');
  const [activeMode, setActiveMode] = useState<OutputMode>('unavailable');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [voiceListReady, setVoiceListReady] = useState(false);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const emit = (event: PlaybackEventInput) => {
    onEventRef.current?.({ ...event, responseId } as GuideVoiceEvent);
  };

  const clearStartTimer = () => {
    if (startTimer.current) clearTimeout(startTimer.current);
    startTimer.current = null;
  };

  const releaseAudio = () => {
    if (audio.current) {
      audio.current.onplay = null;
      audio.current.onpause = null;
      audio.current.onended = null;
      audio.current.onerror = null;
      audio.current.pause();
      audio.current = null;
    }
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = null;
  };

  const browserAvailable = () =>
    typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  useEffect(() => {
    let active = true;
    const canSpeakInBrowser = browserAvailable();
    const synthesis = canSpeakInBrowser ? window.speechSynthesis : null;
    const refreshVoices = () => {
      const availableVoices = synthesis?.getVoices() ?? [];
      setVoices(availableVoices);
      if (availableVoices.length > 0) setVoiceListReady(true);
    };
    refreshVoices();
    synthesis?.addEventListener('voiceschanged', refreshVoices);
    const voiceListTimeout = setTimeout(() => setVoiceListReady(true), 1200);

    getVoiceProviderAvailability()
      .then((availability) => {
        if (!active) return;
        if (availability.textToSpeechAvailable && availability.textToSpeechProcessingLocation === 'local') {
          setMode('local');
          setActiveMode('local');
          setState('ready');
        } else if (canSpeakInBrowser) {
          setMode('browser');
          setActiveMode('browser');
          setState('ready');
        } else {
          setMode('unavailable');
          setActiveMode('unavailable');
          setState('unavailable');
          emit({ type: 'speech_unavailable' });
        }
      })
      .catch(() => {
        if (!active) return;
        if (canSpeakInBrowser) {
          setMode('browser');
          setActiveMode('browser');
          setState('ready');
        } else {
          setMode('unavailable');
          setActiveMode('unavailable');
          setState('unavailable');
          emit({ type: 'speech_unavailable' });
        }
      });

    return () => {
      active = false;
      operation.current += 1;
      request.current?.abort();
      request.current = null;
      clearTimeout(voiceListTimeout);
      synthesis?.removeEventListener('voiceschanged', refreshVoices);
      clearStartTimer();
      synthesis?.cancel();
      utterance.current = null;
      releaseAudio();
    };
    // Voice capability is detected once for this mounted output control.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = () => {
    operation.current += 1;
    request.current?.abort();
    request.current = null;
    clearStartTimer();
    if (browserAvailable()) window.speechSynthesis.cancel();
    const wasActive = Boolean(utterance.current || audio.current || state === 'starting');
    utterance.current = null;
    releaseAudio();
    if (wasActive) emit({ type: 'speech_cancelled' });
    setState(mode === 'unavailable' ? 'unavailable' : 'ready');
  };

  const speakInBrowser = (operationId: number) => {
    if (!browserAvailable()) return false;
    const synthesis = window.speechSynthesis;
    const nextUtterance = new SpeechSynthesisUtterance(text);
    nextUtterance.lang = speechLanguage(language);
    nextUtterance.rate = 0.96;
    const preferredPrefix = nextUtterance.lang.toLowerCase().slice(0, 2);
    const matchingVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith(preferredPrefix));
    if (matchingVoice) nextUtterance.voice = matchingVoice;
    nextUtterance.onstart = () => {
      if (operation.current !== operationId || utterance.current !== nextUtterance) return;
      clearStartTimer();
      setActiveMode('browser');
      setState('speaking');
      emit({ type: 'speech_started' });
    };
    nextUtterance.onpause = () => {
      if (operation.current !== operationId || utterance.current !== nextUtterance) return;
      setState('paused');
      emit({ type: 'speech_paused' });
    };
    nextUtterance.onresume = () => {
      if (operation.current !== operationId || utterance.current !== nextUtterance) return;
      setState('speaking');
      emit({ type: 'speech_started' });
    };
    nextUtterance.onend = () => {
      if (operation.current !== operationId || utterance.current !== nextUtterance) return;
      clearStartTimer();
      utterance.current = null;
      setState('ready');
      emit({ type: 'speech_finished' });
    };
    nextUtterance.onerror = (event) => {
      if (operation.current !== operationId || utterance.current !== nextUtterance) return;
      clearStartTimer();
      utterance.current = null;
      if (event.error === 'canceled' || event.error === 'interrupted') {
        setState('ready');
        emit({ type: 'speech_cancelled' });
        return;
      }
      const detail = 'Speech playback failed. Check your device audio and try again.';
      setError(detail);
      setState('error');
      emit({ type: 'speech_failed', detail });
    };

    utterance.current = nextUtterance;
    setActiveMode('browser');
    setState('starting');
    startTimer.current = setTimeout(() => {
      if (operation.current === operationId && utterance.current === nextUtterance) {
        synthesis.cancel();
        utterance.current = null;
        const detail = 'Speech did not start. Try again or read the response below.';
        setError(detail);
        setState('error');
        emit({ type: 'speech_failed', detail });
      }
    }, 6000);
    synthesis.speak(nextUtterance);
    return true;
  };

  const play = async () => {
    if (!text.trim() || mode === 'unavailable' || state === 'checking') return;
    const operationId = ++operation.current;
    request.current?.abort();
    request.current = null;
    clearStartTimer();
    if (browserAvailable()) window.speechSynthesis.cancel();
    utterance.current = null;
    releaseAudio();
    setError(null);

    if (mode === 'local') {
      const controller = new AbortController();
      request.current = controller;
      setActiveMode('local');
      setState('starting');
      try {
        const audioBlob = await synthesizeVoiceSpeech(text, apiLanguage(language), controller.signal);
        if (operation.current !== operationId) return;
        request.current = null;
        const url = URL.createObjectURL(audioBlob);
        const player = new Audio(url);
        audioUrl.current = url;
        audio.current = player;
        player.onplay = () => {
          if (operation.current !== operationId || audio.current !== player) return;
          setActiveMode('local');
          setState('speaking');
          emit({ type: 'speech_started' });
        };
        player.onpause = () => {
          if (operation.current !== operationId || audio.current !== player || player.ended) return;
          setState('paused');
          emit({ type: 'speech_paused' });
        };
        player.onended = () => {
          if (operation.current !== operationId || audio.current !== player) return;
          releaseAudio();
          setState('ready');
          emit({ type: 'speech_finished' });
        };
        player.onerror = () => {
          if (operation.current !== operationId || audio.current !== player) return;
          releaseAudio();
          const detail = 'Local speech audio could not be played.';
          if (speakInBrowser(operationId)) {
            setError(`${detail} Using your browser voice instead.`);
          } else {
            setError(detail);
            setState('error');
            emit({ type: 'speech_failed', detail });
          }
        };
        await player.play();
      } catch (cause) {
        if (operation.current !== operationId || controller.signal.aborted) return;
        request.current = null;
        releaseAudio();
        const detail = cause instanceof Error ? cause.message : 'Local speech output failed.';
        if (speakInBrowser(operationId)) {
          setError(`${detail} Using your browser voice instead.`);
        } else {
          setError(detail);
          setState('error');
          emit({ type: 'speech_failed', detail });
        }
      }
      return;
    }

    if (!speakInBrowser(operationId)) {
      setState('unavailable');
      emit({ type: 'speech_unavailable' });
    }
  };

  const togglePause = () => {
    if (activeMode === 'local' && audio.current) {
      if (state === 'speaking') audio.current.pause();
      else if (state === 'paused') void audio.current.play();
    } else if (browserAvailable()) {
      if (state === 'speaking') window.speechSynthesis.pause();
      else if (state === 'paused') window.speechSynthesis.resume();
    }
  };

  const statusText = state === 'checking'
    ? 'Checking speech support…'
    : state === 'starting'
      ? 'Preparing speech…'
      : state === 'speaking'
        ? 'Speaking response'
        : state === 'paused'
          ? 'Speech paused'
          : state === 'unavailable'
            ? 'Speech output unavailable'
            : state === 'error'
              ? 'Playback needs attention'
              : activeMode === 'local'
                ? 'Ready · local speech'
                : voiceListReady || voices.length > 0
                  ? 'Ready · browser speech'
                  : 'Using your device voice';

  return (
    <section className="mt-7 rounded-2xl border border-violet-200 bg-violet-50/70 p-5 dark:border-violet-900/70 dark:bg-violet-950/20" aria-label="Guide response">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200">
        <Volume2 className="h-4 w-4" aria-hidden="true" /> Guide response
      </div>
      <p className="mt-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">{text}</p>

      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400" role="status" aria-live="polite">{statusText}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {(state === 'speaking' || state === 'paused') && (
          <button type="button" onClick={togglePause} aria-label={state === 'speaking' ? 'Pause spoken response' : 'Resume spoken response'} className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white">
            {state === 'speaking' ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
            {state === 'speaking' ? 'Pause' : 'Resume'}
          </button>
        )}
        {state !== 'speaking' && state !== 'paused' && (
          <button type="button" onClick={() => void play()} disabled={state === 'checking' || state === 'unavailable' || state === 'starting'} className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white">
            {state === 'starting' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
            {state === 'starting' ? 'Starting…' : 'Play response'}
          </button>
        )}
        <button type="button" onClick={() => void play()} disabled={state === 'checking' || state === 'unavailable' || state === 'starting'} aria-label="Replay spoken response from the beginning" className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-zinc-300 px-4 text-sm font-medium text-zinc-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900">
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> Replay
        </button>
        {(state === 'starting' || state === 'speaking' || state === 'paused') && (
          <button type="button" onClick={cancel} aria-label="Cancel spoken response" className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-zinc-300 px-4 text-sm font-medium text-zinc-700 hover:bg-white dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900">
            <X className="h-4 w-4" aria-hidden="true" /> Stop
          </button>
        )}
      </div>

      {state === 'unavailable' && <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Your transcript and this response are still available to read. Speech synthesis is not configured here.</p>}
      {error && <p role="alert" className="mt-3 text-xs text-amber-700 dark:text-amber-300">{error}</p>}
      <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
        {activeMode === 'local'
          ? 'Spoken locally by LawSense. No audio is saved to the case.'
          : mode === 'local'
            ? 'Local speech is preferred when available. Browser speech may use a browser managed service. No audio is saved to the case.'
            : 'Spoken by your browser using its available voice. Browser speech synthesis may use a browser managed service. No audio is saved to the case.'}
      </p>
    </section>
  );
}
