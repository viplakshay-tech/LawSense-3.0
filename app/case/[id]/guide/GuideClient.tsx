'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, BookOpen, Loader2, ShieldAlert } from 'lucide-react';
import { type CaseState, type JourneySummary } from '@/lib/api';
import { useCaseState } from '../CaseStateProvider';
import { useGuideRuntime } from '@/components/guide-runtime';
import type { GuideAction, GuideStateSnapshot } from '@/components/guide-runtime';
import { LegalGuide } from '@/components/legal-guide';
import type { GuideActionEvent, GuideStateName } from '@/components/legal-guide/types';
import { TrustNotice } from '@/components/TrustNotice';

const completedStatuses = new Set(['complete', 'completed', 'done', 'finished']);

function guidePageStateFromRuntime(snapshot: GuideStateSnapshot): GuideStateName {
  switch (snapshot.name) {
    case 'idle':
      return snapshot.reason === 'initial_account_missing' || snapshot.reason === 'analysis_unavailable'
        ? 'listening'
        : 'idle';
    case 'listening': return 'listening';
    case 'processing': return 'extracting';
    case 'asking': return 'asking';
    case 'evidence':
    case 'uncertain':
    case 'conflict': return 'evidence_review';
    case 'grounded': return 'legal_verification';
    case 'action': return 'journey_action';
    case 'safety': return 'safety_warning';
    case 'completion': return 'completion';
    case 'explaining': return 'explaining';
    case 'speaking': return 'speaking';
    case 'error': return 'error';
    default: {
      const exhaustiveState: never = snapshot.name;
      return exhaustiveState;
    }
  }
}

function guideActionLabel(action: GuideAction): string {
  switch (action.type) {
    case 'ASK_CLARIFICATION': return 'Answer an open case question';
    case 'SHOW_EVIDENCE': return 'Open the Evidence Map';
    case 'SHOW_LEGAL_GROUNDING': return 'Review legal grounding';
    case 'OPEN_JOURNEY': return 'Open the Journey plan';
    case 'SHOW_TWIN': return 'Open the Living Twin';
    case 'START_VOICE': return 'Add information by voice';
    case 'SPEAK_RESPONSE': return 'Speak the Guide response';
    case 'OPEN_SAFETY': return 'Open safety resources';
    case 'NAVIGATE': return action.payload.target === 'case'
      ? 'Open the case overview'
      : `Open ${action.payload.target}`;
    default: {
      const exhaustiveAction: never = action;
      return exhaustiveAction;
    }
  }
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
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
            Back to case
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
  const currentStep = journey.steps.find((step) => ['active', 'current', 'in_progress', 'started'].includes(step.status.toLocaleLowerCase()))
    ?? journey.steps.find((step) => !completedStatuses.has(step.status.toLocaleLowerCase()));
  const completedCount = journey.steps.filter((step) => completedStatuses.has(step.status.toLocaleLowerCase())).length;

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
        <p className="mt-2 text-[11px] leading-5 text-slate-500">
          {journey.steps.length > 0
            ? `Live CaseState progress · ${completedCount} of ${journey.steps.length} steps complete`
            : 'Journey progress is unknown because no steps were returned.'}
        </p>
        {journey.nextActions[0] && (
          <p className="mt-2 text-xs leading-5 text-slate-400">
            Next recorded action · {journey.nextActions[0].action}
          </p>
        )}
      </div>
    </section>
  );
}

function LegalVerificationSummary({ caseData }: { caseData: CaseState }) {
  const knowledge = caseData.analysis?.legalKnowledge;
  const journey = caseData.analysis?.journey;
  if (!knowledge && caseData.legalIssues.length === 0) return null;

  return (
    <section aria-labelledby="guide-legal-heading" className="rounded-xl border border-violet-300/15 bg-violet-300/[0.025] p-4">
      <h2 id="guide-legal-heading" className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-200/80">
        Legal grounding
      </h2>
      <p className="mt-2 text-xs leading-5 text-slate-300">
        {journey?.legalKnowledgeStatus || 'Candidate issues and returned source metadata from the case record'}
        {knowledge ? ` · source records ${knowledge.status === 'records_found' ? 'found' : 'not returned'}` : ''}
      </p>
      <p className="mt-2 text-xs leading-5 text-slate-400">
        Issue candidates and source details are kept together in the case overview. Returned records remain subject to jurisdiction and applicability checks.
      </p>
    </section>
  );
}

function UnknownsSummary({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="guide-unknowns-heading" className="rounded-xl border border-amber-300/15 bg-amber-300/[0.025] p-4">
      <h2 id="guide-unknowns-heading" className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200/80">
        Information still unknown
      </h2>
      <ul className="mt-3 space-y-2">
        {items.map((question, index) => (
          <li key={`${question}-${index}`} className="flex gap-2 text-xs leading-5 text-slate-300">
            <span aria-hidden="true" className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300/60" />
            <span>{question}</span>
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
        Evidence and documents
      </h2>
      <p className="mt-2 text-xs leading-5 text-slate-300">
        {attachedEvidence.length} evidence item{attachedEvidence.length === 1 ? '' : 's'} · {attachedDocuments.length} document{attachedDocuments.length === 1 ? '' : 's'} attached to this case.
      </p>
      {(requestedEvidence.length > 0 || requestedDocuments.length > 0) && (
        <p className="mt-2 text-xs leading-5 text-slate-400">
          The journey lists {requestedEvidence.length} evidence item{requestedEvidence.length === 1 ? '' : 's'} and {requestedDocuments.length} document{requestedDocuments.length === 1 ? '' : 's'} to consider.
        </p>
      )}
    </section>
  );
}

export default function GuidePage({ id }: { id: string }) {
  const router = useRouter();
  const { caseState: caseData, loading, error, refreshCaseState } = useCaseState();
  const { snapshot, presentation, runAction } = useGuideRuntime();
  const runtimeReady = Boolean(caseData && snapshot.caseState === caseData);
  const runtimeState = runtimeReady ? snapshot.state : null;

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
        <GuideHeader id={id} onBack={() => router.push(`/case/${encodeURIComponent(id)}`)} />
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

  if (!runtimeReady || !runtimeState) {
    return (
      <div className="min-h-screen bg-[#070A0F] text-slate-100">
        <GuideHeader id={id} title={caseData.title ?? undefined} onBack={() => router.push(`/case/${encodeURIComponent(id)}`)} />
        <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
          <TrustNotice variant="dark" />
          <LegalGuide
            state="listening"
            label="Legal guide"
            busy
            detail="Updating from the current case record"
            message="The Guide is waiting for the shared runtime to receive the latest case state."
            messageKind="notice"
          />
        </main>
      </div>
    );
  }

  const derivedState = guidePageStateFromRuntime(runtimeState);
  const guideState = derivedState;
  const journey = caseData.analysis?.journey;
  const safetyActive = runtimeState.name === 'safety';
  const hasGuideDetails =
    safetyActive ||
    Boolean(journey) ||
    presentation.unknowns.length > 0 ||
    caseData.evidence.length > 0 ||
    caseData.documents.length > 0 ||
    caseData.facts.length > 0 ||
    caseData.events.length > 0 ||
    caseData.legalIssues.length > 0;
  const availableActions = new Map(snapshot.availableActions.map((action) => [JSON.stringify(action), action]));
  const guideActions = snapshot.availableActions.map((action) => ({
    id: JSON.stringify(action),
    label: guideActionLabel(action),
    variant: 'secondary' as const,
  }));

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
          detail={runtimeState.reason.replaceAll('_', ' ')}
          message={presentation.whyItMatters}
          messageKind={safetyActive ? 'notice' : 'guide'}
          messageSpeaker={safetyActive ? 'Safety context' : 'Case record'}
          actions={guideActions}
          onAction={(event: GuideActionEvent) => {
            const action = availableActions.get(event.actionId);
            if (action) void runAction(action);
          }}
        >
          {hasGuideDetails && (
            <div className="space-y-3">
              {safetyActive ? (
                <SafetySummary caseData={caseData} />
              ) : (
                <>
                  {journey && <JourneySummary journey={journey} />}
                  <UnknownsSummary items={presentation.unknowns} />
                  <EvidenceSummary caseData={caseData} journey={journey} />
                  {(guideState === 'legal_verification' || caseData.legalIssues.length > 0) && <LegalVerificationSummary caseData={caseData} />}
                </>
              )}
            </div>
          )}
        </LegalGuide>

      </main>
    </div>
  );
}
