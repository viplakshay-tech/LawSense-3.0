'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, LoaderCircle, Shield, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCaseState } from '@/app/case/[id]/CaseStateProvider';
import { getSafetySupport } from './api';
import { safetyCopy } from './copy';
import { EvidencePreservationPanel } from './EvidencePreservationPanel';
import { ImmediateDangerPrompt } from './ImmediateDangerPrompt';
import { NextSafeAction } from './NextSafeAction';
import { SafetyContextSummary } from './SafetyContextSummary';
import { SafetyPathway } from './SafetyPathway';
import { VerifiedResourceCategories } from './VerifiedResourceCategories';
import type {
  ImmediateDangerAnswer,
  SafetyLanguage,
  SafetyLanguagePreference,
  SafetySupportResponse,
} from './types';

function isSafetyLanguage(value: string | null | undefined): value is SafetyLanguage {
  return value === 'en' || value === 'hi' || value === 'hinglish';
}

function safetyRequestLanguage(preference: SafetyLanguagePreference): SafetyLanguage | undefined {
  return preference === 'auto' ? undefined : preference;
}

export function SafetyExperience({ caseId }: { caseId: string }) {
  const router = useRouter();
  const { caseState: caseData, loading: caseLoading, error: caseError, refreshCaseState } = useCaseState();
  const requestVersion = useRef(0);
  const choiceRef = useRef<ImmediateDangerAnswer | null>(null);
  const languageRef = useRef<SafetyLanguagePreference>('auto');
  const [assessmentResponse, setAssessmentResponse] = useState<SafetySupportResponse | null>(null);
  const [choice, setChoice] = useState<ImmediateDangerAnswer | null>(null);
  const [languagePreference, setLanguagePreference] = useState<SafetyLanguagePreference>('auto');
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [supportError, setSupportError] = useState(false);

  const refreshSupport = useCallback(async (
    immediateDanger: ImmediateDangerAnswer | null,
    language: SafetyLanguagePreference,
  ) => {
    const version = ++requestVersion.current;
    setAssessmentLoading(true);
    setSupportError(false);
    try {
      const response = await getSafetySupport(caseId, {
        ...(immediateDanger ? { immediate_danger: immediateDanger } : {}),
        ...(safetyRequestLanguage(language) ? { language: safetyRequestLanguage(language) } : {}),
      });
      if (version === requestVersion.current) setAssessmentResponse(response);
    } catch {
      if (version === requestVersion.current) {
        setAssessmentResponse(null);
        setSupportError(true);
      }
    } finally {
      if (version === requestVersion.current) setAssessmentLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    if (!caseData) return;
    void refreshSupport(choiceRef.current, languageRef.current);
    return () => {
      requestVersion.current += 1;
    };
  }, [caseData, refreshSupport]);

  const assessment = assessmentResponse?.assessment ?? null;
  const displayLanguage: SafetyLanguage = languagePreference === 'auto'
    ? assessment?.language ?? (isSafetyLanguage(caseData?.metadata.language) ? caseData.metadata.language : 'en')
    : languagePreference;
  const copy = safetyCopy[displayLanguage];
  const fallbackTopics = caseData?.analysis?.safetyContext?.indicators.map((item) => item.category) ?? [];

  function handleDangerChoice(nextChoice: ImmediateDangerAnswer) {
    choiceRef.current = nextChoice;
    setChoice(nextChoice);
    setAssessmentResponse(null);
    if (caseData) void refreshSupport(nextChoice, languageRef.current);
  }

  function handleLanguageChange(nextLanguage: SafetyLanguagePreference) {
    languageRef.current = nextLanguage;
    setLanguagePreference(nextLanguage);
    setAssessmentResponse(null);
    if (caseData) void refreshSupport(choiceRef.current, nextLanguage);
  }

  function retrySupport() {
    if (caseData) void refreshSupport(choiceRef.current, languageRef.current);
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0b0e13] text-zinc-100">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-56 left-1/2 size-[34rem] -translate-x-1/2 rounded-full bg-teal-100/[0.035] blur-3xl" />
        <div className="absolute right-[-16rem] top-[34rem] size-[28rem] rounded-full bg-slate-300/[0.025] blur-3xl" />
      </div>

      <header className="relative z-10 border-b border-white/[0.065] bg-[#0b0e13]/80 backdrop-blur-xl">
        <div className="mx-auto flex min-h-[4.5rem] max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl border border-teal-100/10 bg-teal-100/[0.045] text-teal-100/75">
              <Shield aria-hidden="true" className="size-4" />
            </span>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-500">LawSense</p>
              <p className="text-xs font-medium text-zinc-300">{copy.pageEyebrow.split('·').at(-1)?.trim() ?? 'Safety support'}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <label className="relative hidden items-center sm:flex">
              <span className="sr-only">{copy.languageLabel}</span>
              <select
                value={languagePreference}
                onChange={(event) => handleLanguageChange(event.target.value as SafetyLanguagePreference)}
                className="min-h-10 appearance-none rounded-lg border border-white/[0.085] bg-white/[0.025] py-2 pl-3 pr-8 text-xs text-zinc-300 outline-none transition focus:border-teal-100/30 focus:ring-2 focus:ring-teal-100/10"
              >
                <option value="auto">{copy.autoLanguage}</option>
                <option value="en">{copy.english}</option>
                <option value="hi">{copy.hindi}</option>
                <option value="hinglish">{copy.hinglish}</option>
              </select>
              <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 size-3.5 text-zinc-500" />
            </label>
            <button
              type="button"
              onClick={() => router.push(`/case/${encodeURIComponent(caseId)}`)}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/[0.085] bg-white/[0.025] px-3 text-xs font-medium text-zinc-300 transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-100/50"
            >
              <ArrowLeft aria-hidden="true" className="size-3.5" />
              <span className="hidden sm:inline">{copy.backToCase}</span>
              <span className="sm:hidden">{displayLanguage === 'hi' ? 'वापस' : displayLanguage === 'hinglish' ? 'Back' : 'Back'}</span>
            </button>
          </div>
        </div>
        <label className="relative flex items-center justify-between gap-3 border-t border-white/[0.04] px-4 py-2 sm:hidden">
          <span className="text-xs text-zinc-500">{copy.languageLabel}</span>
          <span className="relative">
            <select
              value={languagePreference}
              onChange={(event) => handleLanguageChange(event.target.value as SafetyLanguagePreference)}
              className="min-h-9 appearance-none rounded-lg border border-white/[0.085] bg-white/[0.025] py-1.5 pl-3 pr-8 text-xs text-zinc-300 outline-none focus:border-teal-100/30"
            >
              <option value="auto">{copy.autoLanguage}</option>
              <option value="en">{copy.english}</option>
              <option value="hi">{copy.hindi}</option>
              <option value="hinglish">{copy.hinglish}</option>
            </select>
            <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
          </span>
        </label>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        <section className="mb-7 flex flex-col gap-3 sm:mb-9 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-teal-100/65">
              <Sparkles aria-hidden="true" className="size-3.5" />
              {copy.pageEyebrow}
            </p>
            <h1 className="mt-3 text-3xl font-medium tracking-[-0.035em] text-white sm:text-4xl">
              {copy.pageTitle}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{copy.pageDescription}</p>
          </div>
          {caseData?.title?.trim() && (
            <p className="max-w-sm truncate rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-zinc-500">
              {caseData.title}
            </p>
          )}
        </section>

        <div className="space-y-4 sm:space-y-5">
          <SafetyContextSummary
            assessment={assessment}
            fallbackTopics={fallbackTopics}
            language={displayLanguage}
            copy={copy}
          />

          <ImmediateDangerPrompt
            choice={choice}
            busy={assessmentLoading}
            urgent={assessment?.urgency === 'urgent'}
            disabled={!caseData}
            prompt={assessment?.user_facing_safety_prompt}
            copy={copy}
            onChoose={handleDangerChoice}
          />

          {(caseLoading || assessmentLoading) && (
            <div role="status" className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-zinc-500">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-teal-100/65" />
              {displayLanguage === 'hi' ? 'Safety Support से सुझाव लोड हो रहे हैं…' : displayLanguage === 'hinglish' ? 'Safety Support se suggestions load ho rahe hain…' : 'Loading guidance from Safety Support…'}
            </div>
          )}

          {caseError && (
            <div role="alert" className="rounded-xl border border-amber-100/10 bg-amber-100/[0.025] px-4 py-3 text-sm leading-6 text-zinc-300">
              <p>{copy.caseError}</p>
              <button type="button" onClick={() => void refreshCaseState().catch(() => undefined)} className="mt-2 min-h-9 rounded-lg border border-white/[0.1] px-3 text-xs font-semibold text-zinc-200">
                {copy.retry}
              </button>
            </div>
          )}

          {supportError && !assessmentLoading && (
            <div role="alert" className="flex flex-col gap-3 rounded-xl border border-amber-100/10 bg-amber-100/[0.025] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-6 text-zinc-300">{copy.loadError}</p>
              <button
                type="button"
                onClick={retrySupport}
                className="min-h-10 shrink-0 rounded-lg border border-white/[0.1] bg-white/[0.035] px-3 text-xs font-medium text-zinc-200 transition hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-100/50"
              >
                {copy.retry}
              </button>
            </div>
          )}

          {assessment && (
            <div className="space-y-4 sm:space-y-5">
              <SafetyPathway options={assessment.escalation_options} copy={copy} />
              <EvidencePreservationPanel guidance={assessment.evidence_preservation_guidance} copy={copy} />
              <VerifiedResourceCategories
                assessment={assessment}
                language={displayLanguage}
                copy={copy}
              />
              <NextSafeAction assessment={assessment} copy={copy} />
            </div>
          )}

          {!assessment && !assessmentLoading && !supportError && !caseLoading && !caseError && (
            <div role="status" className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-zinc-500">
              {copy.loadError}
            </div>
          )}
        </div>

        <p className="mt-7 text-center text-[11px] leading-5 text-zinc-600">
          {copy.notContacted}
        </p>
      </main>
    </div>
  );
}
