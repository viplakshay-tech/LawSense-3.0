import { ArrowRight, PauseCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SafetySurface } from './SafetySurface';

export function NextSafeAction({
  assessment,
  copy,
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
}) {
  const nextStep = assessment?.safe_next_step_sequence[0];
  const safetyFirst = assessment?.legal_workflow_allowed === false;

  return (
    <SafetySurface className={cn(
      'border-teal-100/[0.14] bg-[linear-gradient(135deg,rgba(23,38,41,0.55),rgba(17,22,30,0.98)_72%)]',
      assessment?.urgency === 'urgent' && 'border-amber-100/[0.2]',
    )}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-teal-100/10 bg-teal-100/[0.05] text-teal-100/75">
          {nextStep ? <ArrowRight aria-hidden="true" className="size-4" /> : <PauseCircle aria-hidden="true" className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-100/65">{copy.nextEyebrow}</p>
          <h2 className="mt-2 text-lg font-medium tracking-tight text-zinc-100">{copy.nextTitle}</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">{copy.nextDescription}</p>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-white/[0.07] bg-black/10 p-4 sm:p-5">
        {nextStep ? (
          <p className="text-base leading-7 text-zinc-100">{nextStep}</p>
        ) : (
          <p className="text-sm leading-6 text-zinc-400">{copy.noNextStep}</p>
        )}
      </div>

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
