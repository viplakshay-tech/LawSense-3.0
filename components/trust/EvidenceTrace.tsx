import { FileCheck2, Quote } from 'lucide-react';
import { ProvenanceBadge } from './ProvenanceBadge';
import { SourceBadge } from './SourceBadge';
import type { EvidenceTraceItem } from './types';

export interface EvidenceTraceProps {
  items?: readonly EvidenceTraceItem[] | null;
  title?: string;
}

export function EvidenceTrace({ items, title = 'Evidence that supports this' }: EvidenceTraceProps) {
  const hasItems = Boolean(items?.length);

  return (
    <section aria-label={title} className="rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.025] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <FileCheck2 aria-hidden="true" className="h-4 w-4 text-emerald-200" />
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        </div>
        {!hasItems && <SourceBadge status="UNKNOWN" />}
      </div>

      {hasItems ? (
        <ol className="mt-4 space-y-3">
          {items?.map((item, index) => (
            <li key={item.id ?? `${item.statement}-${index}`} className="relative pl-5">
              <span aria-hidden="true" className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-emerald-200/70 ring-4 ring-emerald-200/[0.08]" />
              {index < items.length - 1 && <span aria-hidden="true" className="absolute bottom-[-0.95rem] left-[3px] top-4 w-px bg-emerald-200/15" />}
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-sm leading-6 text-zinc-200">{item.statement}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <SourceBadge status={item.status} />
                  {item.source && <ProvenanceBadge source={item.source} />}
                </div>
              </div>
              {item.source?.excerpt && (
                <blockquote className="mt-2 flex gap-2 rounded-lg border-l-2 border-emerald-200/30 bg-black/10 px-3 py-2 text-xs leading-5 text-zinc-400">
                  <Quote aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0 text-emerald-200/60" />
                  <span>{item.source.excerpt}</span>
                </blockquote>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-xs leading-5 text-zinc-400">No supporting evidence details were supplied.</p>
      )}
    </section>
  );
}
