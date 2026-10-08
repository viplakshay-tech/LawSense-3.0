'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BookOpen, Loader2, Scale, ShieldAlert } from 'lucide-react';
import { type CaseState, type JourneySummary } from '@/lib/api';
import { useCaseState } from '../CaseStateProvider';
import { LegalGuide } from '@/components/legal-guide';
import { LEGAL_GUIDE_STATES, type GuideActionEvent, type GuideStateName } from '@/components/legal-guide/types';
import { LegalSourceCandidates } from '@/components/LegalSourceCandidates';
import { TrustNotice } from '@/components/TrustNotice';

function getSafetyState(caseData: CaseState): GuideStateName | undefined {
  const context = caseData.analysis?.safetyContext?.context;
  if (context === 'urgent_safety_context' || context === 'potentially_unsafe' || context === 'sensitive') {
    return 'safety_warning';
  }
  return undefined;
}

const completedStatuses = new Set(['complete', 'completed', 'done']);

function isJourneyComplete(caseData: CaseState): boolean {
  const journey = caseData.analysis?.journey;
  return Boolean(
    journey &&
      journey.steps.length > 0 &&
      journey.steps.every((step) => completedStatuses.has(step.status.toLocaleLowerCase())) &&
      journey.nextActions.length === 0 &&
      journey.unknowns.length === 0 &&
      caseData.unknowns.length === 0 &&
      caseData.conflicts.length === 0,
  );
}

function isExtracting(caseData: CaseState): boolean {
  return caseData.evidence.some((item) => item.processingStatus === 'processing');
}

function needsEvidenceReview(caseData: CaseState): boolean {
  const needsReviewStatuses = new Set(['user_reported', 'system_inferred', 'assumption', 'conflicting', 'unknown']);
  return (
    caseData.documents.length > 0 ||
    caseData.evidence.some(
      (item) =>
        needsReviewStatuses.has(item.status) ||
        item.processingStatus === 'ocr_required' ||
        item.processingStatus === 'failed',
    )
  );
}

function needsLegalVerification(journey?: JourneySummary): boolean {
  if (!journey) return false;
  const legalSteps = journey.steps.filter((step) => step.stage === 'LAW' || step.stage === 'OPTIONS');
  return legalSteps.some((step) => !completedStatuses.has(step.status.toLocaleLowerCase()));
}

/** Selects the first outstanding phase represented in the canonical CaseState. */
function deriveGuideState(caseData: CaseState): GuideStateName {
  if (getSafetyState(caseData)) return 'safety_warning';
  if (isExtracting(caseData)) return 'extracting';
  if (isJourneyComplete(caseData)) return 'completion';

  const journey = caseData.analysis?.journey;
  if (caseData.unknowns.length > 0 || (journey?.unknowns.length ?? 0) > 0) return 'asking';
  if (needsEvidenceReview(caseData)) return 'evidence_review';
  if (needsLegalVerification(journey)) return 'legal_verification';
  if (journey?.nextActions.length) return 'journey_action';

  if (!caseData.initialStatement?.trim() || !caseData.analysis) return 'listening';
  return 'idle';
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function getUnknowns(caseData: CaseState) {
  const journeyUnknowns = caseData.analysis?.journey?.unknowns ?? [];
  const unknowns = journeyUnknowns.map((item) => ({
    id: `journey-${item.id}`,
    question: item.question,
    priority: item.priority,
  }));
  const knownQuestions = new Set(unknowns.map((item) => item.question.trim().toLocaleLowerCase()));

  caseData.unknowns.forEach((question, index) => {
    const key = question.trim().toLocaleLowerCase();
    if (key && !knownQuestions.has(key)) {
      unknowns.push({ id: `case-${index}`, question, priority: '' });
      knownQuestions.add(key);
    }
  });

  return unknowns;
}

function deriveGuideDetail(caseData: CaseState, guideState: GuideStateName): string | undefined {
  const safety = caseData.analysis?.safetyContext;
  if (guideState === 'safety_warning' && safety && safety.context !== 'none') {
    return `${humanize(safety.context)} · ${humanize(safety.urgency)} urgency`;
  }

  const journey = caseData.analysis?.journey;
  switch (guideState) {
    case 'listening':
      return caseData.initialStatement?.trim() ? 'Case analysis is not available yet' : 'Waiting for the initial case account';
    case 'extracting': {
      const count = caseData.evidence.filter((item) => item.processingStatus === 'processing').length;
      return `${count} evidence item${count === 1 ? '' : 's'} processing`;
    }
    case 'asking': {
      const count = getUnknowns(caseData).length;
      return `${count} open question${count === 1 ? '' : 's'} in the case record`;
    }
    case 'evidence_review':
      return `${caseData.documents.length} document${caseData.documents.length === 1 ? '' : 's'} · ${caseData.evidence.length} evidence record${caseData.evidence.length === 1 ? '' : 's'}`;
    case 'legal_verification':
      return journey?.legalKnowledgeStatus || 'The journey marks legal verification as required';
    case 'journey_action':
      return `${journey?.nextActions.length ?? 0} next step${journey?.nextActions.length === 1 ? '' : 's'} recorded`;
    case 'completion':
      return 'All recorded journey steps are complete';
    case 'idle':
      return journey?.currentSituation.trim() || `${caseData.facts.length} facts recorded`;
    default:
      return undefined;
  }
}

function deriveGuideMessage(caseData: CaseState, guideState: GuideStateName): string | undefined {
  const safety = caseData.analysis?.safetyContext;
  const journey = caseData.analysis?.journey;
  switch (guideState) {
    case 'listening':
      return caseData.initialStatement?.trim()
        ? 'This case has no analysis snapshot yet. The guide is waiting for case details to be recorded.'
        : 'No initial account is recorded for this case yet.';
    case 'extracting':
      return 'The case record marks evidence processing as underway. Extracted details will remain tied to their source.';
    case 'asking':
      return getUnknowns(caseData).find((item) => item.question.trim())?.question;
    case 'evidence_review':
      return 'Review the recorded source and status for each item. User-reported, uncertain, and conflicting information remains identified in the case record.';
    case 'safety_warning':
      return safety?.recommendedSafetyPrompt?.trim() || 'The case record contains a safety context that needs attention.';
    case 'legal_verification':
      return caseData.analysis?.legalKnowledge.status === 'empty'
        ? 'No legal knowledge records are attached to this case. The journey keeps legal and procedural steps marked for verification.'
        : 'The journey marks legal verification as pending. Check the recorded sources and jurisdiction before treating a procedural option as established.';
    case 'journey_action':
      return journey?.nextActions[0]?.action || journey?.currentSituation.trim() || undefined;
    case 'completion':
      return 'Every recorded journey step is complete, with no open questions or next actions remaining.';
    case 'idle':
      return journey?.currentSituation.trim() || undefined;
    default:
      return undefined;
  }
}

function GuideHeader({ id, title, onBack }: { id: string; title?: string; onBack: () => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#070A0F]/90 backdrop-blur-xl">
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        <div className="flex min-h-16 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#8C9EFF]/20 bg-[#8C9EFF]/10 text-[#8C9EFF]"
            >
              <BookOpen className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Legal Guide
              </p>
              <p className="truncate text-sm font-medium text-slate-200">
                {title?.trim() || `Case ${id}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 text-xs font-semibold text-slate-300 transition hover:bg-white/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8C9EFF]"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Case
          </button>
        </div>
      </div>
    </header>
  );
}

function SafetySummary({ caseData }: { caseData: CaseState }) {
  const safety = caseData.analysis?.safetyContext;
  const journey = caseData.analysis?.journey;
  if (!safety || safety.context === 'none') return null;

  return (
    <section
      aria-labelledby="guide-safety-heading"
      className="rounded-xl border border-amber-300/20 bg-amber-300/[0.035] p-4"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
        <div className="min-w-0">
          <h2 id="guide-safety-heading" className="text-xs font-semibold text-amber-100">
            Safety context from the case record
          </h2>
          <p className="mt-1 text-xs leading-5 text-slate-300">
            {humanize(safety.context)} · {humanize(safety.urgency)} urgency · assessment marked as{' '}
            {humanize(safety.assessmentStatus)}
          </p>
          {safety.indicators.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {safety.indicators.map((indicator, index) => (
                <li key={`${indicator.category}-${index}`} className="text-xs leading-5 text-slate-300">
                  {humanize(indicator.category)} · {humanize(indicator.confidence)} confidence
                </li>
              ))}
            </ul>
          )}
          {journey?.escalationPoints && journey.escalationPoints.length > 0 && (
            <div className="mt-3 border-t border-amber-100/10 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-100/70">
                Recorded escalation information
              </p>
              <ul className="mt-2 space-y-3">
                {journey.escalationPoints.map((risk) => (
                  <li key={risk.id}>
                    <p className="text-xs leading-5 text-slate-200">{risk.description}</p>
                    {risk.escalationTrigger && (
                      <p className="mt-1 text-xs leading-5 text-slate-400">{risk.escalationTrigger}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function JourneySummary({ journey }: { journey: JourneySummary }) {
  const currentStep = journey.steps.find((step) => step.status === 'current');

  return (
    <section aria-labelledby="guide-journey-heading" className="space-y-3">
      <div className="rounded-xl border border-white/[0.07] bg-[#0c111a] p-4">
        <h2
          id="guide-journey-heading"
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500"
        >
          Case journey
        </h2>
        {currentStep && <p className="mt-2 text-sm font-medium text-slate-200">{currentStep.title}</p>}
        {journey.currentSituation.trim() && (
          <p className="mt-2 text-xs leading-5 text-slate-400">{journey.currentSituation}</p>
        )}
        <p className="mt-3 text-[11px] leading-5 text-slate-500">
          Jurisdiction status · {humanize(journey.jurisdictionStatus)}
        </p>
      </div>

      {journey.possiblePaths.length > 0 && (
        <div className="rounded-xl border border-[#8C9EFF]/15 bg-[#8C9EFF]/[0.025] p-4">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8C9EFF]/80">
            Possible paths recorded
          </h3>
          <ul className="mt-3 space-y-3">
            {journey.possiblePaths.map((path) => (
              <li key={path.id}>
                <p className="text-xs font-medium text-slate-200">{path.label}</p>
                <p className="mt-1 text-[11px] leading-5 text-slate-400">{path.description}</p>
                <p className="mt-1 text-[10px] text-slate-500">Status · {humanize(path.status)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {journey.nextActions.length > 0 && (
        <div className="rounded-xl border border-white/[0.07] bg-[#0c111a] p-4">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Next steps in the case analysis
          </h3>
          <ul className="mt-3 space-y-3">
            {journey.nextActions.map((action) => (
              <li key={action.id} className="border-l border-[#8C9EFF]/30 pl-3">
                <p className="text-xs leading-5 text-slate-200">{action.action}</p>
                <p className="mt-1 text-[11px] leading-5 text-slate-400">{action.reason}</p>
                {action.condition && (
                  <p className="mt-1 text-[11px] leading-5 text-amber-200/80">{action.condition}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function LegalVerificationSummary({ caseData }: { caseData: CaseState }) {
  const knowledge = caseData.analysis?.legalKnowledge;
  const journey = caseData.analysis?.journey;
  if (!knowledge || !journey) return null;

  return (
    <section aria-labelledby="guide-legal-heading" className="rounded-xl border border-violet-300/15 bg-violet-300/[0.025] p-4">
      <h2 id="guide-legal-heading" className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-200/80">
        Legal source check
      </h2>
      <p className="mt-2 text-xs leading-5 text-slate-300">
        {journey.legalKnowledgeStatus} · source records {knowledge.status === 'records_found' ? 'found' : 'not returned'}
      </p>
      {knowledge.records.length > 0 ? (
        <LegalSourceCandidates caseData={caseData} records={knowledge.records} variant="dark" />
      ) : (
        <p className="mt-2 text-xs leading-5 text-slate-400">
          No matching source was returned for this issue. The local source catalog has limited coverage; an empty lookup does not mean that no law applies.
        </p>
      )}
      <p className="mt-3 text-[10px] leading-4 text-slate-500">
        Procedural paths remain candidates until the relevant law and jurisdiction are verified.
      </p>
    </section>
  );
}

function UnknownsSummary({ items }: { items: ReturnType<typeof getUnknowns> }) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="guide-unknowns-heading" className="rounded-xl border border-amber-300/15 bg-amber-300/[0.025] p-4">
      <h2 id="guide-unknowns-heading" className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200/80">
        Information still unknown
      </h2>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item.id} className="flex gap-2 text-xs leading-5 text-slate-300">
            <span aria-hidden="true" className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300/60" />
            <span>
              {item.question}
              {item.priority && <span className="ml-2 text-[10px] text-slate-500">{humanize(item.priority)} priority</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EvidenceSummary({ caseData, journey }: { caseData: CaseState; journey?: JourneySummary }) {
  const attachedEvidence = caseData.evidence;
  const attachedDocuments = caseData.documents;
  const requestedEvidence = journey?.requiredEvidence ?? [];
  const requestedDocuments = journey?.requiredDocuments ?? [];
  if (
    attachedEvidence.length === 0 &&
    attachedDocuments.length === 0 &&
    requestedEvidence.length === 0 &&
    requestedDocuments.length === 0
  ) {
    return null;
  }

  return (
    <section aria-labelledby="guide-evidence-heading" className="rounded-xl border border-white/[0.07] bg-[#0c111a] p-4">
      <h2 id="guide-evidence-heading" className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        Evidence and records
      </h2>

      {attachedEvidence.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-medium text-slate-300">Attached to this case</h3>
          <ul className="mt-2 space-y-2">
            {attachedEvidence.map((item) => (
              <li key={item.id} className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                <p className="text-xs text-slate-200">{item.title}</p>
                <p className="mt-1 text-[10px] leading-4 text-slate-500">
                  {humanize(item.type)} · {humanize(item.source)} source · {humanize(item.status)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {attachedDocuments.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-medium text-slate-300">Documents attached to this case</h3>
          <ul className="mt-2 space-y-2">
            {attachedDocuments.map((document) => (
              <li key={document.id} className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                <p className="text-xs text-slate-200">{document.filename}</p>
                <p className="mt-1 text-[10px] leading-4 text-slate-500">
                  {humanize(document.classification)} · {humanize(document.processingStatus)} · {document.pageCount} page{document.pageCount === 1 ? '' : 's'}
                </p>
                {document.errors.length > 0 && (
                  <p className="mt-1 text-[10px] leading-4 text-amber-200/80">{document.errors.join(' · ')}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {requestedEvidence.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-medium text-slate-300">Evidence listed by the journey analysis</h3>
          <ul className="mt-2 space-y-2">
            {requestedEvidence.map((item) => (
              <li key={item.id} className="text-xs leading-5 text-slate-300">
                <span>{item.item}</span>
                <span className="text-slate-500"> · {humanize(item.availability)} · {item.purpose}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {requestedDocuments.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-medium text-slate-300">Documents listed by the journey analysis</h3>
          <ul className="mt-2 space-y-2">
            {requestedDocuments.map((item) => (
              <li key={item.id} className="text-xs leading-5 text-slate-300">
                <span>{item.document}</span>
                <span className="text-slate-500"> · {humanize(item.availability)} · {item.purpose}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default function GuidePage({ id }: { id: string }) {
  const router = useRouter();
  const { caseState: caseData, loading, error, refreshCaseState } = useCaseState();
  const [previewState, setPreviewState] = useState<GuideStateName | undefined>();

  const isDevelopment = process.env.NODE_ENV === 'development';
  const safetyState = caseData ? getSafetyState(caseData) : undefined;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#070A0F] text-slate-100">
        <GuideHeader id={id} onBack={() => router.push(`/case/${encodeURIComponent(id)}`)} />
        <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
          <TrustNotice variant="dark" />
          <LegalGuide
            state="listening"
            label="Legal guide"
            busy
            detail="Connecting to the case service"
            message="Loading the case record."
            messageKind="notice"
          >
            <div role="status" className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-[#8C9EFF] motion-reduce:animate-none" />
              Retrieving case data
            </div>
          </LegalGuide>
        </main>
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="min-h-screen bg-[#070A0F] text-slate-100">
        <GuideHeader id={id} onBack={() => router.push('/')} />
        <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
          <TrustNotice variant="dark" />
          <div className="rounded-2xl border border-rose-400/20 bg-[#111722] p-5 sm:p-7">
            <div className="mb-4 flex items-center gap-3">
              <ShieldAlert aria-hidden="true" className="h-5 w-5 text-rose-300" />
              <h1 className="text-lg font-semibold text-slate-100">Case unavailable</h1>
            </div>
            <LegalGuide
              state="error"
              label="Legal guide"
              detail="The case record could not be loaded"
              message={error ?? 'The case service did not return a case record.'}
              messageKind="notice"
              actions={[
                { id: 'retry', label: 'Try again', variant: 'primary' },
                { id: 'return', label: 'Return to cases', variant: 'secondary' },
              ]}
              onAction={(event: GuideActionEvent) => {
                if (event.actionId === 'retry') {
                  void refreshCaseState().catch(() => undefined);
                }
                if (event.actionId === 'return') router.push('/');
              }}
            />
          </div>
        </main>
      </div>
    );
  }

  const derivedState = deriveGuideState(caseData);
  // Preview controls are compiled into the development UI only. An API safety state
  // always takes priority over the preview selection.
  const guideState = safetyState ?? (isDevelopment && previewState ? previewState : derivedState);
  const journey = caseData.analysis?.journey;
  const unknowns = getUnknowns(caseData);
  const safetyActive = guideState === 'safety_warning';
  const message = deriveGuideMessage(caseData, guideState);
  const hasGuideDetails =
    safetyActive ||
    Boolean(journey) ||
    unknowns.length > 0 ||
    caseData.evidence.length > 0 ||
    caseData.documents.length > 0 ||
    caseData.facts.length > 0 ||
    caseData.events.length > 0 ||
    isDevelopment;

  return (
    <div className="min-h-screen bg-[#070A0F] text-slate-100">
      <GuideHeader
        id={id}
        title={caseData.title ?? undefined}
        onBack={() => router.push(`/case/${encodeURIComponent(id)}`)}
      />

      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <TrustNotice variant="dark" />
        {error && (
          <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] px-4 py-3 text-xs leading-5 text-amber-100">
            <span>Showing the last saved case state. Refresh failed: {error}</span>
            <button type="button" onClick={() => void refreshCaseState().catch(() => undefined)} className="min-h-9 rounded-lg border border-amber-200/20 px-3 font-semibold hover:bg-amber-200/[0.06]">Retry</button>
          </div>
        )}

        <LegalGuide
          state={guideState}
          label="Legal guide"
          detail={deriveGuideDetail(caseData, guideState)}
          message={message}
          messageKind={safetyActive ? 'notice' : 'guide'}
          messageSpeaker={safetyActive ? 'Safety context' : 'Case record'}
          actions={safetyActive ? [{ id: 'open-safety', label: 'Open safety resources', variant: 'secondary' }] : []}
          onAction={(event: GuideActionEvent) => {
            if (event.actionId === 'open-safety') {
              router.push(`/case/${encodeURIComponent(id)}/safety`);
            }
          }}
        >
          {hasGuideDetails && (
            <div className="space-y-3">
              {safetyActive ? (
                <SafetySummary caseData={caseData} />
              ) : (
                <>
                  {journey && <JourneySummary journey={journey} />}
                  <UnknownsSummary items={unknowns} />
                  <EvidenceSummary caseData={caseData} journey={journey} />
                  {guideState === 'legal_verification' && <LegalVerificationSummary caseData={caseData} />}
                </>
              )}

              {isDevelopment && (
                <fieldset className="mt-4 rounded-xl border border-white/[0.05] bg-black/10 p-3">
                  <legend className="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Guide state preview · development
                  </legend>
                  <div className="flex flex-wrap gap-1.5">
                    {LEGAL_GUIDE_STATES.map((state) => (
                      <button
                        key={state}
                        type="button"
                        aria-pressed={guideState === state && previewState === state}
                        onClick={() => setPreviewState((current) => (current === state ? undefined : state))}
                        className="min-h-9 rounded-md border border-white/[0.08] bg-transparent px-2 text-[10px] font-medium capitalize text-slate-400 transition hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8C9EFF]"
                      >
                        {state}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}
            </div>
          )}
        </LegalGuide>

        {!safetyActive && (
          <section aria-label="Legal Twin navigation" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-[#101722] px-4 py-3">
            <div className="flex items-center gap-2.5 text-sm text-slate-300">
              <Scale aria-hidden="true" className="h-4 w-4 text-[#8C9EFF]" />
              View the full Legal Twin
            </div>
            <button
              type="button"
              onClick={() => router.push(`/case/${encodeURIComponent(id)}/twin`)}
              className="min-h-10 rounded-lg border border-[#8C9EFF]/30 bg-[#8C9EFF]/10 px-3 text-xs font-semibold text-[#b7c2ff] transition hover:bg-[#8C9EFF]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8C9EFF]"
            >
              Open Twin <span aria-hidden="true">→</span>
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
