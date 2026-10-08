'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowUpRight,
  CircleHelp,
  ClipboardList,
  FilePenLine,
  FileStack,
  MapPin,
  Mic,
  Network,
  Route,
  Scale,
  ShieldAlert,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Suspense } from 'react';
import type { ReactNode } from 'react';
import type { JourneyStageName } from '@/lib/api';
import { rememberSessionCase } from '@/lib/case-continuity';
import { useCaseState } from '../../app/case/[id]/CaseStateProvider';
import { GuideControlSurface } from '@/components/guide-presence';
import { StatusPill, type StatusTone } from '@/components/design-system/StatusPill';
import { CaseContextPanel } from './CaseContextPanel';

type CaseSectionId = 'understand' | 'evidence' | 'grounding' | 'journey' | 'twin' | 'drafting' | 'safety';

type CaseSection = {
  id: CaseSectionId;
  label: string;
  mobileLabel: string;
  href: string;
  icon: LucideIcon;
  safety?: boolean;
};

const COMPLETE_STATUSES = new Set(['complete', 'completed', 'done', 'finished']);
const ACTIVE_STATUSES = new Set(['active', 'current', 'in_progress', 'started']);

const STAGE_LABELS: Record<JourneyStageName, string> = {
  UNDERSTAND: 'Understand the situation',
  FACTS: 'Review what is known',
  EVIDENCE: 'Build the evidence record',
  LAW: 'Ground the legal picture',
  OPTIONS: 'Explore possible paths',
  NEXT_STEP: 'Choose a useful next step',
};

function isComplete(status: string): boolean {
  return COMPLETE_STATUSES.has(status.toLowerCase());
}

function isActive(status: string): boolean {
  return ACTIVE_STATUSES.has(status.toLowerCase());
}

function getActiveSection(pathname: string, hash: string, basePath: string): CaseSectionId | null {
  if (pathname.startsWith(`${basePath}/documents`) || pathname.startsWith(`${basePath}/voice`)) return 'evidence';
  if (pathname.startsWith(`${basePath}/guide`)) return 'grounding';
  if (pathname.startsWith(`${basePath}/twin`)) return 'twin';
  if (pathname.startsWith(`${basePath}/draft`)) return 'drafting';
  if (pathname.startsWith(`${basePath}/safety`)) return 'safety';
  if (pathname === basePath && hash.startsWith('#journey')) return 'journey';
  if (pathname === basePath || pathname === `${basePath}/`) return 'understand';
  return null;
}

function getFallbackStage({
  facts,
  events,
  evidence,
  analysis,
}: NonNullable<ReturnType<typeof useCaseState>['caseState']>): JourneyStageName {
  if (analysis?.legalKnowledge.status === 'records_found') return 'LAW';
  if (evidence.length > 0) return 'EVIDENCE';
  if (facts.length > 0 || events.length > 0) return 'FACTS';
  return 'UNDERSTAND';
}

function getDestinationForStage(stage: JourneyStageName | undefined, basePath: string): string {
  if (stage === 'UNDERSTAND') return basePath;
  if (stage === 'FACTS' || stage === 'EVIDENCE') return `${basePath}/documents`;
  if (stage === 'LAW') return `${basePath}/guide`;
  return `${basePath}#journey`;
}

function getJurisdictionLabel(caseState: NonNullable<ReturnType<typeof useCaseState>['caseState']>): string {
  const location = [
    caseState.jurisdiction.city,
    caseState.jurisdiction.district,
    caseState.jurisdiction.state,
    caseState.jurisdiction.country,
  ].filter((value): value is string => Boolean(value?.trim()));

  if (location.length) return location.join(', ');
  const locationText = caseState.jurisdiction.locationText?.trim();
  return locationText ? `Recorded location: ${locationText}` : 'Jurisdiction not set';
}

function getSafetyTone(context: string | undefined): 'urgent' | 'caution' | 'clear' {
  if (!context || context === 'none') return 'clear';
  if (context === 'urgent_safety_context') return 'urgent';
  return 'caution';
}

function CaseNavigation({
  sections,
  pathname,
  hash,
  safetyTone,
  mobile = false,
}: {
  sections: CaseSection[];
  pathname: string;
  hash: string;
  safetyTone: 'urgent' | 'caution' | 'clear';
  mobile?: boolean;
}) {
  const shouldReduceMotion = useReducedMotion();
  const basePath = sections[0].href;
  const activeSection = getActiveSection(pathname, hash, basePath);
  const safetyMode = activeSection === 'safety';

  const safetySelectedStyle = safetyTone === 'urgent'
    ? 'bg-rose-400/[0.12] text-rose-100 ring-1 ring-inset ring-rose-300/25'
    : safetyTone === 'caution'
      ? 'bg-amber-300/[0.10] text-amber-100 ring-1 ring-inset ring-amber-300/25'
      : 'bg-rose-400/[0.07] text-rose-100 ring-1 ring-inset ring-rose-300/15';
  const safetyIdleStyle = safetyTone === 'urgent'
    ? 'text-rose-200 hover:bg-rose-400/[0.08] hover:text-rose-100'
    : safetyTone === 'caution'
      ? 'text-amber-200 hover:bg-amber-300/[0.07] hover:text-amber-100'
      : 'text-rose-200/80 hover:bg-rose-400/[0.06] hover:text-rose-100';

  return (
    <nav aria-label="Case workspace" className={mobile ? 'ls-case-mobile-nav relative flex h-[4.7rem] w-full min-w-0 gap-1' : 'ls-case-navigation space-y-1'}>
      {mobile && activeSection === 'evidence' && (
        <Link
          href={pathname.startsWith(`${basePath}/voice`) ? `${basePath}/documents` : `${basePath}/voice`}
          className="absolute -top-10 right-2 inline-flex min-h-9 items-center gap-2 rounded-full border border-white/[0.12] bg-[#1b2636] px-3 text-xs font-semibold text-slate-100 shadow-lg"
        >
          <Mic className="h-3 w-3 text-[#f0c987]" aria-hidden="true" />
          {pathname.startsWith(`${basePath}/voice`) ? 'View documents' : 'Add by voice'}
        </Link>
      )}
      {sections.map((section) => {
        const selected = activeSection === section.id;
        const Icon = section.icon;
        const isSafety = section.safety;
        return (
          <div key={section.id} className={`${isSafety && !mobile ? 'mt-3 border-t border-white/[0.08] pt-3' : ''} ${mobile ? 'ls-case-mobile-item' : ''}`}>
            <Link
              href={section.href}
              aria-label={mobile ? section.label : undefined}
              aria-current={selected ? 'page' : undefined}
              className={[
                'group relative flex outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-[#e9bd7b] focus-visible:ring-offset-2 focus-visible:ring-offset-[#111824] motion-reduce:transition-none',
                mobile
                  ? 'relative h-full min-w-[4.75rem] flex-col items-center justify-center gap-1 px-1.5 text-center'
                  : 'min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm',
                selected && !isSafety ? 'text-white' : '',
                selected && isSafety ? safetySelectedStyle : '',
                !selected && !isSafety ? 'text-slate-400 hover:bg-white/[0.045] hover:text-slate-100' : '',
                !selected && isSafety ? safetyIdleStyle : '',
                selected && !isSafety && !mobile ? 'bg-[#263246]' : '',
                selected && mobile && !isSafety ? 'text-[#f2c98f]' : '',
                safetyMode && !isSafety ? 'opacity-40' : '',
              ].join(' ')}
            >
              {selected && !isSafety && !mobile && (
                <motion.span
                  layoutId="case-shell-active-link"
                  transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 440, damping: 36 }}
                  className="absolute inset-0 rounded-xl bg-[#263246]"
                  aria-hidden="true"
                />
              )}
              {selected && mobile && (
                <motion.span
                  layoutId="case-shell-mobile-active-link"
                  transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 440, damping: 36 }}
                  className={`absolute inset-x-1 top-0 h-0.5 rounded-full ${isSafety ? 'bg-rose-300' : 'bg-[#e9bd7b]'}`}
                  aria-hidden="true"
                />
              )}
              <span className={`relative z-[1] flex shrink-0 items-center justify-center ${mobile ? 'h-5 w-5' : 'h-5 w-5'} ${isSafety && safetyTone === 'urgent' ? 'text-rose-300' : isSafety && safetyTone === 'caution' ? 'text-amber-300' : selected ? 'text-[#f2c98f]' : 'text-current'}`}>
                <Icon className={mobile ? 'h-[17px] w-[17px]' : 'h-[17px] w-[17px]'} strokeWidth={selected ? 2 : 1.8} aria-hidden="true" />
              </span>
              <span className={`relative z-[1] min-w-0 truncate ${mobile ? 'max-w-full whitespace-nowrap text-[11px] leading-4' : 'flex-1 font-medium'} ${selected && !isSafety ? 'font-semibold' : ''}`}>
                {mobile ? section.mobileLabel : section.label}
              </span>
              {!mobile && isSafety && safetyTone === 'urgent' && (
                <span className="relative z-[1] ml-auto rounded-full bg-rose-400/15 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-rose-200">
                  Urgent
                </span>
              )}
              {!mobile && isSafety && safetyTone === 'caution' && (
                <span className="relative z-[1] ml-auto h-1.5 w-1.5 rounded-full bg-amber-300" aria-label="Safety context present" />
              )}
            </Link>
            {!mobile && section.id === 'evidence' && (
              <div className={`ml-[2.65rem] mt-0.5 border-l border-white/[0.08] pl-3 ${safetyMode ? 'opacity-40' : ''}`}>
                <Link
                  href={`${basePath}/voice`}
                  aria-current={pathname.startsWith(`${basePath}/voice`) ? 'page' : undefined}
                  className={`block rounded-md px-2 py-1.5 text-xs transition hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e9bd7b] ${pathname.startsWith(`${basePath}/voice`) ? 'font-medium text-[#f2c98f]' : 'text-slate-500'}`}
                >
                  Add by voice
                </Link>
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function CaseShell({ caseId, children }: { caseId: string; children: ReactNode }) {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();
  const { caseState, loading } = useCaseState();
  const [hash, setHash] = useState('');
  const basePath = `/case/${encodeURIComponent(caseId)}`;

  useEffect(() => {
    const syncHash = () => setHash(window.location.hash);
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, [pathname]);

  useEffect(() => {
    rememberSessionCase(caseId);
  }, [caseId]);

  const activeSafetyTone = getSafetyTone(caseState?.analysis?.safetyContext.context);
  const safetyMode = pathname.startsWith(`${basePath}/safety`);
  const sections: CaseSection[] = [
    { id: 'understand', label: 'Understand', mobileLabel: 'Understand', href: basePath, icon: ClipboardList },
    { id: 'evidence', label: 'Evidence', mobileLabel: 'Evidence', href: `${basePath}/documents`, icon: FileStack },
    { id: 'grounding', label: 'Legal Grounding', mobileLabel: 'Grounding', href: `${basePath}/guide`, icon: Scale },
    { id: 'journey', label: 'Journey', mobileLabel: 'Journey', href: `${basePath}#journey`, icon: Route },
    { id: 'twin', label: 'Living Twin', mobileLabel: 'Twin', href: `${basePath}/twin`, icon: Network },
    { id: 'drafting', label: 'Document Drafting', mobileLabel: 'Draft', href: `${basePath}/draft`, icon: FilePenLine },
    { id: 'safety', label: 'Safety', mobileLabel: 'Safety', href: `${basePath}/safety`, icon: ShieldAlert, safety: true },
  ];

  const journey = caseState?.analysis?.journey;
  const journeySteps = journey?.steps ?? [];
  const completedSteps = journeySteps.filter((step) => isComplete(step.status));
  const currentStep = journeySteps.find((step) => isActive(step.status))
    ?? journeySteps.find((step) => !isComplete(step.status));
  const displayedStep = currentStep ?? journeySteps[journeySteps.length - 1];
  const caseStage = displayedStep?.stage ?? (caseState ? getFallbackStage(caseState) : undefined);
  const safetyOverride = activeSafetyTone !== 'clear';
  const stageTitle = safetyOverride
    ? activeSafetyTone === 'urgent' ? 'Review urgent safety support' : 'Review sensitive safety support'
    : displayedStep?.title?.trim()
      || (caseStage ? STAGE_LABELS[caseStage] : loading ? 'Loading case details' : 'Case details unavailable');
  const progressLabel = safetyOverride
    ? activeSafetyTone === 'urgent' ? 'Safety first' : 'Sensitive support'
    : currentStep
    ? isActive(currentStep.status) ? 'In progress' : 'Next up'
    : journeySteps.length > 0 && completedSteps.length === journeySteps.length
      ? 'Complete'
      : caseStage ? 'Building record' : 'Starting';
  const openQuestions = [...new Set([
    ...(journey?.unknowns ?? []).map((item) => item.question.trim()),
    ...(caseState?.unknowns ?? []).map((item) => item.trim()),
  ].filter(Boolean))];
  const factsCount = caseState?.facts.length ?? 0;
  const evidenceCount = caseState?.evidence.length ?? 0;
  const nextJourneyAction = journey?.nextActions.find((action) => action.action.trim());
  const decisionAction = caseState?.analysis?.decisionScenario?.nextAction.trim();
  const recommendedAction = safetyOverride
    ? caseState?.analysis?.safetyContext.recommendedSafetyPrompt?.trim()
      || (activeSafetyTone === 'urgent'
        ? 'Review the urgent safety options before continuing the ordinary journey.'
        : 'Review the sensitive safety support before continuing the ordinary journey.')
    : decisionAction
    || nextJourneyAction?.action.trim()
    || (openQuestions.length > 0
      ? `Review ${openQuestions.length} open question${openQuestions.length === 1 ? '' : 's'} in the journey.`
      : evidenceCount === 0
        ? 'Add a document or voice note to support what happened.'
        : caseState?.analysis?.legalKnowledge.status !== 'records_found'
          ? 'Check the legal grounding and see which sources are available.'
          : 'Review how the known facts connect in the Living Twin.');
  const recommendedHref = safetyOverride
    ? `${basePath}/safety`
    : decisionAction
    ? nextJourneyAction
      ? getDestinationForStage(nextJourneyAction.stage, basePath)
      : `${basePath}#journey`
    : nextJourneyAction
      ? getDestinationForStage(nextJourneyAction.stage, basePath)
    : openQuestions.length > 0
      ? `${basePath}#journey`
      : evidenceCount === 0
        ? `${basePath}/documents`
        : caseState?.analysis?.legalKnowledge.status !== 'records_found'
          ? `${basePath}/guide`
          : `${basePath}/twin`;
  const caseTitle = caseState?.title?.trim() || 'Active case';
  const jurisdictionLabel = caseState ? getJurisdictionLabel(caseState) : 'Case workspace';
  const caseShortId = caseId.length > 13 ? `${caseId.slice(0, 8)}…${caseId.slice(-3)}` : caseId;
  const activeSection = getActiveSection(pathname, hash, basePath);
  const currentArea = sections.find((section) => section.id === activeSection)?.label ?? 'Case workspace';
  const progressTone: StatusTone = safetyOverride
    ? activeSafetyTone === 'urgent' ? 'danger' : 'caution'
    : progressLabel === 'Complete' ? 'success' : currentStep ? 'info' : 'neutral';
  const contextualHref = safetyMode ? `${basePath}#journey` : recommendedHref;
  const contextualAction = safetyMode ? 'Return to case journey' : 'Continue to next step';

  return (
    <div className="ls-case-shell min-h-screen bg-[#090d13] text-slate-100 selection:bg-[#e7c99c]/40">
      <div className="ls-case-grid min-h-screen lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="ls-case-rail sticky top-0 z-40 hidden h-dvh flex-col border-r border-white/[0.06] bg-[#101722] px-4 pb-5 pt-5 text-slate-100 lg:flex">
          <Link href="/" className="group mb-6 flex items-center gap-3 rounded-lg px-1 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e9bd7b]">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e9bd7b]/20 bg-[#e9bd7b]/[0.09] text-[#f1c98e] shadow-[0_0_22px_rgba(233,189,123,0.08)]">
              <Scale className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
            </span>
            <span>
              <span className="block text-[13px] font-semibold tracking-[0.17em] text-white">LAW SENSE</span>
              <span className="mt-0.5 block text-[9px] font-medium uppercase tracking-[0.18em] text-slate-500">Case workspace</span>
            </span>
          </Link>

          <section aria-label="Current case" className={`ls-case-identity rounded-2xl border border-white/[0.075] bg-white/[0.035] p-3.5 shadow-[0_12px_28px_rgba(0,0,0,0.12)] ${safetyMode ? 'opacity-45' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                <span className={`h-1.5 w-1.5 rounded-full ${loading ? 'animate-pulse bg-amber-300' : 'bg-emerald-400'}`} />
                {loading ? 'Reopening case' : caseState ? 'Active case' : 'Case unavailable'}
              </span>
              <span className="font-mono text-[9px] text-slate-500">{caseShortId}</span>
            </div>
            <h1 className="mt-3 line-clamp-2 text-[15px] font-semibold leading-5 tracking-[-0.02em] text-slate-100">{caseTitle}</h1>
            <p className="mt-1.5 flex items-center gap-1.5 truncate text-[10px] text-slate-500" title={jurisdictionLabel}>
              <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{jurisdictionLabel}</span>
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/[0.07] pt-3">
              <div>
                <p className="text-[9px] font-medium uppercase tracking-[0.13em] text-slate-500">Known</p>
                <p className="mt-1 text-xs font-semibold text-slate-200">{factsCount} facts</p>
                <p className="mt-0.5 text-[10px] text-slate-500">{evidenceCount} evidence items</p>
              </div>
              <div className="border-l border-white/[0.07] pl-3">
                <p className="text-[9px] font-medium uppercase tracking-[0.13em] text-slate-500">Still open</p>
                <p className="mt-1 text-xs font-semibold text-[#f0c987]">{openQuestions.length} questions</p>
                <p className="mt-0.5 text-[10px] text-slate-500">Awaiting clarity</p>
              </div>
            </div>
          </section>

          <section aria-label="Case progress" className={`ls-case-focus mt-3 rounded-2xl border border-white/[0.06] bg-[#151e2b] p-3.5 ${safetyMode ? 'opacity-40' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">Current focus</span>
              <StatusPill tone={progressTone} className="min-h-7 px-2.5">{progressLabel}</StatusPill>
            </div>
            <p className="mt-2 line-clamp-2 text-[12px] font-medium leading-[18px] text-slate-200">{stageTitle}</p>
            <Link
              href={`${basePath}#journey`}
              className="mt-1 inline-flex min-h-6 items-center gap-1 rounded-md text-[10px] font-semibold text-[#e8c891] underline decoration-[#e9bd7b]/25 underline-offset-2 transition hover:text-[#ffe0ad] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e9bd7b] motion-reduce:transition-none"
            >
              Open the Journey plan <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </Link>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.07]" aria-hidden="true">
              {journeySteps.length > 0 && (
                <motion.div
                  initial={shouldReduceMotion ? false : { width: 0 }}
                  animate={{ width: `${Math.round((completedSteps.length / journeySteps.length) * 100)}%` }}
                  transition={{ duration: shouldReduceMotion ? 0 : 0.65, ease: 'easeOut' }}
                  className="h-full rounded-full bg-gradient-to-r from-[#e0b66f] to-[#f3d6a4]"
                />
              )}
            </div>
            <p className="mt-2 text-[9px] text-slate-500">
              {journeySteps.length > 0
                ? `${completedSteps.length} of ${journeySteps.length} journey steps complete`
                : 'Journey status will appear as it becomes available'}
            </p>
          </section>

          <div className="ls-case-nav-heading mb-2 mt-6 flex items-center justify-between px-2">
            <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-600">Navigate</span>
            <span className="text-[9px] text-slate-600">{journeySteps.length > 0 ? `${completedSteps.length}/${journeySteps.length}` : 'CASE'}</span>
          </div>
          <CaseNavigation sections={sections} pathname={pathname} hash={hash} safetyTone={activeSafetyTone} />

          <section aria-label="Suggested next step" className={`ls-case-next mt-auto rounded-2xl border p-3.5 ${safetyOverride ? activeSafetyTone === 'urgent' ? 'border-rose-300/30 bg-gradient-to-br from-rose-300/[0.12] to-transparent' : 'border-amber-200/25 bg-gradient-to-br from-amber-200/[0.09] to-transparent' : 'border-[#e9bd7b]/15 bg-gradient-to-br from-[#e9bd7b]/[0.09] to-transparent'}`}>
            <div className={`flex items-center gap-2 ${safetyOverride ? activeSafetyTone === 'urgent' ? 'text-rose-200' : 'text-amber-100' : 'text-[#e8c891]'}`}>
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              <p className="text-[9px] font-semibold uppercase tracking-[0.14em]">A useful next step</p>
            </div>
            <p className="mt-2.5 line-clamp-3 text-[11px] leading-[17px] text-slate-300">{recommendedAction}</p>
            <Link
              href={recommendedHref}
              className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[#e9bd7b]/20 bg-[#e9bd7b]/[0.08] px-2.5 text-[10px] font-semibold text-[#f0d4a8] transition hover:border-[#e9bd7b]/35 hover:bg-[#e9bd7b]/[0.14] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e9bd7b] motion-reduce:transition-none"
            >
              Continue
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </section>

          {activeSafetyTone !== 'clear' && (
            <p className={`mt-3 flex items-center gap-1.5 px-1 text-[9px] ${activeSafetyTone === 'urgent' ? 'text-rose-300' : 'text-amber-300'}`}>
              <ShieldAlert className="h-3 w-3" aria-hidden="true" />
              System-inferred safety context · review carefully
            </p>
          )}

          <Link href="/" aria-label="Choose a case from this session" className="mt-4 flex min-h-9 items-center gap-2 rounded-lg px-2 text-[11px] font-medium text-slate-500 transition hover:bg-white/[0.04] hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e9bd7b] motion-reduce:transition-none">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Cases this session
          </Link>
        </aside>

        <div className="ls-case-main min-w-0">
          <header className="ls-case-topbar flex min-h-[68px] items-center justify-between gap-4 border-b border-white/[0.07] bg-[#0c121a]/95 px-4 py-3 sm:px-6 lg:min-h-[64px] lg:px-8 lg:py-2">
            <div className="min-w-0 lg:hidden">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">LawSense · {loading ? 'Reopening case' : caseState ? 'Active case' : 'Case unavailable'}</p>
              <p className="mt-0.5 truncate text-base font-semibold text-slate-100">{caseTitle}</p>
            </div>
            <div className="hidden min-w-0 items-center gap-2 text-xs uppercase tracking-[0.12em] text-slate-400 lg:flex">
              <span className="font-semibold text-slate-500">Case workspace</span>
              <span className="text-slate-300">/</span>
              <span className="max-w-[28rem] truncate normal-case tracking-normal text-slate-200">{caseTitle}</span>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <span className="hidden items-center gap-1.5 rounded-full border border-white/[0.09] bg-white/[0.035] px-3 py-1.5 text-xs font-medium text-slate-300 sm:inline-flex">
                <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
                {openQuestions.length} open
              </span>
              <Link href="/" aria-label="Choose a case from this session" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/[0.11] bg-white/[0.035] px-3 text-xs font-semibold text-slate-300 transition hover:bg-white/[0.07] hover:text-white motion-reduce:transition-none">
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Cases this session</span>
                <span className="sm:hidden">Cases</span>
              </Link>
            </div>
          </header>

          <section className="ls-case-context" aria-label="Current case area and journey state">
            <div className="ls-case-context-copy">
              <p className="ls-eyebrow">{currentArea} <span aria-hidden="true">·</span> Case journey</p>
              <p className="ls-case-context-stage">{stageTitle}</p>
              <div className="ls-case-context-meta">
                <StatusPill tone={progressTone}>{progressLabel}</StatusPill>
                <span>{journeySteps.length > 0
                  ? `${completedSteps.length} of ${journeySteps.length} steps complete`
                  : 'Journey progress will appear as case details are recorded'}</span>
              </div>
            </div>
            <Link href={contextualHref} className="ls-case-context-action">
              {contextualAction}
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </section>

          <motion.div
            key={pathname}
            initial={shouldReduceMotion ? false : { opacity: 0, y: 7 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.24, ease: 'easeOut' }}
            className="ls-case-content min-w-0 pb-28 lg:pb-12"
          >
            <Suspense fallback={null}>{children}</Suspense>
          </motion.div>
        </div>
      </div>

      <div className="ls-case-mobile-dock fixed inset-x-0 bottom-0 z-[70] border-t border-white/[0.09] bg-[#0c121a]/[0.97] px-1 pb-[env(safe-area-inset-bottom)] pt-0.5 shadow-[0_-10px_35px_rgba(10,16,26,0.18)] backdrop-blur-xl lg:hidden">
        <CaseNavigation sections={sections} pathname={pathname} hash={hash} safetyTone={activeSafetyTone} mobile />
      </div>

      {caseState?.analysis?.legalKnowledge.status === 'empty' && (
        <span className="sr-only" role="status">
          Legal source records have not been returned for this case.
        </span>
      )}
      <GuideControlSurface />
      <Suspense fallback={null}><CaseContextPanel caseId={caseId} /></Suspense>
    </div>
  );
}
