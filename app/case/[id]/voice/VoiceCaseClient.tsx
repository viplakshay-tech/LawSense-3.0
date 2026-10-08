'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Loader2, Mic, ShieldAlert } from 'lucide-react';
import VoiceCapture, { type RecognitionLanguage } from '@/components/voice/VoiceCapture';
import {
  addVoiceStatement,
  previewVoiceTranscript,
  type VoiceTranscriptResponse,
} from '@/lib/api';
import { useCaseState } from '../CaseStateProvider';

const LANGUAGES: RecognitionLanguage[] = ['English', 'Hindi', 'Hinglish'];

function describeLanguage(value: string | null | undefined): string {
  if (value === 'english') return 'English';
  if (value === 'hindi') return 'Hindi';
  if (value === 'hinglish') return 'Hinglish';
  return value || 'Not detected';
}

export default function VoiceCaseClient({ id }: { id: string }) {
  const router = useRouter();
  const { caseState: caseData, loading, error: caseError, replaceCaseState, refreshCaseState } = useCaseState();
  const [transcript, setTranscript] = useState('');
  const [inputMethod, setInputMethod] = useState<'voice' | 'text'>('text');
  const [language, setLanguage] = useState<RecognitionLanguage>('Hinglish');
  const [preview, setPreview] = useState<VoiceTranscriptResponse | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewIsCurrent = preview?.transcript === transcript;
  const extractedFacts = useMemo(
    () => (previewIsCurrent ? preview?.caseState?.facts ?? [] : []),
    [preview, previewIsCurrent],
  );
  const questions = previewIsCurrent ? preview?.caseState?.unknowns ?? [] : [];

  const updateTranscript = (value: string) => {
    setTranscript(value);
    setPreview(null);
    setError(null);
  };

  const reviewTranscript = async () => {
    if (!transcript.trim()) {
      setError('Add or record a statement before reviewing it.');
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const result = await previewVoiceTranscript(transcript);
      setPreview(result);
      if (result.status !== 'success') {
        setError(result.detail || 'The transcript could not be processed. You can edit it and try again.');
      }
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : 'Transcript review failed.');
    } finally {
      setWorking(false);
    }
  };

  const commitTranscript = async () => {
    if (!previewIsCurrent || preview?.status !== 'success') return;
    setWorking(true);
    setError(null);
    try {
      const response = await addVoiceStatement(id, transcript, inputMethod);
      replaceCaseState(response.caseState);
      router.push(`/case/${encodeURIComponent(id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The statement could not be added to this case.');
      setWorking(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fafafa] text-zinc-500 dark:bg-[#0a0a0a]">
        <Loader2 className="mr-3 h-5 w-5 animate-spin" /> Loading case…
      </main>
    );
  }

  if (!caseData) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fafafa] p-6 dark:bg-[#0a0a0a]">
        <div className="max-w-md rounded-3xl border border-red-200 bg-white p-8 text-center dark:border-red-900/50 dark:bg-[#111]">
          <ShieldAlert className="mx-auto h-8 w-8 text-red-500" />
          <h1 className="mt-4 text-xl font-semibold">Case unavailable</h1>
          <p className="mt-2 text-sm text-zinc-500">{error || caseError || 'This case could not be loaded.'}</p>
          <button type="button" onClick={() => void refreshCaseState().catch(() => undefined)} className="mt-5 inline-flex min-h-10 items-center rounded-full border border-zinc-200 px-4 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-200">
            Try again
          </button>
          <Link href="/" className="mt-5 inline-flex rounded-full bg-zinc-900 px-5 py-2.5 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
            Go home
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#fafafa] px-5 py-8 text-zinc-900 dark:bg-[#0a0a0a] dark:text-zinc-50 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <Link
          href={`/case/${encodeURIComponent(id)}`}
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" /> Back to case
        </Link>

        <section className="mt-8 rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-[#111] sm:p-9">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
              <Mic className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-zinc-400">Add case details</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">Speak or type what happened</h1>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                This adds a new sourced statement to your case. You can review the transcript and extracted details before anything is saved.
              </p>
            </div>
          </div>

          <div className="mt-7 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <label className="flex flex-col gap-2 text-sm font-medium text-zinc-600 dark:text-zinc-300">
              Speech language
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value as RecognitionLanguage)}
                disabled={working}
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-900"
              >
                {LANGUAGES.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <VoiceCapture
              language={language}
              disabled={working}
              onTranscript={(spoken) => {
                setTranscript((current) => [current.trim(), spoken.trim()].filter(Boolean).join(' '));
                setInputMethod('voice');
                setPreview(null);
                setError(null);
              }}
            />
          </div>

          <label className="mt-6 block text-sm font-medium text-zinc-700 dark:text-zinc-200" htmlFor="voice-transcript">
            Transcript · edit anything that was misheard
          </label>
          <textarea
            id="voice-transcript"
            value={transcript}
            onChange={(event) => updateTranscript(event.target.value)}
            placeholder="Your recognized words will appear here. You can also type your statement."
            rows={7}
            disabled={working}
            className="mt-2 w-full resize-y rounded-2xl border border-zinc-200 bg-white p-4 text-base leading-relaxed outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500"
          />

          {error && (
            <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </p>
          )}

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={reviewTranscript}
              disabled={working || !transcript.trim()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-zinc-300 px-5 text-sm font-medium hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              {working && !previewIsCurrent ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Review transcript
            </button>
            <button
              type="button"
              onClick={commitTranscript}
              disabled={working || !previewIsCurrent || !preview || preview.status !== 'success' || !preview.caseState}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-zinc-900 px-5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {working && previewIsCurrent ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Add reviewed statement to case
            </button>
          </div>

          {previewIsCurrent && preview?.status === 'success' && preview.caseState && (
            <section aria-live="polite" className="mt-7 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 dark:border-emerald-900/70 dark:bg-emerald-950/20">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">Review the extracted details</h2>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                  Language · {describeLanguage(preview.language)}
                </span>
              </div>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                These are draft details extracted from the transcript. Add the statement to update the case clarification and journey.
              </p>
              {extractedFacts.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Extracted facts</h3>
                  <ul className="mt-2 space-y-2 text-sm">
                    {extractedFacts.slice(0, 6).map((fact) => (
                      <li key={fact.id} className="rounded-xl bg-white/80 px-3 py-2 dark:bg-zinc-900/80">
                        <span className="font-medium">{fact.key.replaceAll('_', ' ')}:</span> {String(fact.value)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {questions.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Still needs clarification</h3>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                    {questions.slice(0, 5).map((question) => <li key={question}>{question}</li>)}
                  </ul>
                </div>
              )}
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
