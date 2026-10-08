import type { DocumentReviewStatus } from './types';

const statusStyles: Record<DocumentReviewStatus, string> = {
  USER_REPORTED: 'border-violet-400/25 bg-violet-400/[0.08] text-violet-200',
  EVIDENCE_SUPPORTED: 'border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200',
  SYSTEM_INFERRED: 'border-blue-400/25 bg-blue-400/[0.08] text-blue-200',
  ASSUMPTION: 'border-amber-400/25 bg-amber-400/[0.08] text-amber-200',
  CONFLICTING: 'border-rose-400/25 bg-rose-400/[0.08] text-rose-200',
  UNKNOWN: 'border-zinc-500/25 bg-zinc-500/[0.08] text-zinc-300',
  UNCERTAIN: 'border-amber-400/25 bg-amber-400/[0.08] text-amber-200',
  NEEDS_OCR: 'border-orange-400/25 bg-orange-400/[0.08] text-orange-200',
  TEXT_EXTRACTED: 'border-blue-400/25 bg-blue-400/[0.08] text-blue-200',
  AWAITING_CONFIRMATION: 'border-amber-400/25 bg-amber-400/[0.08] text-amber-200',
};

const statusLabels: Record<DocumentReviewStatus, string> = {
  USER_REPORTED: 'User reported',
  EVIDENCE_SUPPORTED: 'User-confirmed extraction',
  SYSTEM_INFERRED: 'Inferred',
  ASSUMPTION: 'Assumption',
  CONFLICTING: 'Conflicting',
  UNKNOWN: 'Uncertain',
  UNCERTAIN: 'Uncertain',
  NEEDS_OCR: 'Needs OCR',
  TEXT_EXTRACTED: 'Not confirmed',
  AWAITING_CONFIRMATION: 'Awaiting confirmation',
};

export function StatusBadge({ status }: { status: DocumentReviewStatus }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[10px] font-medium tracking-wide ${statusStyles[status]}`}>
      {statusLabels[status]}
    </span>
  );
}
