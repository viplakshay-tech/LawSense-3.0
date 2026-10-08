'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
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
}

function errorMessage(code: string): string {
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return 'Microphone access was blocked. Allow access in your browser settings or type your statement.';
  }
  if (code === 'no-speech') return 'No speech was recognized. No transcript was created.';
  if (code === 'network') return 'The browser speech provider is unavailable right now. You can type your statement instead.';
  return 'Speech recognition stopped before a transcript was available. You can try again or type your statement.';
}

export default function VoiceCapture({ language, disabled = false, onTranscript }: VoiceCaptureProps) {
  const provider = useRef(new BrowserSpeechRecognitionProvider());
  const session = useRef<BrowserRecognitionSession | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const [providerMode, setProviderMode] = useState<'checking' | 'browser' | 'server' | 'unavailable'>('checking');
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailableDetail, setUnavailableDetail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const browserAvailable = provider.current.isAvailable;
    const canRecordAudio = Boolean(
      typeof window !== 'undefined' &&
      'MediaRecorder' in window &&
      navigator.mediaDevices?.getUserMedia,
    );
    getVoiceProviderAvailability()
      .then((availability) => {
        if (!active) return;
        if (canRecordAudio && availability.speechToTextAvailable && availability.languageDetectorAvailable) {
          setProviderMode('server');
        } else if (browserAvailable) {
          setProviderMode('browser');
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
      mediaStream.current?.getTracks().forEach((track) => track.stop());
      mediaRecorder.current = null;
      mediaStream.current = null;
    };
  }, []);

  const stop = () => {
    if (session.current) session.current.stop();
    else if (mediaRecorder.current?.state === 'recording') mediaRecorder.current.stop();
  };

  const startServerRecording = async () => {
    setError(null);
    let stream: MediaStream | null = null;
    try {
      const acquiredStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream = acquiredStream;
      const recorder = new MediaRecorder(acquiredStream);
      const chunks: BlobPart[] = [];
      mediaStream.current = acquiredStream;
      mediaRecorder.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => {
        setRecording(false);
        recorder.onstop = null;
        acquiredStream.getTracks().forEach((track) => track.stop());
        mediaStream.current = null;
        mediaRecorder.current = null;
        setError('Audio recording failed. No transcript was created.');
      };
      recorder.onstop = async () => {
        setRecording(false);
        setProcessing(true);
        acquiredStream.getTracks().forEach((track) => track.stop());
        mediaStream.current = null;
        mediaRecorder.current = null;
        const audio = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (audio.size === 0) {
          setError('No audio was captured. No transcript was created.');
          setProcessing(false);
          return;
        }
        try {
          const result = await transcribeVoiceAudio(audio);
          if (result.transcript) onTranscript(result.transcript);
          if (result.status !== 'success') {
            setError(result.detail || `Speech provider status: ${result.status.replaceAll('_', ' ')}.`);
          }
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Speech processing failed. No transcript was created.');
        } finally {
          setProcessing(false);
        }
      };
      setRecording(true);
      recorder.start();
    } catch {
      setRecording(false);
      stream?.getTracks().forEach((track) => track.stop());
      mediaStream.current = null;
      mediaRecorder.current = null;
      setError('Microphone access was unavailable. Allow access in your browser settings or type your statement.');
    }
  };

  const start = () => {
    setError(null);
    if (providerMode === 'server') {
      void startServerRecording();
      return;
    }
    const recognition = provider.current.create(language);
    if (!recognition) {
      setError('Voice input is unavailable in this browser. You can type your statement instead.');
      return;
    }

    let finalTranscript = '';
    recognition.onresult = (event) => {
      const finalParts: string[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalParts.push(result[0].transcript);
      }
      finalTranscript = finalParts.join(' ').trim();
    };
    recognition.onerror = (event) => setError(errorMessage(event.error));
    recognition.onend = () => {
      setRecording(false);
      session.current = null;
      if (finalTranscript) onTranscript(finalTranscript);
      else setError((current) => current ?? 'No transcript was produced. Nothing was saved.');
    };

    session.current = recognition;
    setRecording(true);
    try {
      recognition.start();
    } catch {
      session.current = null;
      setRecording(false);
      setError('The microphone could not start. Check browser permission and try again.');
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={recording ? stop : start}
        disabled={disabled || processing || providerMode === 'checking' || (providerMode === 'unavailable' && !recording)}
        aria-label={recording ? 'Stop voice input' : providerMode === 'unavailable' ? 'Voice input unavailable' : 'Start voice input'}
        title={providerMode === 'browser' ? 'Speech recognition is provided by your browser.' : 'Audio is processed by the configured speech provider.'}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-zinc-200 px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:disabled:text-zinc-600"
      >
        {recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        {recording ? 'Stop recording' : processing ? 'Processing audio…' : providerMode === 'browser' ? 'Speak' : providerMode === 'server' ? 'Record audio' : providerMode === 'checking' ? 'Checking voice…' : 'Voice unavailable'}
      </button>
      {providerMode === 'unavailable' && (
        <p className="max-w-xs text-xs text-zinc-500 dark:text-zinc-400">
          Voice input is unavailable: {unavailableDetail || 'no compatible provider is configured.'} Type your statement instead.
        </p>
      )}
      {error && <p role="status" className="max-w-sm text-xs text-amber-700 dark:text-amber-300">{error}</p>}
      {providerMode === 'browser' && (
        <p className="max-w-sm text-xs text-zinc-500 dark:text-zinc-400">
          Your browser handles speech recognition, which may use its own speech service. Review and edit the transcript before saving.
        </p>
      )}
      {providerMode === 'server' && (
        <p className="max-w-sm text-xs text-zinc-500 dark:text-zinc-400">
          Audio is sent to LawSense for the configured speech provider. If none is available, no transcript will be produced.
        </p>
      )}
    </div>
  );
}
