import { Lightbulb } from 'lucide-react';
import { ProvenanceBadge } from './ProvenanceBadge';
import { SourceBadge } from './SourceBadge';
import type { TrustSource, TrustStatus } from './types';

export interface SuggestedBasis {
  id?: string;
  detail: string;
  status: TrustStatus;
  source?: TrustSource | null;
}

export interface WhyThisWasSuggestedProps {
  issue: string;
  explanation?: string | null;
  status?: TrustStatus;
  basis?: readonly SuggestedBasis[];
}

export function WhyThisWasSuggested({ issue, explanation, status = 'UNKNOWN', basis = [] }: WhyThisWasSuggestedProps) {
  const hasExplanation = Boolean(explanation?.trim());

  return (
    <section
      aria-label="Why this was suggested"
      className="rounded-2xl border border-sky-300/15 bg-gradient-to-br from-sky-300/[0.07] via-[#101622] to-[#0d111b] p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-sky-200/15 bg-sky-200/[0.07] text-sky-200">
          <Lightbulb aria-hidden="true" className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-zinc-100">
              Why this was suggested
            </h3>
            <SourceBadge status={status} />
          </div>
          <p className="mt-1 text-xs text-zinc-400">{issue}</p>
          {hasExplanation ? (
            <p className="mt-3 text-sm leading-6 text-zinc-200">{explanation}</p>
          ) : (
            <p className="mt-3 rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2.5 text-xs leading-5 text-zinc-400">
              No explanation was supplied for this suggestion.
            </p>
          )}
        </div>
      </div>

      {basis.length > 0 && (
        <div className="mt-4 border-t border-white/[0.07] pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Recorded basis</p>
          <ul className="mt-2 space-y-2">
            {basis.map((item, index) => (
              <li key={item.id ?? `${item.detail}-${index}`} className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-xs leading-5 text-zinc-300">{item.detail}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <SourceBadge status={item.status} />
                  {item.source && <ProvenanceBadge source={item.source} />}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
