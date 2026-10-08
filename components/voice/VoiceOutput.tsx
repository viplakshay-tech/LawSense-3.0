'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play, RotateCcw, Volume2 } from 'lucide-react';
import styles from './VoiceOutput.module.css';

type OutputState = 'checking' | 'ready' | 'starting' | 'speaking' | 'paused' | 'unavailable' | 'error';

interface VoiceOutputProps {
  text: string;
  language?: string | null;
}

function speechLanguage(language: string | null | undefined): string {
  if (language === 'english') return 'en-IN';
  return 'hi-IN';
}

export default function VoiceOutput({ text, language }: VoiceOutputProps) {
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<OutputState>('checking');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [voiceListReady, setVoiceListReady] = useState(false);

  const clearStartTimer = () => {
    if (startTimer.current) clearTimeout(startTimer.current);
    startTimer.current = null;
  };

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      const unavailableTimer = setTimeout(() => setState('unavailable'), 0);
      return () => clearTimeout(unavailableTimer);
    }

    const synthesis = window.speechSynthesis;
    const refreshVoices = () => {
      const availableVoices = synthesis.getVoices();
      setVoices(availableVoices);
      if (availableVoices.length > 0) setVoiceListReady(true);
    };
    refreshVoices();
    synthesis.addEventListener('voiceschanged', refreshVoices);
    const readyTimer = setTimeout(() => setState('ready'), 0);
    const voiceListTimeout = setTimeout(() => setVoiceListReady(true), 1200);

    return () => {
      clearTimeout(voiceListTimeout);
      clearTimeout(readyTimer);
      synthesis.removeEventListener('voiceschanged', refreshVoices);
      clearStartTimer();
      synthesis.cancel();
      utterance.current = null;
    };
    // Voice capability is detected once for this mounted output control.
  }, []);

  const play = () => {
    if (!text.trim() || state === 'unavailable' || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const synthesis = window.speechSynthesis;
    synthesis.cancel();
    clearStartTimer();
    setError(null);

    const nextUtterance = new SpeechSynthesisUtterance(text);
    nextUtterance.lang = speechLanguage(language);
    nextUtterance.rate = 0.96;
    const preferredPrefix = nextUtterance.lang.toLowerCase().slice(0, 2);
    const matchingVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith(preferredPrefix));
    if (matchingVoice) nextUtterance.voice = matchingVoice;
    nextUtterance.onstart = () => {
      if (utterance.current !== nextUtterance) return;
      clearStartTimer();
      setState('speaking');
    };
    nextUtterance.onpause = () => {
      if (utterance.current === nextUtterance) setState('paused');
    };
    nextUtterance.onresume = () => {
      if (utterance.current === nextUtterance) setState('speaking');
    };
    nextUtterance.onend = () => {
      if (utterance.current !== nextUtterance) return;
      clearStartTimer();
      utterance.current = null;
      setState('ready');
    };
    nextUtterance.onerror = (event) => {
      if (utterance.current !== nextUtterance) return;
      clearStartTimer();
      utterance.current = null;
      if (event.error === 'canceled' || event.error === 'interrupted') {
        setState('ready');
        return;
      }
      setError('Speech playback failed. Check your device audio and try again.');
      setState('error');
    };

    utterance.current = nextUtterance;
    setState('starting');
    startTimer.current = setTimeout(() => {
      if (utterance.current === nextUtterance) {
        synthesis.cancel();
        utterance.current = null;
        setError('Speech did not start. Try again or read the response below.');
        setState('error');
      }
    }, 6000);
    synthesis.speak(nextUtterance);
  };

  const togglePause = () => {
    if (state === 'speaking') {
      window.speechSynthesis.pause();
    } else if (state === 'paused') {
      window.speechSynthesis.resume();
    }
  };

  const guideIsSpeaking = state === 'speaking';

  return (
    <section className="mt-7 rounded-2xl border border-violet-200 bg-violet-50/70 p-5 dark:border-violet-900/70 dark:bg-violet-950/20" aria-label="Spoken response">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex items-center gap-3 sm:w-44 sm:shrink-0 sm:flex-col sm:items-start">
          <div className={`${styles.guide} ${guideIsSpeaking ? styles.speaking : ''}`} aria-hidden="true">
            <span className={styles.eyeRow}><i /><i /></span>
            <span className={styles.mouth} />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">LawSense guide</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400" role="status" aria-live="polite">
              {state === 'checking'
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
                          : voiceListReady || voices.length > 0
                            ? 'Ready to speak'
                            : 'Using your device voice'}
            </p>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200">
            <Volume2 className="h-4 w-4" aria-hidden="true" /> Spoken response
          </div>
          <p className="mt-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">{text}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            {(state === 'speaking' || state === 'paused') && (
              <button
                type="button"
                onClick={togglePause}
                aria-label={state === 'speaking' ? 'Pause spoken response' : 'Resume spoken response'}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                {state === 'speaking' ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
                {state === 'speaking' ? 'Pause' : 'Resume'}
              </button>
            )}
            {state !== 'speaking' && state !== 'paused' && (
              <button
                type="button"
                onClick={play}
                disabled={state === 'checking' || state === 'unavailable' || state === 'starting'}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                {state === 'starting' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
                {state === 'starting' ? 'Starting…' : state === 'ready' || state === 'error' ? 'Play response' : 'Play response'}
              </button>
            )}
            <button
              type="button"
              onClick={play}
              disabled={state === 'checking' || state === 'unavailable' || state === 'starting'}
              aria-label="Replay spoken response from the beginning"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-zinc-300 px-4 text-sm font-medium text-zinc-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Replay
            </button>
          </div>

          {state === 'unavailable' && <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Your transcript and this response are still available to read. Browser speech synthesis is not supported here.</p>}
          {error && <p role="alert" className="mt-3 text-xs text-amber-700 dark:text-amber-300">{error}</p>}
          <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">Spoken by your browser using its available voice. No audio is saved to the case.</p>
        </div>
      </div>
    </section>
  );
}
