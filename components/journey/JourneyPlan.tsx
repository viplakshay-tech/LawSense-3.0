'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpenCheck,
  Check,
  CheckCircle2,
  CircleHelp,
  ClipboardCheck,
  FileText,
  GitBranch,
  MapPin,
  Network,
  Route,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import type {
  CaseState,
  JourneyActionSummary,
  JourneyStageName,
  JourneyStepSummary,
} from '@/lib/api';

const COMPLETE_STATUSES = new Set(['complete', 'completed', 'done', 'finished']);
const ACTIVE_STATUSES = new Set(['active', 'current', 'in_progress', 'started']);
const BLOCKED_STATUSES = new Set(['blocked', 'unavailable', 'waiting', 'on_hold']);

const STAGE_LABELS: Record<JourneyStageName, string> = {
  UNDERSTAND: 'Understand the situation',
  FACTS: 'Review what is known',
  EVIDENCE: 'Build the evidence record',
  LAW: 'Check the legal grounding',
  OPTIONS: 'Explore possible paths',
  NEXT_STEP: 'Choose a useful next step',
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function humanize(value: string | null | undefined): string {
  if (!value?.trim()) return 'Not reported';
  if (normalize(value) === 'unknown') return 'Unknown';
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isComplete(status: string): boolean {
  return COMPLETE_STATUSES.has(normalize(status));
}

function isBlocked(status: string): boolean {
  return BLOCKED_STATUSES.has(normalize(status));
}

function isActionableFinding(document: CaseState['documents'][number]): boolean {
  return document.reviewStatus === 'awaiting_confirmation';
}

function documentHref(caseState: CaseState, documentId?: string): string {
  const base = `/case/${encodeURIComponent(caseState.id)}/documents`;
  return documentId
    ? `${base}?documentId=${encodeURIComponent(documentId)}#findings-heading`
    : base;
}

function caseHref(caseState: CaseState, hash = ''): string {
  return `/case/${encodeURIComponent(caseState.id)}${hash}`;
}

function officialResourceUrl(caseState: CaseState): { url: string; title: string } | null {
  const records = caseState.analysis?.legalKnowledge.records ?? [];
  for (const record of records) {
    const candidate = record.sourceUrl || record.provenance.find((item) => item.sourceUrl)?.sourceUrl;
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password) continue;
      const host = parsed.hostname.toLocaleLowerCase();
      const officialHost = [
        '.gov', '.gov.in', '.gov.uk', '.gov.au', '.govt.nz', '.gov.sg',
        '.nic.in', '.gouv.fr', '.gc.ca', '.europa.eu',
      ].some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
      if (officialHost) return { url: parsed.toString(), title: record.title };
    } catch {
      // A source URL that cannot be parsed is not offered as an official resource.
    }
  }
  return null;
}

function statusTone(status: string): string {
  const key = normalize(status);
  if (COMPLETE_STATUSES.has(key)) return 'border-emerald-300/25 bg-emerald-300/[0.08] text-emerald-200';
  if (ACTIVE_STATUSES.has(key)) return 'border-blue-300/25 bg-blue-300/[0.08] text-blue-100';
  if (BLOCKED_STATUSES.has(key)) return 'border-amber-300/25 bg-amber-300/[0.08] text-amber-100';
  return 'border-slate-300/15 bg-white/[0.035] text-slate-400';
}

function stepUnknowns(caseState: CaseState, step: JourneyStepSummary) {
  const journey = caseState.analysis?.journey;
  const related = new Set([step.id, step.stage, ...step.relatedIds].map(normalize));
  return (journey?.unknowns ?? []).filter((item) => item.relatedTo && related.has(normalize(item.relatedTo)));
}

function requirementIdsForStep(step: JourneyStepSummary): Set<string> {
  return new Set(step.relatedIds.map(normalize));
}

function missingForStep(caseState: CaseState, step: JourneyStepSummary): string[] {
  const journey = caseState.analysis?.journey;
  const related = requirementIdsForStep(step);
  const missing = [
    ...(journey?.requiredEvidence ?? [])
      .filter((item) => related.has(normalize(item.id)) || step.stage === 'EVIDENCE')
      .map((item) => `${item.item} · ${humanize(item.availability)}`),
    ...(journey?.requiredDocuments ?? [])
      .filter((item) => related.has(normalize(item.id)) || step.stage === 'EVIDENCE' || step.stage === 'NEXT_STEP')
      .map((item) => `${item.document} · ${humanize(item.availability)}`),
  ];
  return [...new Set(missing)];
}

function blockedReasons(caseState: CaseState, step: JourneyStepSummary, actions: JourneyActionSummary[]): string[] {
  const ids = new Set([step.id, ...step.relatedIds].map(normalize));
  const conditions = actions.map((item) => item.condition?.trim()).filter((item): item is string => Boolean(item));
  const scenario = caseState.analysis?.decisionScenario;
  const blockers = (scenario?.blockingConditions ?? [])
    .filter((item) => ids.has(normalize(item.id)) || normalize(item.status).includes('block'))
    .map((item) => item.description.trim())
    .filter(Boolean);
  return [...new Set([...conditions, ...blockers])];
}

function getStepDocuments(caseState: CaseState, step: JourneyStepSummary) {
  const related = new Set(step.relatedIds.map(normalize));
  const exact = caseState.documents.filter((document) => related.has(normalize(document.id)));
  if (exact.length > 0) return exact;
  if (step.stage === 'EVIDENCE') return caseState.documents;
  return caseState.documents.length === 1 ? caseState.documents : [];
}

function ActionLink({
  href,
  label,
  icon: Icon,
  external = false,
}: {
  href: string;
  label: string;
  icon: typeof ArrowRight;
  external?: boolean;
}) {
  const className = 'inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:-translate-y-px hover:border-[#9a7448]/40 hover:text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9a7448] motion-reduce:transform-none motion-reduce:transition-none dark:border-white/[0.1] dark:bg-white/[0.035] dark:text-slate-200 dark:hover:border-[#e9bd7b]/35 dark:hover:bg-white/[0.07] dark:hover:text-white';
  const content = <>{label}<Icon aria-hidden="true" className="h-3.5 w-3.5" /></>;
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={className}>{content}</a>
  ) : (
    <Link href={href} className={className}>{content}</Link>
  );
}

function StepActions({ caseState, step }: { caseState: CaseState; step: JourneyStepSummary }) {
  const stage = step.stage;
  const docs = getStepDocuments(caseState, step);
  const documentToConfirm = docs.find(isActionableFinding) ?? docs[0];
  const evidenceHref = documentHref(caseState, docs[0]?.id);
  const officialResource = officialResourceUrl(caseState);
  const safetyPresent = Boolean(caseState.analysis?.safetyContext && caseState.analysis.safetyContext.context !== 'none');

  return (
    <div className="flex flex-wrap gap-2">
      {stage === 'UNDERSTAND' && (
        <ActionLink href={caseHref(caseState, '#overview')} label="Review case account" icon={FileText} />
      )}
      {(caseState.unknowns.length > 0 || (caseState.analysis?.journey?.unknowns.length ?? 0) > 0) && (
        <ActionLink href={caseHref(caseState, '#clarification')} label="Answer a question" icon={CircleHelp} />
      )}
      {(stage === 'EVIDENCE' || caseState.evidence.length > 0 || caseState.documents.length > 0) && (
        <ActionLink href={evidenceHref} label="Review evidence" icon={BookOpenCheck} />
      )}
      {documentToConfirm && (stage === 'EVIDENCE' || docs.length > 0) && (
        <ActionLink href={documentHref(caseState, documentToConfirm.id)} label="Confirm evidence" icon={ClipboardCheck} />
      )}
      {(stage === 'LAW' || stage === 'OPTIONS') && (
        <ActionLink href={`/case/${encodeURIComponent(caseState.id)}/guide#guide-legal-heading`} label="Check legal grounding" icon={MapPin} />
      )}
      {docs.map((document) => (
        <ActionLink key={document.id} href={documentHref(caseState, document.id)} label="Open document" icon={FileText} />
      ))}
      {(stage === 'OPTIONS' || stage === 'NEXT_STEP' || stage === 'FACTS') && (
        <ActionLink href={`/case/${encodeURIComponent(caseState.id)}/twin`} label="Open Twin" icon={Network} />
      )}
      {officialResource && (stage === 'LAW' || stage === 'OPTIONS' || stage === 'NEXT_STEP') && (
        <ActionLink href={officialResource.url} label="Open official resource" icon={ArrowRight} external />
      )}
      {(stage === 'NEXT_STEP' || (caseState.analysis?.journey.requiredDocuments.length ?? 0) > 0) && (
        <Link href="#journey-draft" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#a57845]/25 bg-[#a57845]/[0.07] px-3 py-2 text-xs font-semibold text-[#76552f] transition hover:bg-[#a57845]/[0.12] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9a7448] motion-reduce:transition-none dark:border-[#e9bd7b]/20 dark:bg-[#e9bd7b]/[0.07] dark:text-[#f0d4a8] dark:hover:bg-[#e9bd7b]/[0.12]">
          Draft document <FileText aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      )}
      {safetyPresent && (
        <ActionLink href={`/case/${encodeURIComponent(caseState.id)}/safety`} label="Enter safety mode" icon={ShieldAlert} />
      )}
    </div>
  );
}

function DraftComposer({ caseState }: { caseState: CaseState }) {
  const [title, setTitle] = useState('My document draft');
  const [body, setBody] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const reducedMotion = useReducedMotion();

  function downloadDraft() {
    if (!body.trim()) return;
    const contents = `${title.trim() || 'My document draft'}\n\n${body.trim()}\n`;
    const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(title.trim() || 'document-draft').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '').toLocaleLowerCase() || 'document-draft'}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  }

  return (
    <section id="journey-draft" aria-labelledby="journey-draft-heading" className="scroll-mt-28 rounded-2xl border border-[#d8c4a6]/55 bg-[#fffdf9] p-5 dark:border-[#e9bd7b]/15 dark:bg-[#151a23]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#96734c] dark:text-[#e9bd7b]">Work you control</p>
          <h3 id="journey-draft-heading" className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">Draft a document</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600 dark:text-slate-400">
            Write and download your own draft. Nothing is sent or saved to the case, and the Journey step stays at its CaseState status.
          </p>
        </div>
        <span className="rounded-full border border-slate-200 px-2.5 py-1 text-[10px] text-slate-500 dark:border-white/[0.08] dark:text-slate-400">Case {caseState.id.slice(0, 8)}</span>
      </div>
      <div className="mt-4 grid gap-3">
        <label className="grid gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
          Draft title
          <input value={title} onChange={(event) => { setTitle(event.target.value); setDownloaded(false); }} maxLength={160} className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#a57845] focus:ring-2 focus:ring-[#a57845]/15 dark:border-white/[0.1] dark:bg-[#0d121a] dark:text-slate-100" />
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
          Your draft text
          <textarea value={body} onChange={(event) => { setBody(event.target.value); setDownloaded(false); }} rows={7} maxLength={50_000} placeholder="Write only the details you want included. Check names, dates, and any legal requirements before using a draft." className="resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#a57845] focus:ring-2 focus:ring-[#a57845]/15 dark:border-white/[0.1] dark:bg-[#0d121a] dark:text-slate-100 dark:placeholder:text-slate-600" />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={downloadDraft} disabled={!body.trim()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#202a38] px-3.5 text-xs font-semibold text-white transition hover:bg-[#2b394c] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9a7448] dark:bg-[#e9bd7b] dark:text-[#251b0f] dark:hover:bg-[#f1cf9b]">
            <ArrowDownToLine aria-hidden="true" className="h-3.5 w-3.5" /> Download draft
          </button>
          <AnimatePresence mode="wait" initial={false}>
            {downloaded && (
              <motion.p key="draft-downloaded" initial={reducedMotion ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                <Check aria-hidden="true" className="h-3.5 w-3.5" /> Draft downloaded · CaseState progress unchanged
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

export function JourneyPlan({ caseState, revision }: { caseState: CaseState; revision: number }) {
  const journey = caseState.analysis?.journey;
  const steps = journey?.steps ?? [];
  const completedCount = steps.filter((step) => isComplete(step.status)).length;
  const progress = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : null;
  const reducedMotion = useReducedMotion();
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const previousRevision = useRef(revision);
  const openUnknowns = [...new Set([
    ...(journey?.unknowns ?? []).map((item) => item.question.trim()),
    ...caseState.unknowns.map((item) => item.trim()),
  ].filter(Boolean))];
  const safety = caseState.analysis?.safetyContext;
  const paths = journey?.possiblePaths ?? [];
  const legalSource = officialResourceUrl(caseState);

  useEffect(() => {
    if (previousRevision.current === revision) return;
    previousRevision.current = revision;
    setAnnouncement(`Saved case state updated. ${completedCount} of ${steps.length} journey steps are complete.`);
  }, [completedCount, revision, steps.length]);

  function selectPath(id: string) {
    setSelectedPathId(id);
  }

  if (safety?.context === 'urgent_safety_context') {
    return (
      <section aria-labelledby="journey-safety-override-heading" className="rounded-3xl border border-rose-300/45 bg-rose-50 p-6 shadow-[0_18px_50px_rgba(18,32,50,0.08)] dark:border-rose-300/20 dark:bg-rose-300/[0.045] sm:p-8">
        <div className="flex items-start gap-3">
          <ShieldAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-rose-700 dark:text-rose-200" />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-rose-800 dark:text-rose-200">Safety first</p>
            <h2 id="journey-safety-override-heading" className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">Review safety support before the ordinary journey</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-300">
              {safety.recommendedSafetyPrompt?.trim() || 'The case analysis returned an urgent safety context. Review the safety options that fit your situation.'}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">This is a prompt based on the information provided, not a finding about what occurred. LawSense will not contact anyone.</p>
            <div className="mt-4">
              <ActionLink href={`/case/${encodeURIComponent(caseState.id)}/safety`} label="Open safety support" icon={ShieldAlert} />
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="journey" aria-labelledby="journey-heading" className="scroll-mt-24 overflow-hidden rounded-3xl border border-[#d6dbe3] bg-white shadow-[0_18px_50px_rgba(18,32,50,0.08)] dark:border-zinc-800/80 dark:bg-[#111]">
      <div className="border-b border-slate-200 bg-[radial-gradient(ellipse_at_top_left,rgba(233,189,123,0.18),transparent_48%),linear-gradient(130deg,#172233,#101723)] px-6 py-7 text-white sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.17em] text-[#eccb98]"><Route aria-hidden="true" className="h-3.5 w-3.5" /> Your case plan</p>
            <h2 id="journey-heading" className="mt-2 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">Legal Journey</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Each step is tied to the latest saved CaseState. Open a step to continue; only returned case updates change its progress.
            </p>
          </div>
          {progress !== null && (
            <div className="min-w-36 rounded-2xl border border-white/[0.1] bg-white/[0.045] px-4 py-3 text-right">
              <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">Case progress</p>
              <motion.p key={completedCount} initial={reducedMotion ? false : { opacity: 0.4, y: 5 }} animate={{ opacity: 1, y: 0 }} className="mt-1 text-2xl font-semibold tabular-nums text-white">
                {completedCount}<span className="text-sm font-medium text-slate-400"> / {steps.length}</span>
              </motion.p>
              <p className="mt-0.5 text-[10px] text-slate-400">steps complete</p>
            </div>
          )}
        </div>
        {progress !== null ? (
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between text-[10px] text-slate-400">
              <span>Recorded progress</span><span>{progress}%</span>
            </div>
            <div role="progressbar" aria-label="Legal Journey progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={completedCount} className="h-2 overflow-hidden rounded-full bg-white/[0.1]">
              <motion.div initial={reducedMotion ? false : { width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: reducedMotion ? 0 : 0.7, ease: 'easeOut' }} className="h-full rounded-full bg-gradient-to-r from-[#d4a76a] via-[#eac58d] to-[#ffe3b3]" />
            </div>
          </div>
        ) : (
          <p className="mt-5 rounded-xl border border-white/[0.09] bg-white/[0.035] px-3 py-2.5 text-xs text-slate-300">
            Progress is unknown because no journey steps were returned for this case.
          </p>
        )}
      </div>

      <div className="space-y-5 p-5 sm:p-7">
        <AnimatePresence mode="wait" initial={false}>
          {announcement && (
            <motion.p key={announcement} initial={reducedMotion ? false : { opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status" aria-live="polite" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-900 dark:border-emerald-300/15 dark:bg-emerald-300/[0.05] dark:text-emerald-100">
              <CheckCircle2 aria-hidden="true" className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" />{announcement}
            </motion.p>
          )}
        </AnimatePresence>

        {journey?.currentSituation.trim() && (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700 dark:border-white/[0.07] dark:bg-white/[0.025] dark:text-slate-300">
            {journey.currentSituation}
          </p>
        )}

        {safety && safety.context !== 'none' && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/50 bg-amber-50 px-4 py-3 dark:border-amber-300/15 dark:bg-amber-300/[0.045]">
            <p className="flex items-start gap-2 text-xs leading-5 text-slate-700 dark:text-slate-300"><ShieldAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-200" />Safety context is present in the case analysis. Ordinary steps remain visible; enter safety mode whenever you prefer.</p>
            <ActionLink href={`/case/${encodeURIComponent(caseState.id)}/safety`} label="Enter safety mode" icon={ArrowRight} />
          </div>
        )}

        {openUnknowns.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-300/10 dark:bg-amber-300/[0.025]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-xs font-semibold text-amber-950 dark:text-amber-100"><CircleHelp aria-hidden="true" className="h-4 w-4" />Still unknown · {openUnknowns.length}</h3>
                <p className="mt-1 text-[11px] leading-5 text-amber-900/75 dark:text-amber-100/65">These questions stay open until an answer is saved. “I don’t know” remains an unknown.</p>
              </div>
              <ActionLink href={caseHref(caseState, '#clarification')} label="Answer question" icon={ArrowRight} />
            </div>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {openUnknowns.map((question) => <li key={question} className="rounded-lg border border-amber-200/70 bg-white/55 px-3 py-2 text-xs leading-5 text-slate-700 dark:border-amber-200/10 dark:bg-black/10 dark:text-slate-300">{question}</li>)}
            </ul>
          </div>
        )}

        {steps.length > 0 ? (
          <ol className="relative space-y-3" aria-label="Legal Journey steps">
            {steps.map((step, index) => {
              const stepActions = journey?.nextActions.filter((action) => action.stage === step.stage) ?? [];
              const reasons = stepActions.map((action) => action.reason.trim()).filter(Boolean);
              const missing = missingForStep(caseState, step);
              const unknowns = stepUnknowns(caseState, step);
              const blockers = blockedReasons(caseState, step, stepActions);
              const blocked = isBlocked(step.status);
              const complete = isComplete(step.status);
              const documents = getStepDocuments(caseState, step);
              const selectedLink = documents[0]
                ? documentHref(caseState, documents[0].id)
                : step.stage === 'LAW'
                  ? `/case/${encodeURIComponent(caseState.id)}/guide#guide-legal-heading`
                  : step.stage === 'EVIDENCE'
                    ? documentHref(caseState)
                    : step.stage === 'OPTIONS' || step.stage === 'NEXT_STEP'
                      ? `/case/${encodeURIComponent(caseState.id)}/twin`
                      : openUnknowns.length > 0
                        ? caseHref(caseState, '#clarification')
                        : caseHref(caseState, '#facts');
              return (
                <motion.li
                  key={step.id}
                  id={`journey-step-${encodeURIComponent(step.id)}`}
                  layout={!reducedMotion}
                  initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reducedMotion ? 0 : 0.25, delay: reducedMotion ? 0 : Math.min(index * 0.035, 0.2) }}
                  className={`scroll-mt-28 rounded-2xl border p-4 sm:p-5 ${complete ? 'border-emerald-200 bg-emerald-50/35 dark:border-emerald-300/10 dark:bg-emerald-300/[0.018]' : blocked ? 'border-amber-200 bg-amber-50/35 dark:border-amber-300/10 dark:bg-amber-300/[0.018]' : 'border-slate-200 bg-white dark:border-white/[0.075] dark:bg-white/[0.018]'}`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums ${complete ? 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-300/20 dark:bg-emerald-300/10 dark:text-emerald-200' : 'border-slate-300 bg-slate-100 text-slate-600 dark:border-white/[0.12] dark:bg-white/[0.045] dark:text-slate-300'}`}>
                      {complete ? <Check aria-hidden="true" className="h-4 w-4" /> : String(index + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-500">What?</span>
                        <Link href={selectedLink} className="text-sm font-semibold text-slate-900 underline decoration-transparent underline-offset-4 hover:decoration-current focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9a7448] dark:text-slate-100">
                          {step.title.trim() || STAGE_LABELS[step.stage]}
                        </Link>
                        <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.09em] ${statusTone(step.status)}`}>
                          {humanize(step.status)}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs leading-5 text-slate-600 dark:text-slate-400">{step.description.trim() || 'The case analysis did not return a description for this step.'}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 border-t border-slate-200/80 pt-4 dark:border-white/[0.06] sm:grid-cols-3">
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-500">Why?</p>
                      <p className="mt-1 text-xs leading-5 text-slate-700 dark:text-slate-300">{reasons.length ? [...new Set(reasons)].join(' ') : 'A reason for this step was not returned by the case analysis.'}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-500">What is missing?</p>
                      {unknowns.length > 0 || missing.length > 0 ? (
                        <ul className="mt-1 space-y-1 text-xs leading-5 text-slate-700 dark:text-slate-300">
                          {unknowns.map((item) => <li key={item.id}>Unknown: {item.question}</li>)}
                          {missing.map((item) => <li key={item}>Requirement: {item}</li>)}
                        </ul>
                      ) : (
                        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">No missing item is linked to this step in the case analysis.</p>
                      )}
                    </div>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-500">What can I do now?</p>
                      <p className="mt-1 text-xs leading-5 text-slate-700 dark:text-slate-300">
                        {stepActions.length > 0 ? stepActions[0].action : `Continue with ${STAGE_LABELS[step.stage].toLocaleLowerCase()}.`}
                      </p>
                    </div>
                  </div>

                  {blocked && (
                    <div className="mt-3 rounded-xl border border-amber-300/35 bg-amber-50/75 px-3.5 py-3 dark:border-amber-200/10 dark:bg-amber-200/[0.035]">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-amber-900 dark:text-amber-200">Blocked · reason from the case record</p>
                      <p className="mt-1 text-xs leading-5 text-amber-950/85 dark:text-amber-100/75">
                        {blockers.length ? blockers.join(' · ') : 'The case analysis marks this step as blocked but did not return a reason.'}
                      </p>
                    </div>
                  )}

                  {stepActions.some((action) => action.condition?.trim()) && (
                    <ul className="mt-3 space-y-1 rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2.5 text-[11px] leading-5 text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400">
                      {stepActions.filter((action) => action.condition?.trim()).map((action) => <li key={action.id}>Condition: {action.condition}</li>)}
                    </ul>
                  )}

                  <div className="mt-4">
                    <StepActions caseState={caseState} step={step} />
                  </div>
                </motion.li>
              );
            })}
          </ol>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 px-5 py-6 dark:border-white/[0.11]">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Journey steps are not available</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">The case service did not return steps, so progress and completion are unknown.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <ActionLink href={caseHref(caseState, '#clarification')} label="Answer a question" icon={CircleHelp} />
              <ActionLink href={documentHref(caseState)} label="Review evidence" icon={BookOpenCheck} />
              <ActionLink href={`/case/${encodeURIComponent(caseState.id)}/guide#guide-legal-heading`} label="Check legal grounding" icon={MapPin} />
              <ActionLink href={`/case/${encodeURIComponent(caseState.id)}/twin`} label="Open Twin" icon={Network} />
              {legalSource && <ActionLink href={legalSource.url} label="Open official resource" icon={ArrowRight} external />}
            </div>
          </div>
        )}

        {journey && paths.length > 0 && (
          <section aria-labelledby="journey-paths-heading" className="rounded-2xl border border-[#9faeec]/35 bg-[#f5f6ff] p-4 dark:border-[#8c9eff]/15 dark:bg-[#8c9eff]/[0.035] sm:p-5">
            <div className="flex items-start gap-3">
              <span className="rounded-xl border border-[#9faeec]/40 bg-white p-2 text-[#4e5e9d] dark:border-[#8c9eff]/15 dark:bg-white/[0.04] dark:text-[#b7c2ff]"><GitBranch aria-hidden="true" className="h-4 w-4" /></span>
              <div>
                <h3 id="journey-paths-heading" className="text-sm font-semibold text-slate-900 dark:text-slate-100">Possible paths</h3>
                <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">No path is selected. Choose one to focus the next actions; this session choice is not saved as a case decision.</p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {paths.map((path) => {
                const selected = path.id === selectedPathId;
                return (
                  <button key={path.id} type="button" aria-pressed={selected} onClick={() => selectPath(path.id)} className={`rounded-xl border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6674b9] ${selected ? 'border-[#6674b9]/50 bg-white shadow-sm dark:border-[#8c9eff]/30 dark:bg-[#111722]' : 'border-slate-200 bg-white/70 hover:border-[#6674b9]/35 hover:bg-white dark:border-white/[0.07] dark:bg-white/[0.02] dark:hover:bg-white/[0.045]'}`}>
                    <span className="flex items-start justify-between gap-3">
                      <span>
                        <span className="block text-xs font-semibold text-slate-900 dark:text-slate-100">{path.label}</span>
                        <span className="mt-1 block text-[10px] text-slate-500 dark:text-slate-400">Path status · {humanize(path.status)} · Jurisdiction {path.jurisdictionRequired ? 'required' : 'not marked as required'}</span>
                      </span>
                      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-[#6674b9] bg-[#6674b9] text-white' : 'border-slate-300 dark:border-white/20'}`}>{selected && <Check aria-hidden="true" className="h-3 w-3" />}</span>
                    </span>
                    <span className="mt-2 block text-xs leading-5 text-slate-600 dark:text-slate-400">{path.description}</span>
                  </button>
                );
              })}
            </div>
            <AnimatePresence mode="wait" initial={false}>
              {selectedPathId && (
                <motion.div key={selectedPathId} initial={reducedMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 rounded-xl border border-[#6674b9]/20 bg-white/75 p-3.5 dark:bg-[#111722]">
                  <p className="text-xs font-medium text-slate-800 dark:text-slate-200">Path selected for exploration</p>
                  <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">The case record still contains multiple possible paths. Continue by reviewing the evidence and legal grounding that apply to your choice.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <ActionLink href={documentHref(caseState)} label="Review evidence" icon={BookOpenCheck} />
                    <ActionLink href={`/case/${encodeURIComponent(caseState.id)}/guide#guide-legal-heading`} label="Check legal grounding" icon={MapPin} />
                    <ActionLink href={`/case/${encodeURIComponent(caseState.id)}/twin`} label="Open Twin" icon={Network} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        )}

        {legalSource && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] leading-5 text-slate-500 dark:text-slate-500">
            <Sparkles aria-hidden="true" className="h-3 w-3" />
            A government-domain source link was returned: {legalSource.title}. Check its current text and applicability before relying on it.
            <a href={legalSource.url} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline underline-offset-2 dark:text-blue-300">Open official resource <ArrowRight aria-hidden="true" className="inline h-3 w-3" /></a>
          </p>
        )}

        {(steps.some((step) => step.stage === 'NEXT_STEP') || (journey?.requiredDocuments.length ?? 0) > 0) && (
          <DraftComposer caseState={caseState} />
        )}
      </div>
    </section>
  );
}
