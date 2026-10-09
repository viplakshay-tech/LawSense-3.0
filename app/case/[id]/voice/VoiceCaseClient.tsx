'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, CheckCircle2, Loader2, Mic, PhoneOff, ShieldAlert } from 'lucide-react';
import { GuidePresence } from '@/components/guide-presence';
import { createGuideVoiceRuntimeAdapter } from '@/components/guide-runtime/voice-adapter/runtime';
import type { GuideVoiceEvent, VoiceInputMethod, VoiceLanguage } from '@/components/guide-runtime/voice-adapter/events';
import type { GuideVoiceRuntimeAdapter } from '@/components/guide-runtime/voice-adapter/runtime';
import VoiceCapture, { type RecognitionLanguage, type VoiceCaptureEvent } from '@/components/voice/VoiceCapture';
import VoiceOutput from '@/components/voice/VoiceOutput';
import {
  addVoiceStatement,
  previewVoiceTranscript,
  type CaseState,
  type VoiceTranscriptResponse,
} from '@/lib/api';
import { useCaseState } from '../CaseStateProvider';
import { guidePresenceStateFromSnapshot, useGuideRuntime } from '@/components/guide-runtime';

const LANGUAGES: RecognitionLanguage[] = ['English', 'Hindi', 'Hinglish'];

interface PendingCommit {
  draftId: string;
  caseState: CaseState;
  inputMethod: VoiceInputMethod;
}

function createId(prefix: string): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function asVoiceLanguage(value: RecognitionLanguage): VoiceLanguage {
  return value.toLocaleLowerCase() as VoiceLanguage;
}

function describeLanguage(value: string | null | undefined): string {
  if (value === 'english') return 'English';
  if (value === 'hindi') return 'Hindi';
  if (value === 'hinglish') return 'Hinglish';
  return value || 'Not detected';
}

export default function VoiceCaseClient({ id }: { id: string }) {
  const { caseState: caseData, loading, error: caseError, revision, replaceCaseState, refreshCaseState } = useCaseState();
  const { snapshot: guideRuntimeSnapshot, dispatch: dispatchCaseGuideEvent } = useGuideRuntime();
  const [transcript, setTranscript] = useState('');
  const [inputMethod, setInputMethod] = useState<VoiceInputMethod>('text');
  const [language, setLanguage] = useState<RecognitionLanguage>('Hinglish');
  const [draftId, setDraftId] = useState(() => createId('draft'));
  const [preview, setPreview] = useState<VoiceTranscriptResponse | null>(null);
  const [requestWorking, setRequestWorking] = useState(false);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureStatus, setCaptureStatus] = useState<'idle' | 'listening' | 'processing'>('idle');
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingCommit, setPendingCommit] = useState<PendingCommit | null>(null);
  const activeCapture = useRef<{ captureId: string; provider: 'browser' | 'server'; language: VoiceLanguage } | null>(null);
  const handledCommitDraft = useRef<string | null>(null);
  const [adapter] = useState<GuideVoiceRuntimeAdapter>(() => createGuideVoiceRuntimeAdapter(dispatchCaseGuideEvent));
  const voiceSnapshot = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot, adapter.getSnapshot);
  const acceptedCommit = Boolean(pendingCommit);
  const committed = acceptedCommit;
  const working = requestWorking;
  const expectedResponseId = acceptedCommit && caseData ? `case-${caseData.id}-${revision}` : null;
  const runtimeResponse = guideRuntimeSnapshot.response;
  const guideResponse = expectedResponseId && runtimeResponse?.id === expectedResponseId
    ? { id: runtimeResponse.id, text: runtimeResponse.text, language: 'english' as const }
    : null;
  const guideSnapshot = guideResponse
    ? {
        visualState: guidePresenceStateFromSnapshot(guideRuntimeSnapshot),
        detail: 'Guide response ready. Choose Play to hear it.',
        speechState: guideRuntimeSnapshot.speechState,
      }
    : voiceSnapshot;
  const safetyContext = caseData?.analysis?.safetyContext;
  const callPresenceState = safetyContext?.context === 'urgent_safety_context'
    ? 'IMMEDIATE_DANGER'
    : safetyContext && safetyContext.context !== 'none'
      ? 'SAFETY'
      : captureStatus === 'listening'
        ? 'LISTENING'
        : captureStatus === 'processing' || requestWorking
          ? 'THINKING'
          : confirmationOpen
            ? 'CLARIFYING'
            : guideSnapshot.visualState;
  const callDetail = callPresenceState === 'IMMEDIATE_DANGER' || callPresenceState === 'SAFETY'
    ? 'Safety context is present. You choose whether to continue.'
    : callPresenceState === 'LISTENING'
      ? 'Microphone is active. Stop when you are ready.'
      : callPresenceState === 'THINKING'
        ? 'Review is running. Nothing is added until you confirm.'
        : callPresenceState === 'CLARIFYING'
          ? 'Review the transcript and extracted details.'
          : guideSnapshot.detail;
  const visibleError = error;

  const emitVoiceEvent = useCallback((event: GuideVoiceEvent) => {
    return adapter.emit(event);
  }, [adapter]);

  const previewIsCurrent = preview?.transcript === transcript;
  const extractedFacts = useMemo(
    () => (previewIsCurrent ? preview?.caseState?.facts ?? [] : []),
    [preview, previewIsCurrent],
  );
  const questions = previewIsCurrent ? preview?.caseState?.unknowns ?? [] : [];

  useEffect(() => {
    if (!pendingCommit || !caseData || caseData.id !== id || handledCommitDraft.current === pendingCommit.draftId) return;
    if (JSON.stringify(caseData) === JSON.stringify(pendingCommit.caseState)) {
      handledCommitDraft.current = pendingCommit.draftId;
      emitVoiceEvent({
        type: 'case_state_updated',
        draftId: pendingCommit.draftId,
        caseId: caseData.id,
        revision,
        caseState: caseData,
        inputMethod: pendingCommit.inputMethod,
      });
    }
  }, [caseData, emitVoiceEvent, id, pendingCommit, revision]);

  const updateTranscript = (value: string) => {
    if (value === transcript) return;
    setTranscript(value);
    setInputMethod('text');
    setPreview(null);
    setConfirmationOpen(false);
    setError(null);
    emitVoiceEvent({ type: 'transcript_edited', draftId, transcript: value, inputMethod: 'text' });
  };

  const receiveCaptureEvent = (event: VoiceCaptureEvent) => {
    if (event.type === 'capture_started') {
      activeCapture.current = { captureId: event.captureId, provider: event.provider, language: asVoiceLanguage(event.language) };
      setPreview(null);
      setConfirmationOpen(false);
      setError(null);
      emitVoiceEvent({
        type: 'capture_started',
        draftId,
        captureId: event.captureId,
        provider: event.provider,
        language: asVoiceLanguage(event.language),
      });
    } else if (event.type === 'capture_cancelled') {
      emitVoiceEvent({
        type: 'capture_cancelled',
        draftId,
        captureId: event.captureId,
        transcriptRetained: Boolean(transcript.trim()),
      });
      activeCapture.current = null;
    } else {
      emitVoiceEvent({ type: 'capture_failed', draftId, captureId: event.captureId, detail: event.detail });
      activeCapture.current = null;
    }
  };

  const receiveTranscript = (spoken: string) => {
    const capture = activeCapture.current;
    if (!capture || !spoken.trim()) return;
    const nextTranscript = [transcript.trim(), spoken.trim()].filter(Boolean).join(' ');
    setTranscript(nextTranscript);
    setInputMethod('voice');
    setPreview(null);
    setConfirmationOpen(false);
    setError(null);
    emitVoiceEvent({
      type: 'transcript_received',
      draftId,
      captureId: capture.captureId,
      transcript: nextTranscript,
      provider: capture.provider,
      language: capture.language,
    });
    activeCapture.current = null;
  };

  const reviewTranscript = async () => {
    if (!transcript.trim()) {
      setError('Add or record a statement before reviewing it.');
      return;
    }
    setRequestWorking(true);
    setConfirmationOpen(false);
    setError(null);
    emitVoiceEvent({ type: 'review_started', draftId, transcript });
    try {
      const result = await previewVoiceTranscript(transcript);
      setPreview(result);
      if (result.status !== 'success' || !result.caseState) {
        const detail = result.detail || 'The transcript could not be processed. You can edit it and try again.';
        setError(detail);
        emitVoiceEvent({ type: 'review_failed', draftId, transcript, detail });
      } else {
        emitVoiceEvent({
          type: 'review_ready',
          draftId,
          transcript,
          language: result.language === 'english' || result.language === 'hindi' || result.language === 'hinglish'
            ? result.language
            : asVoiceLanguage(language),
          extractedFactCount: result.caseState.facts.length,
          unknownCount: result.caseState.unknowns.length,
        });
      }
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'Transcript review failed.';
      setPreview(null);
      setError(detail);
      emitVoiceEvent({ type: 'review_failed', draftId, transcript, detail });
    } finally {
      setRequestWorking(false);
    }
  };

  const requestConfirmation = () => {
    if (!transcript.trim() || !previewIsCurrent || preview?.status !== 'success' || !preview.caseState || working) return;
    setConfirmationOpen(true);
    emitVoiceEvent({
      type: 'confirmation_requested',
      draftId,
      transcript,
      inputMethod,
      initiatedBy: 'user',
    });
  };

  const commitTranscript = async () => {
    if (!confirmationOpen || !transcript.trim() || !previewIsCurrent || preview?.status !== 'success' || !preview.caseState || working) return;
    const committedTranscript = transcript;
    setRequestWorking(true);
    setError(null);
    emitVoiceEvent({
      type: 'confirmation_accepted',
      draftId,
      transcript: committedTranscript,
      inputMethod,
      initiatedBy: 'user',
    });
    try {
      const response = await addVoiceStatement(id, committedTranscript, inputMethod);
      const accepted = replaceCaseState(response.caseState);
      if (!accepted) {
        const detail = 'The case changed before the confirmed statement could be applied. Refresh the case and try again.';
        emitVoiceEvent({ type: 'commit_failed', draftId, detail });
        setError(detail);
        setRequestWorking(false);
        return;
      }
      setPendingCommit({
        draftId,
        caseState: response.caseState,
        inputMethod,
      });
      setRequestWorking(false);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'The statement could not be added to this case.';
      emitVoiceEvent({ type: 'commit_failed', draftId, detail });
      setError(detail);
      setRequestWorking(false);
    }
  };

  const startAnotherStatement = () => {
    setDraftId(createId('draft'));
    setTranscript('');
    setInputMethod('text');
    setPreview(null);
    setConfirmationOpen(false);
    setPendingCommit(null);
    handledCommitDraft.current = null;
    setError(null);
    adapter.startNewInteraction();
  };

  const returnToReview = () => setConfirmationOpen(false);

  if (loading) {
    return (
      <main className="flex min-h-[50vh] items-center justify-center bg-[#0c1118] text-slate-400">
        <Loader2 className="mr-3 h-5 w-5 animate-spin" /> Loading case…
      </main>
    );
  }

  if (!caseData) {
    return (
      <main className="flex min-h-[50vh] items-center justify-center bg-[#0c1118] p-6">
        <div className="max-w-md rounded-3xl border border-rose-200/15 bg-[#171519] p-8 text-center">
          <ShieldAlert className="mx-auto h-8 w-8 text-red-500" />
          <h1 className="mt-4 text-xl font-semibold">Case unavailable</h1>
          <p className="mt-2 text-sm text-slate-400">{error || caseError || 'This case could not be loaded.'}</p>
          <button type="button" onClick={() => void refreshCaseState().catch(() => undefined)} className="mt-5 inline-flex min-h-10 items-center rounded-full border border-white/10 px-4 text-sm font-medium text-slate-200">
            Try again
          </button>
          <Link href="/" className="mt-5 inline-flex rounded-full bg-rose-100 px-5 py-2.5 text-sm font-medium text-[#25161b]">
            Go home
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100dvh-4rem)] bg-[#0c1118] px-4 py-5 text-slate-100 sm:px-6 sm:py-7">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={`/case/${encodeURIComponent(id)}`} className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-slate-400 hover:text-slate-100">
            <ArrowLeft className="h-4 w-4" /> Back to case journey
          </Link>
          <Link href={`/case/${encodeURIComponent(id)}`} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 text-xs font-semibold text-slate-300 hover:bg-white/[0.07]">
            <PhoneOff aria-hidden="true" className="h-3.5 w-3.5" /> End call
          </Link>
        </div>

        <section className="mt-4 overflow-hidden rounded-3xl border border-rose-100/[0.12] bg-[#12151c] shadow-[0_24px_75px_rgba(0,0,0,0.24)]">
          <header className="border-b border-white/[0.07] bg-[linear-gradient(120deg,rgba(50,30,39,0.68),rgba(18,21,28,0.98)_68%)] p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.17em] text-rose-100/70"><Mic aria-hidden="true" className="h-3.5 w-3.5" />Clarify · Guide Call · Case {id}</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Guide Call</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">A call-style case session. Speak or type in your own words; recognition stays editable, and the case changes only after your review and confirmation.</p>
              </div>
              <Link href={`/case/${encodeURIComponent(id)}/guide`} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/[0.11] px-3 text-xs font-semibold text-slate-200 hover:bg-white/[0.05]"><BookOpen aria-hidden="true" className="h-3.5 w-3.5" />Open legal guide</Link>
            </div>
          </header>

          <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[0.8fr_1.2fr]">
            <section aria-label="Guide call status" className="rounded-2xl border border-white/[0.08] bg-[#0e1219] p-4 sm:p-5">
              <div className="flex justify-center rounded-xl border border-rose-100/[0.08] bg-[radial-gradient(circle_at_50%_40%,rgba(154,83,101,0.14),transparent_56%)] py-4">
                <GuidePresence state={callPresenceState} speechState={guideSnapshot.speechState} detail={callDetail} size="regular" visual={<div className="flex h-24 w-24 items-center justify-center rounded-full border border-rose-100/20 bg-[linear-gradient(145deg,#2d2027,#171923)] shadow-[0_0_40px_rgba(142,80,99,0.16)]"><span className="text-sm font-semibold tracking-[0.18em] text-rose-100/90">GUIDE</span></div>} />
              </div>
              <div role="status" aria-live="polite" className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(['LISTENING', 'THINKING', 'SPEAKING', 'CLARIFYING', 'SAFETY'] as const).map((state) => {
                  const active = callPresenceState === state || (state === 'SAFETY' && callPresenceState === 'IMMEDIATE_DANGER');
                  return <span key={state} data-active={active || undefined} className={`rounded-lg border px-2 py-2 text-center text-[9px] font-semibold tracking-[0.1em] ${active ? 'border-rose-100/25 bg-rose-100/[0.07] text-rose-50' : 'border-white/[0.06] bg-white/[0.015] text-slate-600'}`}>{state}</span>;
                })}
              </div>
              <p className="mt-3 text-center text-[10px] leading-4 text-slate-500">Your microphone activates only after you press the voice control. End Call exits this screen; cancel or stop to end capture.</p>
              <p className="mt-3 rounded-lg border border-amber-100/10 bg-amber-100/[0.025] px-3 py-2.5 text-[10px] leading-4 text-amber-50/70">This local synthetic prototype does not promise confidentiality. Check the speech-provider notice before recording; it may use browser speech or a configured service.</p>
            </section>

            <section aria-labelledby="transcript-heading" className="min-w-0 rounded-2xl border border-white/[0.08] bg-[#171a21] p-4 sm:p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Audio capture → live transcript → your confirmation → case update → Guide response</p>
                  <h2 id="transcript-heading" className="mt-2 text-lg font-semibold">Transcript &amp; review</h2>
                </div>
                <button type="button" onClick={() => document.getElementById('voice-transcript')?.focus()} className="inline-flex min-h-9 items-center rounded-lg border border-white/[0.1] px-3 text-xs font-semibold text-slate-300 hover:bg-white/[0.04]">Type instead</button>
              </div>

          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
              Speech language
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value as RecognitionLanguage)}
                disabled={working || captureBusy || committed}
                className="h-10 rounded-xl border border-white/[0.1] bg-[#10151c] px-3 text-slate-100"
              >
                {LANGUAGES.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <VoiceCapture
              language={language}
              disabled={working || committed}
              onCaptureStateChange={setCaptureBusy}
              onCaptureStatusChange={setCaptureStatus}
              onCaptureEvent={receiveCaptureEvent}
              onTranscript={receiveTranscript}
            />
          </div>

          <label className="mt-5 block text-sm font-medium text-slate-200" htmlFor="voice-transcript">
            {committed ? 'Confirmed transcript · saved to this case' : 'Live transcript · edit anything that was misheard'}
          </label>
          <textarea
            id="voice-transcript"
            value={transcript}
            onChange={(event) => updateTranscript(event.target.value)}
            placeholder="Your recognized words will appear here. You can also type your statement."
            rows={7}
            disabled={working || captureBusy || committed}
            className="mt-2 w-full resize-y rounded-2xl border border-white/[0.12] bg-[#f5f2ed] p-4 text-base leading-relaxed text-[#242126] outline-none focus:border-rose-400 disabled:bg-[#e9e4dd]"
          />

          <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            Speech recognition is never treated as a confirmed case fact. The transcript and any extracted details stay in review until you confirm the final step.
          </p>

          {visibleError && (
            <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
              {visibleError}
            </p>
          )}

          {committed ? (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <p role="status" className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Confirmed and added to the case.
              </p>
              <button type="button" onClick={startAnotherStatement} className="inline-flex h-10 items-center justify-center rounded-full border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">
                Add another statement
              </button>
            </div>
          ) : (
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              {!confirmationOpen ? (
                <button
                  type="button"
                  onClick={reviewTranscript}
                  disabled={working || captureBusy || !transcript.trim()}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-zinc-300 px-5 text-sm font-medium hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  {working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  Review transcript
                </button>
              ) : (
                <button
                  type="button"
                  onClick={returnToReview}
                  disabled={working || !previewIsCurrent || preview?.status !== 'success' || !preview.caseState}
                  className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-5 text-sm font-medium hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  Back to review
                </button>
              )}
              {previewIsCurrent && preview?.status === 'success' && preview.caseState && !confirmationOpen && (
                <button
                  type="button"
                  onClick={requestConfirmation}
                disabled={working}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-zinc-900 px-5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  Continue to confirmation
                </button>
              )}
              {confirmationOpen && (
                <button
                  type="button"
                  onClick={commitTranscript}
                  disabled={working || !previewIsCurrent || preview?.status !== 'success' || !preview.caseState}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-emerald-700 px-5 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                >
                  {working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                  Confirm and add statement
                </button>
              )}
            </div>
          )}

          {!committed && previewIsCurrent && preview?.status === 'success' && preview.caseState && (
            <section aria-live="polite" className="mt-7 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 dark:border-emerald-900/70 dark:bg-emerald-950/20">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">Review the extracted details</h2>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                  Language · {describeLanguage(preview.language)}
                </span>
              </div>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                These are draft details extracted from the transcript. They are not saved facts. Continue to confirmation, then confirm explicitly to add the statement.
              </p>
              {extractedFacts.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Draft extracted details</h3>
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
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Questions in the draft review</h3>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                    {questions.slice(0, 5).map((question) => <li key={question}>{question}</li>)}
                  </ul>
                </div>
              )}
            </section>
          )}

          {!committed && confirmationOpen && previewIsCurrent && preview?.status === 'success' && (
            <section className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-900/70 dark:bg-amber-950/20" aria-labelledby="voice-confirm-heading">
              <h2 id="voice-confirm-heading" className="font-semibold">Confirm this statement</h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                Confirming adds the transcript below as a new sourced statement and updates the case. Read it once more before you continue.
              </p>
              <blockquote className="mt-3 rounded-xl bg-white/80 p-4 text-sm leading-relaxed text-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-100">{transcript}</blockquote>
            </section>
          )}

          {guideResponse && (
            <VoiceOutput
              key={guideResponse.id}
              text={guideResponse.text}
              language={guideResponse.language}
              responseId={guideResponse.id}
              onEvent={emitVoiceEvent}
            />
          )}
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
