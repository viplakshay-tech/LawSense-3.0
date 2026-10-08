import { ExternalLink, Scale } from 'lucide-react';
import { SourceBadge } from './SourceBadge';
import { getHttpUrl, type LegalCitation } from './types';

export interface SourceCitationProps {
  statement: string;
  citation?: LegalCitation | null;
}

export function SourceCitation({ statement, citation }: SourceCitationProps) {
  const hasCitation = Boolean(citation?.title?.trim() || citation?.citation?.trim());
  const citationUrl = getHttpUrl(citation?.url);

  return (
    <section aria-label="Legal source for statement" className="rounded-2xl border border-indigo-200/15 bg-indigo-200/[0.025] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Scale aria-hidden="true" className="h-4 w-4 text-indigo-100" />
          <h3 className="text-sm font-semibold text-zinc-100">Legal source</h3>
        </div>
        <SourceBadge status={hasCitation ? 'EVIDENCE_SUPPORTED' : 'UNKNOWN'} />
      </div>

      <blockquote className="mt-3 border-l-2 border-indigo-200/25 pl-3 text-sm leading-6 text-zinc-300">
        {statement}
      </blockquote>

      {hasCitation && citation ? (
        <div className="mt-3 rounded-xl border border-white/[0.07] bg-black/10 p-3">
          {citation.title && <p className="text-sm font-medium text-zinc-100">{citation.title}</p>}
          {citation.citation && <p className="mt-1 break-words text-xs leading-5 text-zinc-300">{citation.citation}</p>}
          {(citation.jurisdiction || citation.pinpoint) && (
            <p className="mt-2 text-[11px] text-zinc-500">
              {[citation.jurisdiction, citation.pinpoint].filter(Boolean).join(' · ')}
            </p>
          )}
          {citationUrl && (
            <a
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-indigo-200 underline decoration-indigo-200/30 underline-offset-4 hover:text-indigo-100"
              href={citationUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open supplied source <ExternalLink aria-hidden="true" className="h-3 w-3" />
            </a>
          )}
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2.5 text-xs leading-5 text-zinc-400">
          No legal source citation was supplied for this statement.
        </p>
      )}
    </section>
  );
}
