import { StatusBadge } from './StatusBadge';
import type { ConfidencePercent, DocumentReviewStatus, ExtractedValueKind } from './types';

const kindLabels: Record<ExtractedValueKind, string> = {
  name: 'Name',
  date: 'Date',
  amount: 'Amount',
  address: 'Address',
  clause: 'Clause',
  document_number: 'Document number',
  other: 'Field',
};

export interface ExtractedFieldProps {
  label: string;
  kind: ExtractedValueKind;
  value: string | null;
  status: DocumentReviewStatus;
  confidencePercent?: ConfidencePercent | null;
  sourcePage?: number | null;
}

export function ExtractedField({ label, kind, value, status, confidencePercent, sourcePage }: ExtractedFieldProps) {
  return (
    <article className="rounded-xl border border-white/[0.07] bg-[#0d111b] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{kindLabels[kind]}</p>
          <h3 className="mt-1 break-words text-xs font-medium text-zinc-300">{label}</h3>
        </div>
        <StatusBadge status={status} />
      </div>
      <p className={`mt-3 break-words text-sm leading-6 ${value ? 'text-zinc-100' : 'italic text-zinc-500'}`}>
        {value || 'No value supplied'}
      </p>
      <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/[0.06] pt-3 text-[10px]">
        <div className="flex gap-1.5">
          <dt className="text-zinc-600">Source page</dt>
          <dd className="text-zinc-400">{sourcePage ?? 'Not supplied'}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-zinc-600">Confidence</dt>
          <dd className="text-zinc-400">{confidencePercent == null ? 'Not supplied' : `${confidencePercent}%`}</dd>
        </div>
      </dl>
    </article>
  );
}
