'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, LoaderCircle, Shield, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCaseState } from '@/app/case/[id]/CaseStateProvider';
import { getSafetySupport } from './api';
import { safetyActionCopy, safetyCopy } from './copy';
import { EvidencePreservationPanel } from './EvidencePreservationPanel';
import { ImmediateDangerPrompt } from './ImmediateDangerPrompt';
import { NextSafeAction } from './NextSafeAction';
import { SafetyContextSummary } from './SafetyContextSummary';
import { SafetyPathway } from './SafetyPathway';
import { VerifiedResourceCategories } from './VerifiedResourceCategories';
import { selectRequestedOfficialResourceCategories } from '@/lib/officialResources';
import type {
  ImmediateDangerAnswer,
  SafetyLanguage,
  SafetyLanguagePreference,
  SafetySupportResponse,
} from './types';
import type { WomenSafetyDomain } from '@/lib/api';

const WOMEN_SAFETY_TOPICS: Array<{ id: WomenSafetyDomain; label: string }> = [
  { id: 'workplace_sexual_harassment', label: 'Workplace harassment' },
  { id: 'domestic_abuse', label: 'Domestic abuse' },
  { id: 'stalking', label: 'Stalking' },
  { id: 'threats_coercion', label: 'Threats / coercion' },
  { id: 'cyber_harassment', label: 'Cyber harassment' },
  { id: 'intimate_image_abuse', label: 'Intimate-image abuse' },
  { id: 'sexual_violence', label: 'Sexual violence' },
  { id: 'dowry_related_abuse', label: 'Dowry-related abuse' },
  { id: 'financial_control_abuse', label: 'Financial / control abuse' },
  { id: 'trafficking_exploitation', label: 'Trafficking / exploitation' },
];

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
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);
  const [paused, setPaused] = useState(false);
  const [selectedTopics, setSelectedTopics] = useState<WomenSafetyDomain[]>([]);
  const requestedCategories = useMemo(
    () => selectRequestedOfficialResourceCategories(caseData),
    [caseData],
  );

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
        requested_resource_categories: requestedCategories,
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
  }, [caseId, requestedCategories]);

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
  const actionCopy = safetyActionCopy[displayLanguage];
  const fallbackTopics = caseData?.analysis?.safetyContext?.indicators.map((item) => item.category) ?? [];

  function handleDangerChoice(nextChoice: ImmediateDangerAnswer) {
    choiceRef.current = nextChoice;
    setChoice(nextChoice);
    setPaused(false);
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

  function focusSection(id: string) {
    const section = document.getElementById(id);
    if (!section) return;
    section.focus({ preventScroll: true });
    section.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }

  return (
    <div data-safety-mode="active" className="relative min-h-screen overflow-hidden bg-[#110d12] text-zinc-100">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-56 left-1/2 size-[34rem] -translate-x-1/2 rounded-full bg-rose-100/[0.035] blur-3xl" />
        <div className="absolute right-[-16rem] top-[34rem] size-[28rem] rounded-full bg-[#c8a6a0]/[0.025] blur-3xl" />
      </div>

      <header className="relative z-10 border-b border-white/[0.065] bg-[#110d12]/90 backdrop-blur-xl">
        <div className="mx-auto flex min-h-[4.5rem] max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl border border-rose-200/15 bg-rose-100/[0.045] text-rose-100/80">
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
                className="min-h-10 appearance-none rounded-lg border border-white/[0.085] bg-white/[0.025] py-2 pl-3 pr-8 text-xs text-zinc-300 outline-none transition focus:border-rose-200/30 focus:ring-2 focus:ring-rose-100/10"
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
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/[0.085] bg-white/[0.025] px-3 text-xs font-medium text-zinc-300 transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-100/50"
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
              className="min-h-9 appearance-none rounded-lg border border-white/[0.085] bg-white/[0.025] py-1.5 pl-3 pr-8 text-xs text-zinc-300 outline-none focus:border-rose-200/30"
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
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-100/70">
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

        <div aria-label="Guide state: SAFETY" role="status" className="mb-4 flex items-center gap-3 rounded-xl border border-rose-100/[0.14] bg-rose-100/[0.025] px-4 py-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">{actionCopy.guideStateLabel}</span>
          <span className="rounded-full border border-rose-100/20 bg-rose-100/[0.07] px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] text-rose-50">SAFETY</span>
          <span className="text-xs text-zinc-400">{displayLanguage === 'hi' ? 'सुरक्षा सहायता सक्रिय है' : displayLanguage === 'hinglish' ? 'Safety support active hai' : 'Safety support is active'}</span>
        </div>

        <section aria-labelledby="women-safety-topics-heading" className="mb-4 rounded-2xl border border-rose-100/[0.12] bg-[linear-gradient(135deg,rgba(47,29,37,0.7),rgba(19,20,26,0.96)_70%)] p-5 sm:p-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-100/70">A user-led safety view</p>
          <h2 id="women-safety-topics-heading" className="mt-2 text-lg font-medium text-zinc-100">Which topic would you like to keep in view?</h2>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-zinc-400">Choose any topics that help you navigate this screen. These choices stay in this view, are not saved to the case and do not change the service assessment. LawSense does not infer guilt or diagnose anyone.</p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {WOMEN_SAFETY_TOPICS.map((topic) => {
              const selected = selectedTopics.includes(topic.id);
              return (
                <li key={topic.id}>
                  <button type="button" aria-pressed={selected} onClick={() => setSelectedTopics((current) => selected ? current.filter((item) => item !== topic.id) : [...current, topic.id])} className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-100/60 ${selected ? 'border-rose-200/30 bg-rose-100/[0.08] text-rose-50' : 'border-white/[0.08] bg-white/[0.02] text-zinc-300 hover:bg-white/[0.045]'}`}>
                    <span>{topic.label}</span><span className="text-[9px] font-semibold uppercase tracking-wide text-zinc-500">{selected ? 'Selected' : 'Optional'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 border-t border-white/[0.07] pt-3 text-xs leading-5 text-zinc-400">Use a device and location that feel safe to you. No intimate images are needed or requested. You decide whether to open the case Guide or start a Guide Call; this prototype does not promise confidentiality.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => router.push(`/case/${encodeURIComponent(caseId)}/guide`)} className="inline-flex min-h-10 items-center rounded-lg border border-white/[0.12] px-3 text-xs font-semibold text-zinc-200 hover:bg-white/[0.05]">Open the case Guide</button>
            <button type="button" onClick={() => router.push(`/case/${encodeURIComponent(caseId)}/voice`)} className="inline-flex min-h-10 items-center rounded-lg bg-rose-200 px-3 text-xs font-semibold text-[#25161b] hover:bg-rose-100">Start a Guide Call</button>
          </div>
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
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-rose-100/65" />
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
                className="min-h-10 shrink-0 rounded-lg border border-white/[0.1] bg-white/[0.035] px-3 text-xs font-medium text-zinc-200 transition hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-100/50"
              >
                {copy.retry}
              </button>
            </div>
          )}

          {assessment && (
            <div className="space-y-4 sm:space-y-5">
              {!paused && <SafetyPathway options={assessment.escalation_options} copy={copy} />}
              <NextSafeAction
                assessment={assessment}
                copy={copy}
                actionCopy={actionCopy}
                choice={choice}
                paused={paused}
                onShowResources={() => focusSection('verified-safety-resources')}
                onShowEvidence={() => {
                  setEvidenceExpanded(true);
                  focusSection('evidence-preservation-guidance');
                }}
                onReturnToCase={() => router.push(`/case/${encodeURIComponent(caseId)}`)}
                onPause={() => setPaused(true)}
                onResume={() => setPaused(false)}
              />
              {!paused && (
                <>
                  <EvidencePreservationPanel
                    guidance={assessment.evidence_preservation_guidance}
                    expanded={evidenceExpanded}
                    onToggle={() => setEvidenceExpanded((current) => !current)}
                    copy={{
                      ...copy,
                      evidenceAction: actionCopy.evidenceAction,
                      hideEvidenceAction: displayLanguage === 'hi' ? 'सुझाव छिपाएँ' : displayLanguage === 'hinglish' ? 'Guidance hide karein' : 'Hide guidance',
                    }}
                  />
                  <VerifiedResourceCategories
                    assessment={assessment}
                    language={displayLanguage}
                    copy={copy}
                  />
                </>
              )}
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
