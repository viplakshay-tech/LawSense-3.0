import { StatusBadge } from './StatusBadge';
import type { ConfidencePercent, DocumentReviewStatus } from './types';

export interface ClauseHighlightProps {
  clauseText: string;
  title?: string | null;
  status: DocumentReviewStatus;
  sourcePage?: number | null;
  confidencePercent?: ConfidencePercent | null;
}

export function ClauseHighlight({ clauseText, title, status, sourcePage, confidencePercent }: ClauseHighlightProps) {
  return (
    <article className="rounded-xl border border-blue-300/15 bg-[#101827] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-zinc-100">{title || 'Clause'}</h3>
        <StatusBadge status={status} />
      </div>
      {clauseText ? (
        <blockquote className="mt-3 border-l-2 border-blue-300/50 pl-3 text-sm leading-6 text-zinc-300">{clauseText}</blockquote>
      ) : (
        <p className="mt-3 text-sm italic text-zinc-500">No clause text supplied.</p>
      )}
      <p className="mt-3 text-[10px] text-zinc-500">
        Source page: {sourcePage ?? 'Not supplied'} <span aria-hidden="true">·</span> Confidence: {confidencePercent == null ? 'Not supplied' : `${confidencePercent}%`}
      </p>
    </article>
  );
}
