import { FileSearch } from 'lucide-react';
import type { ConfidencePercent, EvidenceSource } from './types';

export interface EvidenceProvenanceProps {
  source: EvidenceSource;
  confidencePercent?: ConfidencePercent | null;
  label?: string;
  onPage?: (pageNumber: number) => void;
}

export function EvidenceProvenance({ source, confidencePercent, label = 'Evidence source', onPage }: EvidenceProvenanceProps) {
  const hasSourceDetails = Boolean(source.documentName || source.pageNumber != null || source.excerpt || source.locator);

  return (
    <section aria-label={label} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-300">
        <FileSearch aria-hidden="true" className="h-3.5 w-3.5 text-blue-300" /> {label}
      </h3>
      {!hasSourceDetails ? (
        <p className="mt-3 text-xs leading-5 text-zinc-500">Source details were not supplied.</p>
      ) : (
        <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-zinc-600">Document</dt>
            <dd className="mt-1 break-words text-zinc-300">{source.documentName || 'Not supplied'}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-zinc-600">Source page</dt>
            <dd className="mt-1 text-zinc-300">
              {source.pageNumber != null && onPage ? (
                <button type="button" onClick={() => onPage(source.pageNumber!)} className="text-blue-200 underline decoration-blue-200/30 underline-offset-2 hover:text-blue-100">
                  Page {source.pageNumber}
                </button>
              ) : source.pageNumber != null ? `Page ${source.pageNumber}` : 'Not supplied'}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-zinc-600">Locator</dt>
            <dd className="mt-1 break-words text-zinc-300">{source.locator || 'Not supplied'}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-zinc-600">Confidence</dt>
            <dd className="mt-1 text-zinc-300">{confidencePercent == null ? 'Not supplied' : `${confidencePercent}%`}</dd>
          </div>
        </dl>
      )}
      {source.excerpt && (
        <blockquote className="mt-3 border-l-2 border-blue-300/40 pl-3 text-xs leading-5 text-zinc-400">{source.excerpt}</blockquote>
      )}
    </section>
  );
}
