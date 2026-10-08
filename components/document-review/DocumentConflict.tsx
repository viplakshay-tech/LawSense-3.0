import { AlertTriangle } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import type { DocumentReviewStatus } from './types';

export interface ConflictValue {
  label: string;
  value: string | null;
  documentName?: string | null;
  sourcePage?: number | null;
}

export interface DocumentConflictProps {
  title: string;
  description?: string | null;
  values: readonly ConflictValue[];
}

export function DocumentConflict({ title, description, values }: DocumentConflictProps) {
  const status: DocumentReviewStatus = 'CONFLICTING';

  return (
    <section aria-label={`Conflict: ${title}`} className="rounded-xl border border-rose-400/20 bg-rose-400/[0.035] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
            {description && <p className="mt-1 text-xs leading-5 text-zinc-400">{description}</p>}
          </div>
        </div>
        <StatusBadge status={status} />
      </div>
      {values.length > 0 ? (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {values.map((item, index) => (
            <li key={`${item.label}-${item.documentName ?? 'source'}-${item.sourcePage ?? 'page'}-${index}`} className="rounded-lg border border-white/[0.07] bg-[#0d111b] p-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{item.label}</p>
              <p className="mt-1 break-words text-sm text-zinc-200">{item.value || 'No value supplied'}</p>
              <p className="mt-2 break-words text-[10px] text-zinc-500">
                {item.documentName || 'Document not supplied'} <span aria-hidden="true">·</span> Page {item.sourcePage ?? 'not supplied'}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs leading-5 text-zinc-500">No conflicting values were supplied.</p>
      )}
    </section>
  );
}
