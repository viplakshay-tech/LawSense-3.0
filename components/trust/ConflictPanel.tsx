import { AlertTriangle } from 'lucide-react';
import { ProvenanceBadge } from './ProvenanceBadge';
import { SourceBadge } from './SourceBadge';
import type { ConflictEntry } from './types';

export interface ConflictPanelProps {
  conflicts?: readonly ConflictEntry[] | null;
  title?: string;
}

export function ConflictPanel({ conflicts, title = 'Conflicting information' }: ConflictPanelProps) {
  const hasConflicts = Boolean(conflicts?.length);
  const status = hasConflicts ? 'CONFLICTING' : 'UNKNOWN';

  return (
    <section aria-label={title} className="rounded-2xl border border-rose-300/15 bg-rose-300/[0.03] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <AlertTriangle aria-hidden="true" className="h-4 w-4 text-rose-200" />
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        </div>
        <SourceBadge status={status} />
      </div>

      {hasConflicts ? (
        <ul className="mt-4 space-y-3">
          {conflicts?.map((conflict, index) => (
            <li key={conflict.id ?? `${conflict.label}-${index}`} className="rounded-xl border border-white/[0.07] bg-[#0d111b]/80 p-3">
              <h4 className="text-xs font-semibold text-zinc-200">{conflict.label}</h4>
              {conflict.values.length > 0 ? (
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {conflict.values.map((value, valueIndex) => (
                    <li key={`${value.label}-${value.source?.documentName ?? 'source'}-${valueIndex}`} className="min-w-0 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{value.label}</p>
                      <p className="mt-1 break-words text-sm text-zinc-200">{value.value || 'No value supplied'}</p>
                      {value.source && <ProvenanceBadge source={value.source} className="mt-2" />}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-zinc-400">No values were supplied for this conflict.</p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs leading-5 text-zinc-400">No conflict information was supplied.</p>
      )}
    </section>
  );
}
