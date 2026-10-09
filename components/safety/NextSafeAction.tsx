import { ArrowLeft, ArrowRight, BadgeHelp, FileCheck2, PauseCircle, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SafetySurface } from './SafetySurface';
import type { ImmediateDangerAnswer } from './types';

export function NextSafeAction({
  assessment,
  copy,
  actionCopy,
  choice,
  paused,
  onShowResources,
  onShowEvidence,
  onReturnToCase,
  onPause,
  onResume,
}: {
  assessment: {
    safe_next_step_sequence: string[];
    urgency: string;
    legal_workflow_allowed: boolean;
  } | null;
  copy: {
    nextEyebrow: string;
    nextTitle: string;
    nextDescription: string;
    noNextStep: string;
    safetyFirst: string;
    legalMayContinue: string;
    notContacted: string;
  };
  actionCopy: {
    whyLabel: string;
    whyYes: string;
    whyNo: string;
    whyNotSure: string;
    whyUnanswered: string;
    professionalHelp: string;
    professionalHelpDetail: string;
    evidenceAction: string;
    legalWorkflowAction: string;
    pauseAction: string;
    resumeAction: string;
    pausedMessage: string;
  };
  choice: ImmediateDangerAnswer | null;
  paused: boolean;
  onShowResources: () => void;
  onShowEvidence: () => void;
  onReturnToCase: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const nextStep = assessment?.safe_next_step_sequence[0];
  const safetyFirst = assessment?.legal_workflow_allowed === false;
  const why = choice === 'yes'
    ? actionCopy.whyYes
    : choice === 'no'
      ? actionCopy.whyNo
      : choice === 'not_sure'
        ? actionCopy.whyNotSure
        : actionCopy.whyUnanswered;

  return (
    <SafetySurface className={cn(
      'border-rose-100/[0.14] bg-[linear-gradient(135deg,rgba(43,28,35,0.55),rgba(17,19,25,0.98)_72%)]',
      assessment?.urgency === 'urgent' && 'border-amber-100/[0.2]',
    )}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-rose-100/10 bg-rose-100/[0.05] text-rose-100/75">
          {nextStep ? <ArrowRight aria-hidden="true" className="size-4" /> : <PauseCircle aria-hidden="true" className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-100/65">{copy.nextEyebrow}</p>
          <h2 className="mt-2 text-lg font-medium tracking-tight text-zinc-100">{copy.nextTitle}</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">{copy.nextDescription}</p>
        </div>
      </div>

      {!paused && <div className="mt-5 rounded-xl border border-white/[0.07] bg-black/10 p-4 sm:p-5">
        {nextStep ? (
          <p className="text-base leading-7 text-zinc-100">{nextStep}</p>
        ) : (
          <p className="text-sm leading-6 text-zinc-400">{copy.noNextStep}</p>
        )}
      </div>}

      <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-rose-100/70">{actionCopy.whyLabel}</h3>
        <p className="mt-2 text-xs leading-5 text-zinc-400">{why}</p>
      </div>

      {paused ? (
        <div role="status" aria-live="polite" className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
          <p className="text-sm leading-6 text-zinc-300">{actionCopy.pausedMessage}</p>
          <button
            type="button"
            onClick={onResume}
            className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/[0.11] bg-white/[0.04] px-3 text-xs font-semibold text-zinc-200 transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-100/50"
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            {actionCopy.resumeAction}
          </button>
        </div>
      ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onShowResources}
            className="flex min-h-14 items-start gap-3 rounded-xl border border-rose-100/15 bg-rose-100/[0.035] px-4 py-3 text-left transition hover:bg-rose-100/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-100/50"
          >
            <BadgeHelp aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-rose-100/75" />
            <span>
              <span className="block text-xs font-semibold text-zinc-100">{actionCopy.professionalHelp}</span>
              <span className="mt-1 block text-[11px] leading-4 text-zinc-400">{actionCopy.professionalHelpDetail}</span>
            </span>
          </button>
          <button
            type="button"
            onClick={onShowEvidence}
            className="flex min-h-14 items-center gap-3 rounded-xl border border-white/[0.09] bg-white/[0.025] px-4 py-3 text-left text-xs font-semibold text-zinc-200 transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-100/50"
          >
            <FileCheck2 aria-hidden="true" className="size-4 shrink-0 text-sky-100/75" />
            {actionCopy.evidenceAction}
          </button>
          <button
            type="button"
            onClick={onReturnToCase}
            className="flex min-h-12 items-center gap-3 rounded-xl border border-white/[0.09] bg-white/[0.025] px-4 py-3 text-left text-xs font-semibold text-zinc-300 transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-100/50"
          >
            <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
            {actionCopy.legalWorkflowAction}
          </button>
          <button
            type="button"
            onClick={onPause}
            className="flex min-h-12 items-center gap-3 rounded-xl border border-white/[0.09] bg-transparent px-4 py-3 text-left text-xs font-medium text-zinc-400 transition hover:border-white/[0.16] hover:bg-white/[0.03] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-100/50"
          >
            <PauseCircle aria-hidden="true" className="size-4 shrink-0" />
            {actionCopy.pauseAction}
          </button>
        </div>
      )}

      {safetyFirst ? (
        <p className="mt-4 inline-flex rounded-lg border border-amber-100/10 bg-amber-100/[0.035] px-3 py-2 text-xs leading-5 text-amber-50/75">
          {copy.safetyFirst}
        </p>
      ) : assessment?.legal_workflow_allowed ? (
        <p className="mt-4 text-xs leading-5 text-zinc-500">{copy.legalMayContinue}</p>
      ) : null}
      <p className="mt-4 border-t border-white/[0.06] pt-3 text-xs text-zinc-500">{copy.notContacted}</p>
    </SafetySurface>
  );
}
