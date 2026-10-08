import { StatusBadge } from './StatusBadge';
import type { ConfidencePercent, DocumentReviewStatus, EvidenceSource, ExtractedValueKind } from './types';

export interface DocumentFactProps {
  label: string;
  value: string | null;
  status: DocumentReviewStatus;
  kind?: ExtractedValueKind;
  confidencePercent?: ConfidencePercent | null;
  source?: EvidenceSource;
  onPage?: (pageNumber: number) => void;
}

export function DocumentFact({ label, value, status, kind, confidencePercent, source, onPage }: DocumentFactProps) {
  return (
    <article className="rounded-xl border border-white/[0.07] bg-[#0d111b] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-100">{label}</h3>
            {kind && <span className="rounded border border-white/[0.07] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-zinc-500">{kind.replace('_', ' ')}</span>}
          </div>
        </div>
        <StatusBadge status={status} />
      </div>
      <p className={`mt-3 break-words text-sm leading-6 ${value ? 'text-zinc-200' : 'italic text-zinc-500'}`}>
        {value || 'No value supplied'}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.06] pt-3 text-[10px] text-zinc-500">
        <span>Source page: {source?.pageNumber != null && onPage ? (
          <button type="button" onClick={() => onPage(source.pageNumber!)} className="text-blue-200 underline decoration-blue-200/30 underline-offset-2 hover:text-blue-100">{source.pageNumber}</button>
        ) : source?.pageNumber ?? 'Not supplied'}</span>
        <span>Confidence: {confidencePercent == null ? 'Not supplied' : `${confidencePercent}%`}</span>
        {source?.documentName && <span className="max-w-full break-all">Source: {source.documentName}</span>}
      </div>
    </article>
  );
}
