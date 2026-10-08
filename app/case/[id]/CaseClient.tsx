'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type CaseFact,
  type CaseState,
  type EvidenceItem,
  type InformationStatus,
  type LegalKnowledgeRecordSummary,
} from '@/lib/api';
import { useCaseState } from './CaseStateProvider';
import { EvidenceWorkspace } from '@/components/EvidenceWorkspace';
import { LegalSourceCandidates } from '@/components/LegalSourceCandidates';
import { TrustNotice } from '@/components/TrustNotice';
import { InformationStatusPill } from '@/components/design-system/InformationStatusPill';
import { ClarificationPanel } from '@/components/clarification/ClarificationPanel';
import { JourneyPlan } from '@/components/journey/JourneyPlan';
import { CaseContextLink } from '@/components/case-shell/CaseContextLink';
import { buildCaseSurfaceHref } from '@/lib/case-context';
import {
  CalendarDays,
  CircleHelp,
  FileText,
  MapPin,
  Scale,
  ShieldAlert,
  Loader2,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';

const STATUS_LABELS: Record<InformationStatus, string> = {
  user_reported: 'User-reported',
  evidence_supported: 'Evidence-supported',
  system_inferred: 'Uncertain · inferred',
  assumption: 'Uncertain · assumption',
  conflicting: 'Conflicting',
  unknown: 'Unknown',
};

function evidenceSourceLabel(source: EvidenceItem['source']): string {
  if (source === 'user') return 'User reported';
  if (source === 'document') return 'Uploaded document';
  return 'System';
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value.trim() || 'No value provided.';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return 'No value provided.';

  try {
    return JSON.stringify(value) ?? 'No value provided.';
  } catch {
    return 'Value could not be displayed.';
  }
}

function getRetrievedKnowledge(caseData: CaseState): LegalKnowledgeRecordSummary[] {
  const knowledge = caseData.analysis?.legalKnowledge;
  if (knowledge?.status !== 'records_found') return [];
  return knowledge.records;
}

function SourceReferences({
  ids,
  evidenceById,
}: {
  ids: string[];
  evidenceById: Map<string, EvidenceItem>;
}) {
  if (ids.length === 0) {
    return <span className="text-zinc-500">No source link recorded.</span>;
  }

  return (
    <span className="inline-flex flex-wrap gap-2">
      {[...new Set(ids)].map((id) => {
        const evidence = evidenceById.get(id);
        const label = evidence
          ? `${evidence.title} · ${evidenceSourceLabel(evidence.source)} · ${STATUS_LABELS[evidence.status]}`
          : `Source reference ${id.slice(0, 8)}`;

        return evidence ? (
          <CaseContextLink
            key={id}
            kind="evidence"
            recordId={id}
            className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 transition hover:border-amber-300 hover:bg-amber-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-white/[0.06]"
          >
            {label}
          </CaseContextLink>
        ) : (
          <span
            key={id}
            className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
          >
            {label}
          </span>
        );
      })}
    </span>
  );
}

function FactCard({
  fact,
  evidenceById,
  caseId,
}: {
  fact: CaseFact;
  evidenceById: Map<string, EvidenceItem>;
  caseId: string;
}) {
  return (
    <article className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
      <p className="leading-relaxed text-zinc-800 dark:text-zinc-200">
        {fact.key !== 'statement' && (
          <span className="font-medium text-zinc-500 dark:text-zinc-400">
            {humanize(fact.key)}:{' '}
          </span>
        )}
        {displayValue(fact.value)}
      </p>
      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-300">Status</dt>
          <dd className="mt-1"><InformationStatusPill status={fact.status} /></dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-wide text-zinc-400">Confidence</dt>
          <dd className="mt-1 font-medium text-zinc-700 dark:text-zinc-300">
            {fact.confidence.toUpperCase()}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-semibold uppercase tracking-wide text-zinc-400">Source</dt>
          <dd className="mt-1">
            <SourceReferences ids={fact.sourceIds} evidenceById={evidenceById} />
          </dd>
        </div>
      </dl>
      {fact.notes && (
        <p className="mt-4 border-t border-zinc-100 pt-3 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          {fact.notes}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <CaseContextLink kind="fact" recordId={fact.id} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900">
          Open fact context
        </CaseContextLink>
        <CaseContextLink kind="twin" recordId={`claim:fact:${fact.id}`} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900">
          View connected Twin records
        </CaseContextLink>
        <Link href={buildCaseSurfaceHref(caseId, 'twin', { focus: `claim:fact:${fact.id}` })} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900">
          Open full Living Twin
        </Link>
      </div>
    </article>
  );
}

function EmptyState({ children }: { children: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-zinc-200 px-5 py-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      {children}
    </p>
  );
}

export default function CaseClient({ id }: { id: string }) {
  const router = useRouter();
  const reducedMotion = useReducedMotion() ?? false;
  const {
    caseState: caseData,
    loading: isLoading,
    error,
    revision,
    replaceCaseState,
    refreshCaseState,
  } = useCaseState();

  useEffect(() => {
    if (!caseData) return;
    const focusKey = 'lawsense:focus-clarification-case';
    const focusRequestedByHome = window.sessionStorage.getItem(focusKey) === id;
    if (window.location.hash !== '#clarification' && !focusRequestedByHome) return;
    if (focusRequestedByHome) window.sessionStorage.removeItem(focusKey);
    const frame = window.requestAnimationFrame(() => {
      const section = document.getElementById('clarification');
      const heading = document.getElementById('clarification-heading');
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      section?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
      heading?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [caseData, id]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#fafafa] dark:bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-zinc-500">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p>Retrieving your case...</p>
        </div>
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="min-h-screen bg-[#fafafa] dark:bg-[#0a0a0a] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white dark:bg-[#111] border border-red-200 dark:border-red-900/50 p-8 rounded-3xl text-center space-y-4">
          <div className="w-12 h-12 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-500 rounded-full flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">This case could not be reopened</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{error || 'The case service did not return this case.'}</p>
          <button
            type="button"
            onClick={() => void refreshCaseState().catch(() => undefined)}
            className="mt-3 w-full rounded-full border border-zinc-200 px-6 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            Try again
          </button>
          <button
            onClick={() => router.push('/')}
            className="mt-6 px-6 py-2.5 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded-full font-medium shadow-sm hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors w-full"
          >
            Cases this session
          </button>
        </div>
      </div>
    );
  }

  const evidenceById = new Map(caseData.evidence.map((evidence) => [evidence.id, evidence]));
  const retrievedKnowledge = getRetrievedKnowledge(caseData);
  const hasExtractedUnderstanding =
    caseData.facts.length > 0 || caseData.events.length > 0 || caseData.legalIssues.length > 0;
  const hasJurisdictionValues = Boolean(
    caseData.jurisdiction.city ||
      caseData.jurisdiction.state ||
      caseData.jurisdiction.district ||
      caseData.jurisdiction.country ||
      caseData.jurisdiction.locationText,
  );
  const status = hasExtractedUnderstanding ? 'Understood' : 'Case created';
  const hasInitialNarrativeEvidence = caseData.evidence.some(
    (item) =>
      item.source === 'user' &&
      (item.type === 'narrative' || item.title.toLowerCase().includes('statement')),
  );
  const showInitialStatementSource =
    Boolean(caseData.initialStatement?.trim()) && !hasInitialNarrativeEvidence;
  const safetyContext = caseData.analysis?.safetyContext;
  return (
    <div data-case-id={id} className="min-h-screen bg-[#fafafa] dark:bg-[#0a0a0a] text-zinc-900 dark:text-zinc-50 font-sans">
      <main className="max-w-5xl mx-auto px-6 py-12">
        {error && (
          <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/30 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-100">
            <span>Showing the last saved case state. Refresh failed: {error}</span>
            <button type="button" onClick={() => void refreshCaseState().catch(() => undefined)} className="min-h-9 rounded-lg border border-current/20 px-3 text-xs font-semibold">Retry case refresh</button>
          </div>
        )}
        {revision > 1 && (
          <p className="sr-only" role="status" aria-live="polite">
            Case information updated from the latest saved case state.
          </p>
        )}
        <div className="mb-8">
          <TrustNotice />
        </div>

        <div className="mb-8">
          <JourneyPlan caseState={caseData} revision={revision} />
        </div>

        <div className="mb-8 scroll-mt-24" id="clarification">
          <ClarificationPanel
            caseId={caseData.id}
            updatedAt={caseData.metadata.updatedAt}
            revision={revision}
            skippedClarificationIds={caseData.skippedClarificationIds}
            onCaseUpdate={replaceCaseState}
          />
        </div>

        <div className="mb-10">
          <EvidenceWorkspace caseId={caseData.id} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-12">
          <div className="lg:col-span-2 space-y-8">
            <motion.section
              id="overview"
              initial={reducedMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.24, ease: 'easeOut' }}
              className="scroll-mt-24 bg-white dark:bg-[#111] rounded-3xl border border-zinc-200 dark:border-zinc-800/80 p-8 shadow-sm"
            >
              <h2 className="text-2xl font-semibold mb-6">Situation Overview</h2>
              <div>
                <h3 className="text-xs font-bold tracking-wider text-zinc-400 uppercase mb-2">
                  Initial statement
                </h3>
                <p className="text-lg leading-relaxed text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">
                  {caseData.initialStatement?.trim() || (
                    <span className="text-zinc-400 italic">
                      No initial statement was saved for this case.
                    </span>
                  )}
                </p>
              </div>
            </motion.section>

            {safetyContext && safetyContext.context !== 'none' && (
              <section
                aria-live="polite"
                className={`rounded-3xl border p-6 shadow-sm ${
                  safetyContext.context === 'urgent_safety_context'
                    ? 'border-rose-300/40 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/20'
                    : 'border-amber-300/40 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20'
                }`}
              >
                <div className="flex items-start gap-3">
                  <ShieldAlert className={`mt-0.5 h-5 w-5 shrink-0 ${safetyContext.context === 'urgent_safety_context' ? 'text-rose-600 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300'}`} />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">Safety context</h2>
                      <span className="rounded-full border border-current/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                        System inferred · {humanize(safetyContext.context)}
                      </span>
                    </div>
                    {safetyContext.recommendedSafetyPrompt && (
                      <p className="mt-3 text-sm leading-6 text-zinc-700 dark:text-zinc-200">
                        {safetyContext.recommendedSafetyPrompt}
                      </p>
                    )}
                    {safetyContext.indicators.length > 0 && (
                      <p className="mt-2 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
                        Possible indicators: {safetyContext.indicators.map((item) => humanize(item.category)).join(' · ')}
                      </p>
                    )}
                    <p className="mt-2 text-xs leading-5 text-zinc-500">
                      This is a safety prompt based on the information provided. It does not establish that abuse or an offence occurred, and it does not contact anyone.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <CaseContextLink kind="safety" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-current/20 px-3 text-xs font-semibold text-zinc-700 transition hover:bg-white/50 dark:text-zinc-200 dark:hover:bg-white/[0.05]">
                        Review safety support in context
                      </CaseContextLink>
                      <Link href={buildCaseSurfaceHref(caseData.id, 'safety')} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-current/20 px-3 text-xs font-semibold text-zinc-700 transition hover:bg-white/50 dark:text-zinc-200 dark:hover:bg-white/[0.05]">
                        Open safety options
                      </Link>
                    </div>
                  </div>
                </div>
              </section>
            )}

            <section id="facts" className="scroll-mt-24 bg-white dark:bg-[#111] rounded-3xl border border-zinc-200 dark:border-zinc-800/80 p-8 shadow-sm">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">Facts</h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Extracted statements with their reported status and source.
                  </p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-500">
                    A user-confirmed document extraction records your confirmation of the reading; it does not verify the file&apos;s authenticity or the truth of its contents.
                  </p>
                </div>
              </div>
              {caseData.facts.length > 0 ? (
                <div className="space-y-3">
                  {caseData.facts.map((fact) => (
                    <FactCard key={fact.id} fact={fact} evidenceById={evidenceById} caseId={caseData.id} />
                  ))}
                </div>
              ) : (
                <EmptyState>No facts have been extracted yet.</EmptyState>
              )}
            </section>

            <section className="bg-white dark:bg-[#111] rounded-3xl border border-zinc-200 dark:border-zinc-800/80 p-8 shadow-sm">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-50 text-violet-600 dark:bg-violet-900/20 dark:text-violet-400">
                  <CalendarDays className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">Events</h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Dates and source links recorded in the case.
                  </p>
                </div>
              </div>
              {caseData.events.length > 0 ? (
                <div className="space-y-3">
                  {caseData.events.map((event) => (
                    <article
                      key={event.id}
                      className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="font-semibold">{humanize(event.type)}</h4>
                        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                          {event.date?.trim() || 'Date not stated'} · {humanize(event.datePrecision)} precision
                        </span>
                      </div>
                      <p className="mt-3 leading-relaxed text-zinc-700 dark:text-zinc-300">
                        {event.description}
                      </p>
                      <div className="mt-4 text-xs">
                        <p className="mb-1 font-semibold uppercase tracking-wide text-zinc-400">
                          Related provenance
                        </p>
                        <SourceReferences ids={event.evidenceIds} evidenceById={evidenceById} />
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState>No events have been extracted yet.</EmptyState>
              )}
            </section>

            <section className="bg-white dark:bg-[#111] rounded-3xl border border-zinc-200 dark:border-zinc-800/80 p-8 shadow-sm">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400">
                  <Scale className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">Evidence</h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Sources linked to facts and events.
                  </p>
                </div>
              </div>
              {caseData.evidence.length > 0 || showInitialStatementSource ? (
                <div className="space-y-3">
                  {showInitialStatementSource && (
                    <article className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h4 className="font-semibold">Initial user statement</h4>
                          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                            Source: User reported · Narrative
                          </p>
                        </div>
                        <span className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                          User reported
                        </span>
                      </div>
                    </article>
                  )}
                  {caseData.evidence.map((item) => (
                    <article
                      key={item.id}
                      className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h4 className="font-semibold">{item.title}</h4>
                          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                            {humanize(item.type)} · Source: {evidenceSourceLabel(item.source)}
                          </p>
                        </div>
                        <span className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                          {STATUS_LABELS[item.status]}
                        </span>
                      </div>
                      {item.documentId && (
                        <p className="mt-3 text-xs text-zinc-500">
                          Document reference: {item.documentId}
                        </p>
                      )}
                      {item.processingStatus && (
                        <p className="mt-3 text-xs text-zinc-500">
                          Processing status: {humanize(item.processingStatus)}
                        </p>
                      )}
                      <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                        <CaseContextLink kind="evidence" recordId={item.id} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900">
                          Open evidence context
                        </CaseContextLink>
                        {item.documentId && <Link href={buildCaseSurfaceHref(caseData.id, 'documents', { documentId: item.documentId })} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900">Open source page</Link>}
                        <CaseContextLink kind="twin" recordId={`evidence:${item.id}`} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900">View connected Twin records</CaseContextLink>
                        <Link href={buildCaseSurfaceHref(caseData.id, 'twin', { focus: `evidence:${item.id}` })} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900">Open full Living Twin</Link>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState>No evidence sources have been recorded yet.</EmptyState>
              )}
            </section>

          </div>

          <aside className="space-y-6">
            <section className="bg-white dark:bg-[#111] rounded-3xl border border-zinc-200 dark:border-zinc-800/80 p-6 shadow-sm">
              <h3 className="font-medium mb-4 pb-4 border-b border-zinc-100 dark:border-zinc-800">
                Case Metadata
              </h3>
              <dl className="space-y-4 text-sm">
                <div>
                  <dt className="text-zinc-500">Status</dt>
                  <dd className="font-medium flex items-center gap-2 mt-1">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        hasExtractedUnderstanding ? 'bg-emerald-500' : 'bg-zinc-400'
                      }`}
                    />
                    {status}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Language preference</dt>
                  <dd className="font-medium mt-1">{caseData.metadata.language || 'Unknown'}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Person name</dt>
                  <dd className="font-medium mt-1">{caseData.person.name || 'Not provided'}</dd>
                </div>
                {caseData.intent && (
                  <>
                    <div>
                      <dt className="text-zinc-500">Objective</dt>
                      <dd className="font-medium mt-1">{caseData.intent.objective}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Urgency</dt>
                      <dd className="font-medium mt-1">{humanize(caseData.intent.urgency)}</dd>
                    </div>
                  </>
                )}
              </dl>
            </section>

            <section className="bg-white dark:bg-[#111] rounded-3xl border border-zinc-200 dark:border-zinc-800/80 p-6 shadow-sm">
              <div className="mb-4 flex items-center gap-3">
                <MapPin className="h-5 w-5 text-amber-500" />
                <h3 className="font-medium">Jurisdiction</h3>
              </div>
              {hasJurisdictionValues ? (
                <dl className="space-y-3 text-sm">
                  {!caseData.jurisdiction.city && !caseData.jurisdiction.state && (
                    <p className="text-zinc-500">City and state are not established yet.</p>
                  )}
                  {caseData.jurisdiction.city && (
                    <div>
                      <dt className="text-zinc-500">City</dt>
                      <dd className="mt-1 font-medium">{caseData.jurisdiction.city}</dd>
                    </div>
                  )}
                  {caseData.jurisdiction.state && (
                    <div>
                      <dt className="text-zinc-500">State</dt>
                      <dd className="mt-1 font-medium">{caseData.jurisdiction.state}</dd>
                    </div>
                  )}
                  {caseData.jurisdiction.district && (
                    <div>
                      <dt className="text-zinc-500">District</dt>
                      <dd className="mt-1 font-medium">{caseData.jurisdiction.district}</dd>
                    </div>
                  )}
                  {caseData.jurisdiction.country && (
                    <div>
                      <dt className="text-zinc-500">Country</dt>
                      <dd className="mt-1 font-medium">{caseData.jurisdiction.country}</dd>
                    </div>
                  )}
                  {caseData.jurisdiction.locationText && (
                    <div>
                      <dt className="text-zinc-500">Recorded location text</dt>
                      <dd className="mt-1 font-medium">{caseData.jurisdiction.locationText}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-zinc-500">Basis</dt>
                    <dd className="mt-1 font-medium">{humanize(caseData.jurisdiction.basis)}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Not established yet.</p>
              )}
            </section>

            <section id="analysis" className="scroll-mt-24 bg-white dark:bg-[#111] rounded-3xl border border-zinc-200 dark:border-zinc-800/80 p-6 shadow-sm">
              <div className="mb-4 flex items-center gap-3">
                <Scale className="h-5 w-5 text-blue-500" />
                <h3 className="font-medium">Candidate legal issues</h3>
              </div>
              {caseData.legalIssues.length > 0 ? (
                <div className="space-y-4">
                  {caseData.legalIssues.map((issue) => (
                    <article key={issue.id} className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900/60">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="font-medium">{humanize(issue.category)}</h4>
                        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                          Candidate
                        </span>
                      </div>
                      {issue.subcategory && (
                        <p className="mt-1 text-sm text-zinc-500">{humanize(issue.subcategory)}</p>
                      )}
                      <p className="mt-3 text-xs text-zinc-500">
                        Confidence: {humanize(issue.confidence)}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <CaseContextLink kind="issue" recordId={issue.id} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900">Open issue context</CaseContextLink>
                        <CaseContextLink kind="twin" recordId={`legal_issue:${issue.id}`} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900">View connected Twin records</CaseContextLink>
                        <Link href={buildCaseSurfaceHref(caseData.id, 'twin', { focus: `legal_issue:${issue.id}` })} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900">Open full Living Twin</Link>
                      </div>
                      {issue.rationale.length > 0 && (
                        <div className="mt-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                            Rationale
                          </p>
                          <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-zinc-600 dark:text-zinc-300">
                            {issue.rationale.map((reason, index) => (
                              <li key={`${issue.id}-${index}`}>{reason}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  No candidate issue has been identified from the available information.
                </p>
              )}
              <LegalSourceCandidates caseData={caseData} records={retrievedKnowledge} />
              {retrievedKnowledge.length === 0 && (
                <p className="mt-5 border-t border-zinc-100 pt-4 text-sm leading-6 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  No matching source was returned for this issue. The local source catalog has limited coverage; an empty lookup does not mean that no law applies.
                </p>
              )}
            </section>

            <section className="bg-white dark:bg-[#111] rounded-3xl border border-zinc-200 dark:border-zinc-800/80 p-6 shadow-sm">
              <div className="mb-4 flex items-center gap-3">
                <CircleHelp className="h-5 w-5 text-violet-500" />
                <h3 className="font-medium">Information still needed</h3>
              </div>
              {caseData.unknowns.length > 0 ? (
                <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
                  {caseData.unknowns.map((unknown, index) => (
                    <li key={`${index}-${unknown}`}>{unknown}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  No unknown information has been recorded.
                </p>
              )}
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
