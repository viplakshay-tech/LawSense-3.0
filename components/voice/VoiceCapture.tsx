'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, MicOff, RotateCcw, X } from 'lucide-react';
import styles from './VoiceCapture.module.css';
import { getVoiceProviderAvailability, transcribeVoiceAudio } from '@/lib/api';

export type RecognitionLanguage = 'English' | 'Hindi' | 'Hinglish';

interface SpeechResultAlternative {
  transcript: string;
}

interface SpeechResult {
  isFinal: boolean;
  0: SpeechResultAlternative;
}

interface SpeechResultList {
  length: number;
  [index: number]: SpeechResult;
}

interface SpeechRecognitionResultEvent extends Event {
  results: SpeechResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface BrowserRecognitionSession {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface BrowserRecognitionConstructor {
  new (): BrowserRecognitionSession;
}

interface RecognitionWindow extends Window {
  SpeechRecognition?: BrowserRecognitionConstructor;
  webkitSpeechRecognition?: BrowserRecognitionConstructor;
}

/** Provider boundary keeps browser speech recognition replaceable. */
export interface SpeechRecognitionProvider {
  create(language: RecognitionLanguage): BrowserRecognitionSession | null;
}

export class BrowserSpeechRecognitionProvider implements SpeechRecognitionProvider {
  get isAvailable(): boolean {
    if (typeof window === 'undefined') return false;
    const browserWindow = window as RecognitionWindow;
    return Boolean(browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition);
  }

  create(language: RecognitionLanguage): BrowserRecognitionSession | null {
    if (typeof window === 'undefined') return null;
    const browserWindow = window as RecognitionWindow;
    const Recognition = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Recognition) return null;

    const session = new Recognition();
    session.lang = language === 'English' ? 'en-IN' : 'hi-IN';
    session.continuous = true;
    session.interimResults = true;
    return session;
  }
}

interface VoiceCaptureProps {
  language: RecognitionLanguage;
  disabled?: boolean;
  onTranscript: (transcript: string) => void;
  onCaptureStateChange?: (active: boolean) => void;
  onCaptureStatusChange?: (status: 'idle' | 'listening' | 'processing') => void;
  onCaptureEvent?: (event: VoiceCaptureEvent) => void;
}

export type VoiceCaptureEvent =
  | { type: 'capture_started'; captureId: string; provider: 'browser' | 'server'; language: RecognitionLanguage }
  | { type: 'capture_cancelled'; captureId: string }
  | { type: 'capture_failed'; captureId: string; detail: string };

const BAR_COUNT = 18;
const QUIET_WAVEFORM = Array.from({ length: BAR_COUNT }, () => 0.08);

function errorMessage(code: string): string {
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return 'Microphone access was blocked. Allow access in your browser settings or type your statement.';
  }
  if (code === 'no-speech') return 'No speech was recognized. No transcript was created.';
  if (code === 'network') return 'The browser speech provider is unavailable right now. You can try again or type your statement.';
  if (code === 'audio-capture') return 'No microphone was found. Connect one or type your statement.';
  return 'Speech recognition stopped before a transcript was available. You can try again or type your statement.';
}

export default function VoiceCapture({ language, disabled = false, onTranscript, onCaptureStateChange, onCaptureStatusChange, onCaptureEvent }: VoiceCaptureProps) {
  const provider = useRef(new BrowserSpeechRecognitionProvider());
  const session = useRef<BrowserRecognitionSession | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const animationFrame = useRef<number | null>(null);
  const operationId = useRef(0);
  const captureId = useRef<string | null>(null);
  const cancelRequested = useRef(false);
  const lastCaptureBusy = useRef(false);
  const [providerMode, setProviderMode] = useState<'checking' | 'browser' | 'server' | 'unavailable'>('checking');
  const [permissionPending, setPermissionPending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [hasMeter, setHasMeter] = useState(false);
  const [waveform, setWaveform] = useState<number[]>(QUIET_WAVEFORM);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unavailableDetail, setUnavailableDetail] = useState<string | null>(null);

  const stopMeter = (stopTracks = true, updateState = true) => {
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
    animationFrame.current = null;
    if (audioContext.current) {
      void audioContext.current.close().catch(() => undefined);
      audioContext.current = null;
    }
    if (stopTracks) {
      mediaStream.current?.getTracks().forEach((track) => track.stop());
      mediaStream.current = null;
    }
    if (updateState) {
      setHasMeter(false);
      setWaveform(QUIET_WAVEFORM);
    }
  };

  const startMeter = (stream: MediaStream) => {
    try {
      const context = new window.AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      audioContext.current = context;
      setHasMeter(true);

      const samples = new Uint8Array(analyser.fftSize);
      const samplesPerBar = Math.max(1, Math.floor(samples.length / BAR_COUNT));
      let lastUpdate = 0;
      const draw = (time: number) => {
        if (!audioContext.current) return;
        animationFrame.current = requestAnimationFrame(draw);
        if (time - lastUpdate < 70) return;
        lastUpdate = time;
        analyser.getByteTimeDomainData(samples);
        const levels = Array.from({ length: BAR_COUNT }, (_, index) => {
          const start = index * samplesPerBar;
          const end = Math.min(samples.length, start + samplesPerBar);
          let squared = 0;
          for (let cursor = start; cursor < end; cursor += 1) {
            const normalized = (samples[cursor] - 128) / 128;
            squared += normalized * normalized;
          }
          const rms = Math.sqrt(squared / Math.max(1, end - start));
          return Math.min(1, Math.max(0.08, rms * 3.6));
        });
        setWaveform(levels);
      };
      animationFrame.current = requestAnimationFrame(draw);
    } catch {
      setHasMeter(false);
    }
  };

  useEffect(() => {
    let active = true;
    const browserAvailable = provider.current.isAvailable;
    const canRecordAudio = Boolean(
      typeof window !== 'undefined' &&
      'MediaRecorder' in window &&
      navigator.mediaDevices?.getUserMedia,
    );

    // Prefer the browser speech API. The configured audio service is a fallback.
    if (browserAvailable) setProviderMode('browser');
    getVoiceProviderAvailability()
      .then((availability) => {
        if (!active) return;
        if (browserAvailable) {
          setProviderMode('browser');
        } else if (canRecordAudio && availability.speechToTextAvailable && availability.languageDetectorAvailable) {
          setProviderMode('server');
        } else {
          setProviderMode('unavailable');
          setUnavailableDetail(
            !canRecordAudio
              ? 'This browser has no microphone recording API.'
              : availability.detail || 'No compatible speech provider is available.',
          );
        }
      })
      .catch((cause) => {
        if (!active) return;
        if (browserAvailable) {
          setProviderMode('browser');
        } else {
          setProviderMode('unavailable');
          setUnavailableDetail(cause instanceof Error ? cause.message : 'Speech provider status is unavailable.');
        }
      });

    return () => {
      active = false;
      cancelRequested.current = true;
      operationId.current += 1;
      if (session.current) {
        session.current.onresult = null;
        session.current.onerror = null;
        session.current.onend = null;
      }
      session.current?.abort();
      session.current = null;
      if (mediaRecorder.current) {
        mediaRecorder.current.ondataavailable = null;
        mediaRecorder.current.onerror = null;
        mediaRecorder.current.onstop = null;
        if (mediaRecorder.current.state === 'recording') mediaRecorder.current.stop();
      }
      stopMeter(true, false);
    };
    // This effect owns provider detection and the capture resources for this mount.
  }, []);

  const finishBrowserCapture = (recognition: BrowserRecognitionSession, candidate: string) => {
    setRecording(false);
    setStopping(false);
    session.current = null;
    stopMeter();
    if (cancelRequested.current) return;
    if (candidate.trim()) {
      setLiveTranscript(candidate.trim());
      onTranscript(candidate.trim());
    } else {
      const detail = 'No transcript was produced. Nothing was saved. Try again or type your statement.';
      setError((current) => current ?? detail);
      if (captureId.current) onCaptureEvent?.({ type: 'capture_failed', captureId: captureId.current, detail });
    }
    captureId.current = null;
    recognition.onend = null;
  };

  const startServerRecording = async () => {
    setError(null);
    setNotice(null);
    setLiveTranscript('');
    cancelRequested.current = false;
    const currentOperation = ++operationId.current;
    let acquiredStream: MediaStream | null = null;
    setPermissionPending(true);
    try {
      acquiredStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setPermissionPending(false);
      if (currentOperation !== operationId.current || cancelRequested.current) {
        acquiredStream.getTracks().forEach((track) => track.stop());
        return;
      }
      const recorder = new MediaRecorder(acquiredStream);
      const chunks: BlobPart[] = [];
      mediaStream.current = acquiredStream;
      mediaRecorder.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => {
        setRecording(false);
        setStopping(false);
        const detail = 'Audio recording failed. No transcript was created. You can try again or type your statement.';
        setError(detail);
        if (captureId.current) onCaptureEvent?.({ type: 'capture_failed', captureId: captureId.current, detail });
        captureId.current = null;
        mediaRecorder.current = null;
        stopMeter();
      };
      recorder.onstop = async () => {
        setRecording(false);
        setStopping(false);
        if (cancelRequested.current || currentOperation !== operationId.current) {
          stopMeter();
          mediaRecorder.current = null;
          return;
        }
        setProcessing(true);
        const audio = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        stopMeter();
        mediaRecorder.current = null;
        if (audio.size === 0) {
          const detail = 'No audio was captured. No transcript was created. Try again or type your statement.';
          setError(detail);
          if (captureId.current) onCaptureEvent?.({ type: 'capture_failed', captureId: captureId.current, detail });
          captureId.current = null;
          setProcessing(false);
          return;
        }
        try {
          const result = await transcribeVoiceAudio(audio);
          if (currentOperation !== operationId.current || cancelRequested.current) return;
          if (result.transcript?.trim()) {
            setLiveTranscript(result.transcript.trim());
            onTranscript(result.transcript.trim());
            captureId.current = null;
          }
          if (result.status !== 'success') {
            const detail = result.detail || `Speech provider status: ${result.status.replaceAll('_', ' ')}.`;
            setError(detail);
            if (captureId.current) onCaptureEvent?.({ type: 'capture_failed', captureId: captureId.current, detail });
            captureId.current = null;
          } else if (!result.transcript?.trim()) {
            const detail = 'No transcript was produced. Nothing was saved. Try again or type your statement.';
            setError(detail);
            if (captureId.current) onCaptureEvent?.({ type: 'capture_failed', captureId: captureId.current, detail });
            captureId.current = null;
          }
        } catch (cause) {
          if (currentOperation === operationId.current && !cancelRequested.current) {
            const detail = cause instanceof Error ? cause.message : 'Speech processing failed. No transcript was created.';
            setError(detail);
            if (captureId.current) onCaptureEvent?.({ type: 'capture_failed', captureId: captureId.current, detail });
            captureId.current = null;
          }
        } finally {
          if (currentOperation === operationId.current) setProcessing(false);
        }
      };
      setRecording(true);
      recorder.start();
      startMeter(acquiredStream);
    } catch (cause) {
      setPermissionPending(false);
      acquiredStream?.getTracks().forEach((track) => track.stop());
      mediaStream.current = null;
      if (currentOperation !== operationId.current || cancelRequested.current) return;
      mediaRecorder.current = null;
      setRecording(false);
      setStopping(false);
      setError(
        cause instanceof Error && cause.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow access in your browser settings or type your statement.'
          : 'Microphone access was unavailable. Check your microphone, try again, or type your statement.',
      );
      if (captureId.current) {
        onCaptureEvent?.({
          type: 'capture_failed',
          captureId: captureId.current,
          detail: cause instanceof Error ? cause.message : 'Microphone access was unavailable.',
        });
      }
      captureId.current = null;
    }
  };

  const startBrowserRecognition = () => {
    setError(null);
    setNotice(null);
    setLiveTranscript('');
    cancelRequested.current = false;
    const recognition = provider.current.create(language);
    if (!recognition) {
      const detail = 'Voice input is unavailable in this browser. You can type your statement instead.';
      setError(detail);
      if (captureId.current) onCaptureEvent?.({ type: 'capture_failed', captureId: captureId.current, detail });
      captureId.current = null;
      return;
    }

    let candidate = '';
    recognition.onresult = (event) => {
      const parts: string[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        const text = event.results[index][0]?.transcript?.trim();
        if (text) parts.push(text);
      }
      candidate = parts.join(' ').replace(/\s+/g, ' ').trim();
      setLiveTranscript(candidate);
    };
    recognition.onerror = (event) => {
      if (!cancelRequested.current) {
        const detail = errorMessage(event.error);
        setError(detail);
      }
    };
    recognition.onend = () => finishBrowserCapture(recognition, candidate);

    session.current = recognition;
    setRecording(true);
    try {
      recognition.start();
      // Web Speech does not expose microphone samples. A parallel local stream feeds
      // the waveform when the browser allows it; recognition still works without it.
      if (navigator.mediaDevices?.getUserMedia) {
        void navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
          if (session.current !== recognition || cancelRequested.current) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          mediaStream.current = stream;
          startMeter(stream);
        }).catch(() => undefined);
      }
    } catch {
      session.current = null;
      setRecording(false);
      const detail = 'The microphone could not start. Check browser permission and try again.';
      setError(detail);
      if (captureId.current) onCaptureEvent?.({ type: 'capture_failed', captureId: captureId.current, detail });
      captureId.current = null;
    }
  };

  const start = () => {
    if (disabled || recording || processing || permissionPending || providerMode === 'checking' || providerMode === 'unavailable') return;
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `capture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    captureId.current = id;
    const captureProvider = providerMode === 'server' ? 'server' : 'browser';
    onCaptureEvent?.({ type: 'capture_started', captureId: id, provider: captureProvider, language });
    if (providerMode === 'server') void startServerRecording();
    else startBrowserRecognition();
  };

  const stop = () => {
    if (stopping) return;
    setStopping(true);
    if (session.current) session.current.stop();
    else if (mediaRecorder.current?.state === 'recording') mediaRecorder.current.stop();
    else {
      setStopping(false);
      setRecording(false);
    }
  };

  const cancel = () => {
    cancelRequested.current = true;
    operationId.current += 1;
    if (captureId.current) {
      onCaptureEvent?.({ type: 'capture_cancelled', captureId: captureId.current });
      captureId.current = null;
    }
    if (session.current) {
      const activeSession = session.current;
      activeSession.onresult = null;
      activeSession.onerror = null;
      activeSession.onend = null;
      session.current = null;
      activeSession.abort();
    }
    if (mediaRecorder.current) {
      mediaRecorder.current.ondataavailable = null;
      mediaRecorder.current.onerror = null;
      mediaRecorder.current.onstop = null;
      if (mediaRecorder.current.state === 'recording') mediaRecorder.current.stop();
      mediaRecorder.current = null;
    }
    stopMeter();
    setRecording(false);
    setStopping(false);
    setPermissionPending(false);
    setProcessing(false);
    setLiveTranscript('');
    setError(null);
    setNotice('Voice capture canceled. No draft was added.');
  };

  const busy = recording || stopping || processing || permissionPending;
  const captureStatus = recording ? 'listening' : busy ? 'processing' : 'idle';
  const modeLabel = providerMode === 'browser'
    ? 'Speech recognition is provided by your browser.'
    : 'Audio is sent to LawSense for the configured speech provider.';

  useEffect(() => {
    if (lastCaptureBusy.current === busy) return;
    lastCaptureBusy.current = busy;
    onCaptureStateChange?.(busy);
  }, [busy, onCaptureStateChange]);

  useEffect(() => {
    onCaptureStatusChange?.(captureStatus);
  }, [captureStatus, onCaptureStatusChange]);

  return (
    <div className="flex min-w-[14rem] flex-col gap-2" role="group" aria-label="Voice input controls">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={busy ? stop : start}
          disabled={disabled || processing || stopping || permissionPending || providerMode === 'checking' || (providerMode === 'unavailable' && !recording)}
          aria-label={recording ? 'Stop voice input' : providerMode === 'unavailable' ? 'Voice input unavailable' : 'Start voice input'}
          aria-pressed={recording}
          title={modeLabel}
          className={`inline-flex h-11 items-center justify-center gap-2 rounded-full border px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:text-zinc-400 dark:disabled:text-zinc-600 ${recording ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900'}`}
        >
          {processing || permissionPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : recording ? <MicOff className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
          {permissionPending
            ? 'Waiting for microphone…'
            : processing
              ? 'Processing audio…'
            : stopping
              ? 'Finishing…'
              : recording
                ? 'Stop recording'
                : providerMode === 'browser'
                  ? 'Speak'
                  : providerMode === 'server'
                    ? 'Record audio'
                    : providerMode === 'checking'
                      ? 'Checking voice…'
                      : 'Voice unavailable'}
        </button>

        {busy && (
          <button
            type="button"
            onClick={cancel}
            aria-label="Cancel voice capture and discard this take"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" aria-hidden="true" /> Cancel
          </button>
        )}
        {error && !busy && (
          <button
            type="button"
            onClick={start}
            disabled={disabled || providerMode === 'checking' || providerMode === 'unavailable'}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Retry
          </button>
        )}
      </div>

      {(recording || processing || permissionPending) && (
        <div className="flex items-center gap-2" role="status" aria-live="polite">
          {recording ? <span className={styles.recordingDot} aria-hidden="true" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" aria-hidden="true" />}
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {permissionPending ? 'Waiting for microphone permission…' : processing ? 'Preparing your transcript. Nothing is saved yet.' : stopping ? 'Finishing this take…' : 'Listening… Select Stop when you are done.'}
          </span>
        </div>
      )}

      {recording && (
        <div className="flex h-9 items-center gap-[3px] rounded-xl bg-zinc-50 px-3 dark:bg-zinc-900/70" aria-label={hasMeter ? 'Live microphone waveform' : 'Listening waveform'} role="img">
          {waveform.map((level, index) => (
            <span
              key={index}
              className={`${styles.waveBar} ${!hasMeter ? styles.waveBarAnimated : ''}`}
              style={{ height: `${Math.max(3, level * 28)}px`, animationDelay: `${(index % 7) * 65}ms` }}
            />
          ))}
          <span className="sr-only">Microphone is actively listening.</span>
        </div>
      )}

      {liveTranscript && (
        <div className="max-w-sm rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950" aria-live="polite">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{recording ? 'Live transcript · draft' : 'Transcript draft'}</p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">{liveTranscript}</p>
        </div>
      )}

      {providerMode === 'checking' && (
        <p className="max-w-sm text-xs text-zinc-500 dark:text-zinc-400">Checking microphone and speech support… You can still type your statement.</p>
      )}
      {providerMode === 'unavailable' && (
        <p className="max-w-xs text-xs text-zinc-500 dark:text-zinc-400">
          Voice input is unavailable: {unavailableDetail || 'no compatible provider is configured.'} Type your statement instead.
        </p>
      )}
      {error && <p role="alert" className="max-w-sm text-xs text-amber-700 dark:text-amber-300">{error}</p>}
      {notice && <p role="status" className="max-w-sm text-xs text-zinc-500 dark:text-zinc-400">{notice}</p>}
      {providerMode === 'browser' && (
        <p className="max-w-sm text-xs text-zinc-500 dark:text-zinc-400">
          Your browser handles speech recognition, which may use its own speech service. Review and edit the transcript before adding it to the case.
        </p>
      )}
      {providerMode === 'server' && (
        <p className="max-w-sm text-xs text-zinc-500 dark:text-zinc-400">
          Audio is sent to LawSense for the configured speech provider. Review and edit the transcript before adding it to the case.
        </p>
      )}
    </div>
  );
}
